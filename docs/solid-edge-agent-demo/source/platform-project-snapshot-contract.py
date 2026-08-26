"""Secure SharePoint composition for the ProjectSnapshotBundle v1.

The module accepts a manifest and in-memory artifact bytes, never local paths.
It validates the entire bundle before the first remote operation, delegates all
writes to the existing Microsoft 365 loader, and writes ``manifest.json`` last
as the completion marker.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, Literal, Protocol, TypeAlias

from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from iv_connect.adapters.dms.models import DMS_Document, DMS_Folder
from iv_connect.adapters.exceptions import AdapterTerminalError, is_retryable_error

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_UUID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
)
_PROJECT_ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$")
_RFC3339_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
_WINDOWS_DRIVE_RE = re.compile(r"^[a-zA-Z]:")
_SAFE_TOKEN_RE = re.compile(r"[^a-z0-9._-]+")
_INVALID_SHAREPOINT_CHARS = frozenset('"*:<>?\\|#%')
_RESERVED_MANIFEST_PATH = "manifest.json"
_MAX_RELATIVE_PATH_LENGTH = 300
_MAX_REMOTE_PATH_LENGTH = 400
_MAX_ARTIFACTS = 10_000

UploadItemKind: TypeAlias = Literal["folder", "artifact", "manifest"]
UploadItemStatus: TypeAlias = Literal[
    "uploaded",
    "dry_run",
    "already_exists",
    "conflict",
    "failed",
    "skipped",
]
UploadStatus: TypeAlias = Literal["uploaded", "dry_run", "conflict", "partial_failure"]
VerificationStatus: TypeAlias = Literal["verified", "verified_existing"]


class ProjectSnapshotValidationError(ValueError):
    """The supplied manifest or byte payload is unsafe or inconsistent."""


class ProjectSnapshotVerificationError(ProjectSnapshotValidationError):
    """A remote bundle exists but does not match its expected v1 contract."""


class ProjectSnapshotProjectV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    id: str = Field(min_length=3, max_length=64, pattern=_PROJECT_ID_RE)
    name: str = Field(min_length=2, max_length=80)
    source_system: Literal["kicad", "solid_edge"]

    @field_validator("id", "name")
    @classmethod
    def validate_text(cls, value: str) -> str:
        value = _validate_trimmed_text(value)
        if any(character in value for character in '/\\:*?"<>|'):
            raise ValueError("project text contains a forbidden filesystem character")
        if value in {".", ".."}:
            raise ValueError("project text cannot be a dot path segment")
        return value


class ProjectSnapshotProfileV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    id: Literal[
        "kicad-pdf-gerber-v1",
        "kicad-pdf-gerber-odbpp-v2",
        "solid-edge-native-step-pdf-v1",
        "solid-edge-native-step-pdf-bom-v2",
        "solid-edge-native-step-pdf-bom-deps-v3",
    ]
    kicad_cli_version: str | None = Field(default=None, min_length=1, max_length=160)
    solid_edge_version: str | None = Field(default=None, min_length=1, max_length=160)
    runtime_version: str = Field(min_length=1, max_length=160)

    @field_validator("kicad_cli_version", "solid_edge_version", "runtime_version")
    @classmethod
    def validate_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_trimmed_text(value)

    @model_validator(mode="after")
    def validate_source_version(self) -> ProjectSnapshotProfileV1:
        is_solid_edge = self.id.startswith("solid-edge-")
        if is_solid_edge != (self.solid_edge_version is not None):
            raise ValueError("profile source version does not match profile id")
        if is_solid_edge == (self.kicad_cli_version is not None):
            raise ValueError("profile must contain exactly one source-system version")
        return self


class ProjectSnapshotCapabilityGapV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    capability: str = Field(min_length=1, max_length=120)
    required: bool
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("capability", "reason")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _validate_trimmed_text(value)


class ProjectSnapshotArtifactV1(BaseModel):
    """One native or generated file declared by the runtime manifest."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    relative_path: str = Field(min_length=1, max_length=_MAX_RELATIVE_PATH_LENGTH)
    role: str = Field(min_length=1, max_length=80)
    source_object: str = Field(min_length=1, max_length=255)
    origin: Literal["native", "generated"]
    size_bytes: int = Field(ge=0, le=2**64 - 1)
    sha256: str

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        return _validate_relative_artifact_path(value)

    @field_validator("role", "source_object")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _validate_trimmed_text(value)

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        if not _SHA256_RE.fullmatch(value):
            raise ValueError("sha256 must be 64 lowercase hexadecimal characters")
        return value


class SharePointProjectSnapshotManifestV1(BaseModel):
    """Exact adapter-side validation of the runtime ProjectSnapshot manifest."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["1.0"]
    bundle_type: Literal["project_snapshot"]
    correlation_id: str = Field(min_length=1, max_length=255)
    created_at: str = Field(min_length=1, max_length=80)
    status: Literal["verified", "partial"]
    project: ProjectSnapshotProjectV1
    profile: ProjectSnapshotProfileV1
    artifacts: tuple[ProjectSnapshotArtifactV1, ...] = Field(
        min_length=1,
        max_length=_MAX_ARTIFACTS,
    )
    capability_gaps: tuple[ProjectSnapshotCapabilityGapV1, ...] = ()
    content_hash: str

    @field_validator("correlation_id")
    @classmethod
    def validate_correlation_id(cls, value: str) -> str:
        value = _validate_trimmed_text(value)
        if not _UUID_RE.fullmatch(value):
            raise ValueError("correlation_id must be a UUID")
        return value

    @field_validator("created_at")
    @classmethod
    def validate_created_at(cls, value: str) -> str:
        value = _validate_trimmed_text(value)
        if not _RFC3339_RE.fullmatch(value):
            raise ValueError("created_at must be RFC 3339")
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("created_at must be RFC 3339") from exc
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("created_at must include an offset")
        return value

    @field_validator("content_hash")
    @classmethod
    def validate_content_hash(cls, value: str) -> str:
        if not _SHA256_RE.fullmatch(value):
            raise ValueError("content_hash must be 64 lowercase hexadecimal characters")
        return value

    @model_validator(mode="after")
    def validate_artifacts_and_hash(self) -> SharePointProjectSnapshotManifestV1:
        _validate_artifact_hierarchy(self.artifacts)
        expected_hash = compute_project_snapshot_content_hash(self.artifacts)
        if self.content_hash != expected_hash:
            raise ValueError("content_hash does not match the canonical runtime artifact hash")
        required_gaps = any(gap.required for gap in self.capability_gaps)
        if self.status == "verified" and required_gaps:
            raise ValueError("verified snapshot cannot contain a required capability gap")
        return self


@dataclass(frozen=True)
class ProjectSnapshotUploadItemResult:
    kind: UploadItemKind
    relative_path: str
    remote_path: str
    status: UploadItemStatus
    native_id: str | None = None
    web_url: str | None = None
    error_code: str | None = None
    retryable: bool = False


@dataclass(frozen=True)
class ProjectSnapshotUploadResult:
    status: UploadStatus
    project_id: str
    content_hash: str
    correlation_id: str
    project_folder: str
    snapshot_folder: str
    idempotency_key: str
    items: tuple[ProjectSnapshotUploadItemResult, ...]
    manifest_document_id: str | None = None

    @property
    def success(self) -> bool:
        return self.status in {"uploaded", "dry_run"}


@dataclass(frozen=True)
class ProjectSnapshotRemoteDocument:
    """One SharePoint document read through the internal loader seam."""

    document: DMS_Document
    content: bytes
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class ProjectSnapshotVerifiedItem:
    kind: Literal["artifact", "manifest"]
    relative_path: str
    remote_path: str
    native_id: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class ProjectSnapshotVerificationResult:
    status: VerificationStatus
    project_id: str
    content_hash: str
    correlation_id: str
    snapshot_folder: str
    manifest_web_url: str | None
    items: tuple[ProjectSnapshotVerifiedItem, ...]

    @property
    def success(self) -> bool:
        return True


class SharePointSnapshotLoader(Protocol):
    """Internal seam implemented by Microsoft365Loader and unit-test fakes."""

    @property
    def is_dry_run(self) -> bool: ...

    async def create_folder(
        self,
        folder_name: str,
        parent_path: str = "/",
        site_id: str | None = None,
        drive_id: str | None = None,
    ) -> DMS_Folder: ...

    async def upload_document(
        self,
        file_name: str,
        content: bytes,
        folder_path: str = "/",
        site_id: str | None = None,
        drive_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DMS_Document: ...

    async def read_project_snapshot_document(
        self,
        remote_path: str,
        site_id: str | None = None,
        drive_id: str | None = None,
    ) -> ProjectSnapshotRemoteDocument: ...


class SharePointProjectSnapshotComposer:
    """Upload and verify a ProjectSnapshotBundle through a small interface."""

    def __init__(self, loader: SharePointSnapshotLoader) -> None:
        self._loader = loader

    async def upload(
        self,
        manifest: SharePointProjectSnapshotManifestV1 | Mapping[str, Any],
        artifact_bytes: Mapping[str, bytes],
        *,
        target_root: str = "/IVConnect/ProjectSnapshots",
        site_id: str | None = None,
        drive_id: str | None = None,
        dry_run: bool = False,
    ) -> ProjectSnapshotUploadResult:
        """Validate everything, then upload artifacts and the manifest last.

        ``dry_run`` is descriptive, not an authorization override.  It must
        exactly match the injected loader's own dry-run mode; otherwise the
        call fails before any loader operation.  This prevents a caller from
        labeling real writes as a simulation (or skipped writes as uploaded).
        """
        validated = _validate_manifest(manifest)
        payloads = _validate_artifact_bytes(validated, artifact_bytes)
        remote_root = _validate_remote_root(target_root)
        loader_dry_run = bool(getattr(self._loader, "is_dry_run", False))
        if dry_run != loader_dry_run:
            raise ProjectSnapshotValidationError(
                "composer dry_run must exactly match the loader dry-run mode"
            )
        project_folder_name = _project_folder_name(validated)
        snapshot_folder_name = _snapshot_folder_name(validated)
        project_folder = _join_remote(remote_root, project_folder_name)
        snapshot_folder = _join_remote(project_folder, snapshot_folder_name)
        project_key = hashlib.sha256(validated.project.id.encode("utf-8")).hexdigest()[:16]
        idempotency_key = (
            "sharepoint:project-snapshot:v1:"
            f"{project_key}:{validated.content_hash}:{validated.correlation_id}"
        )

        logger.bind(
            event="m365.project_snapshot.start",
            correlation_id=validated.correlation_id,
            artifact_count=len(validated.artifacts),
            dry_run=dry_run,
        ).info("m365.project_snapshot.start")

        item_results: list[ProjectSnapshotUploadItemResult] = []
        unavailable_folders: set[str] = set()
        for parent_path, folder_name, remote_path in _required_folders(
            remote_root,
            project_folder_name,
            snapshot_folder_name,
            validated.artifacts,
        ):
            if _is_below_any(remote_path, unavailable_folders):
                unavailable_folders.add(remote_path)
                item_results.append(
                    ProjectSnapshotUploadItemResult(
                        kind="folder",
                        relative_path=_relative_to_snapshot(remote_path, snapshot_folder),
                        remote_path=remote_path,
                        status="skipped",
                        error_code="parent_folder_failed",
                    )
                )
                continue
            try:
                folder = await self._loader.create_folder(
                    folder_name,
                    parent_path=parent_path,
                    site_id=site_id,
                    drive_id=drive_id,
                )
                item_results.append(
                    ProjectSnapshotUploadItemResult(
                        kind="folder",
                        relative_path=_relative_to_snapshot(remote_path, snapshot_folder),
                        remote_path=remote_path,
                        status="dry_run" if dry_run else "uploaded",
                        native_id=folder.native_id,
                        web_url=folder.web_url,
                    )
                )
            except Exception as exc:  # noqa: BLE001 - external adapter result is normalized
                if _is_conflict(exc):
                    item_results.append(
                        ProjectSnapshotUploadItemResult(
                            kind="folder",
                            relative_path=_relative_to_snapshot(remote_path, snapshot_folder),
                            remote_path=remote_path,
                            status="already_exists",
                            error_code="conflict_409",
                        )
                    )
                else:
                    unavailable_folders.add(remote_path)
                    item_results.append(
                        ProjectSnapshotUploadItemResult(
                            kind="folder",
                            relative_path=_relative_to_snapshot(remote_path, snapshot_folder),
                            remote_path=remote_path,
                            status="failed",
                            error_code="folder_create_failed",
                            retryable=_is_retryable(exc),
                        )
                    )

        artifact_results: list[ProjectSnapshotUploadItemResult] = []
        for artifact in sorted(validated.artifacts, key=lambda item: item.relative_path):
            relative_parent = PurePosixPath(artifact.relative_path).parent.as_posix()
            remote_parent = (
                snapshot_folder
                if relative_parent == "."
                else _join_remote(snapshot_folder, relative_parent)
            )
            remote_path = _join_remote(snapshot_folder, artifact.relative_path)
            if _is_below_any(remote_parent, unavailable_folders):
                result = ProjectSnapshotUploadItemResult(
                    kind="artifact",
                    relative_path=artifact.relative_path,
                    remote_path=remote_path,
                    status="skipped",
                    error_code="parent_folder_failed",
                )
            else:
                result = await self._upload_artifact(
                    validated,
                    artifact,
                    payloads[artifact.relative_path],
                    remote_parent,
                    remote_path,
                    site_id=site_id,
                    drive_id=drive_id,
                    dry_run=dry_run,
                )
                if result.status == "conflict" and not dry_run:
                    result = await self._verify_existing_artifact(
                        validated,
                        artifact,
                        payloads[artifact.relative_path],
                        result,
                        site_id=site_id,
                        drive_id=drive_id,
                    )
            artifact_results.append(result)
            item_results.append(result)

        manifest_remote_path = _join_remote(snapshot_folder, _RESERVED_MANIFEST_PATH)
        manifest_document_id: str | None = None
        if not all(
            result.status in {"uploaded", "dry_run", "already_exists"}
            for result in artifact_results
        ):
            manifest_result = ProjectSnapshotUploadItemResult(
                kind="manifest",
                relative_path=_RESERVED_MANIFEST_PATH,
                remote_path=manifest_remote_path,
                status="skipped",
                error_code="artifact_set_incomplete",
            )
        else:
            manifest_content = _canonical_manifest_bytes(validated)
            manifest_result = await self._upload_document(
                kind="manifest",
                relative_path=_RESERVED_MANIFEST_PATH,
                remote_path=manifest_remote_path,
                file_name=_RESERVED_MANIFEST_PATH,
                content=manifest_content,
                folder_path=snapshot_folder,
                metadata={
                    **_base_metadata(validated),
                    "IVArtifactRole": "manifest",
                    "IVArtifactPath": _RESERVED_MANIFEST_PATH,
                    "IVArtifactSha256": hashlib.sha256(manifest_content).hexdigest(),
                    "IVArtifactSize": len(manifest_content),
                },
                site_id=site_id,
                drive_id=drive_id,
                dry_run=dry_run,
            )
            manifest_document_id = manifest_result.native_id
        item_results.append(manifest_result)

        status = _overall_status(item_results, dry_run=dry_run)
        logger.bind(
            event="m365.project_snapshot.complete",
            correlation_id=validated.correlation_id,
            status=status,
            artifact_count=len(validated.artifacts),
            failed_count=sum(item.status in {"failed", "conflict"} for item in item_results),
        ).info("m365.project_snapshot.complete")
        return ProjectSnapshotUploadResult(
            status=status,
            project_id=validated.project.id,
            content_hash=validated.content_hash,
            correlation_id=validated.correlation_id,
            project_folder=project_folder,
            snapshot_folder=snapshot_folder,
            idempotency_key=idempotency_key,
            items=tuple(item_results),
            manifest_document_id=manifest_document_id,
        )

    async def _verify_existing_artifact(
        self,
        manifest: SharePointProjectSnapshotManifestV1,
        artifact: ProjectSnapshotArtifactV1,
        content: bytes,
        result: ProjectSnapshotUploadItemResult,
        *,
        site_id: str | None,
        drive_id: str | None,
    ) -> ProjectSnapshotUploadItemResult:
        """Resume a partial upload only when the existing artifact is identical."""
        try:
            remote = await self._loader.read_project_snapshot_document(
                result.remote_path,
                site_id=site_id,
                drive_id=drive_id,
            )
            _verify_remote_document(
                remote,
                remote_path=result.remote_path,
                expected_name=PurePosixPath(artifact.relative_path).name,
                expected_content=content,
                expected_metadata={
                    **_base_metadata(manifest),
                    "IVArtifactRole": artifact.role,
                    "IVArtifactPath": artifact.relative_path,
                    "IVArtifactSha256": artifact.sha256,
                    "IVArtifactSize": artifact.size_bytes,
                    "IVArtifactOrigin": artifact.origin,
                    "IVSourceObject": artifact.source_object,
                },
            )
        except Exception as exc:  # noqa: BLE001 - normalized into retryable or conflict
            if _is_retryable(exc):
                return replace(
                    result,
                    status="failed",
                    retryable=True,
                    error_code="existing_artifact_readback_retry_pending",
                )
            return result
        return replace(
            result,
            status="already_exists",
            native_id=remote.document.native_id,
            web_url=remote.document.web_url,
            error_code="conflict_409_verified",
        )

    async def verify(
        self,
        manifest: SharePointProjectSnapshotManifestV1 | Mapping[str, Any],
        *,
        target_root: str = "/IVConnect/ProjectSnapshots",
        site_id: str | None = None,
        drive_id: str | None = None,
        upload_result: ProjectSnapshotUploadResult | None = None,
    ) -> ProjectSnapshotVerificationResult:
        """Read back and verify every byte and relevant SharePoint field.

        A conflicting upload is only reclassified as ``verified_existing``
        when its complete deterministic remote bundle is byte- and
        metadata-identical.  Any mismatch fails closed.
        """
        validated = _validate_manifest(manifest)
        remote_root = _validate_remote_root(target_root)
        project_folder = _join_remote(remote_root, _project_folder_name(validated))
        snapshot_folder = _join_remote(project_folder, _snapshot_folder_name(validated))
        verification_status = _verification_status(
            validated,
            project_folder,
            snapshot_folder,
            upload_result,
        )

        logger.bind(
            event="m365.project_snapshot.verify.start",
            correlation_id=validated.correlation_id,
            artifact_count=len(validated.artifacts),
            existing=verification_status == "verified_existing",
        ).info("m365.project_snapshot.verify.start")

        manifest_path = _join_remote(snapshot_folder, _RESERVED_MANIFEST_PATH)
        remote_manifest_document = await self._loader.read_project_snapshot_document(
            manifest_path,
            site_id=site_id,
            drive_id=drive_id,
        )
        canonical_manifest = _canonical_manifest_bytes(validated)
        _verify_remote_document(
            remote_manifest_document,
            remote_path=manifest_path,
            expected_name=_RESERVED_MANIFEST_PATH,
            expected_content=canonical_manifest,
            expected_metadata={
                **_base_metadata(validated),
                "IVArtifactRole": "manifest",
                "IVArtifactPath": _RESERVED_MANIFEST_PATH,
                "IVArtifactSha256": hashlib.sha256(canonical_manifest).hexdigest(),
                "IVArtifactSize": len(canonical_manifest),
            },
        )
        try:
            decoded_manifest = json.loads(remote_manifest_document.content)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProjectSnapshotVerificationError(
                "remote manifest is not valid UTF-8 JSON"
            ) from exc
        _validate_manifest(decoded_manifest)

        verified_items: list[ProjectSnapshotVerifiedItem] = [
            _verified_item(
                "manifest",
                _RESERVED_MANIFEST_PATH,
                manifest_path,
                remote_manifest_document,
            )
        ]
        observed_artifacts: list[Mapping[str, Any]] = []
        for artifact in sorted(validated.artifacts, key=lambda item: item.relative_path):
            remote_path = _join_remote(snapshot_folder, artifact.relative_path)
            remote_document = await self._loader.read_project_snapshot_document(
                remote_path,
                site_id=site_id,
                drive_id=drive_id,
            )
            _verify_remote_document(
                remote_document,
                remote_path=remote_path,
                expected_name=PurePosixPath(artifact.relative_path).name,
                expected_size=artifact.size_bytes,
                expected_sha256=artifact.sha256,
                expected_metadata={
                    **_base_metadata(validated),
                    "IVArtifactRole": artifact.role,
                    "IVArtifactPath": artifact.relative_path,
                    "IVArtifactSha256": artifact.sha256,
                    "IVArtifactSize": artifact.size_bytes,
                    "IVArtifactOrigin": artifact.origin,
                    "IVSourceObject": artifact.source_object,
                },
            )
            actual_sha256 = hashlib.sha256(remote_document.content).hexdigest()
            observed_artifacts.append(
                {
                    "relative_path": artifact.relative_path,
                    "role": artifact.role,
                    "source_object": artifact.source_object,
                    "origin": artifact.origin,
                    "sha256": actual_sha256,
                    "size_bytes": len(remote_document.content),
                }
            )
            verified_items.append(
                _verified_item("artifact", artifact.relative_path, remote_path, remote_document)
            )

        observed_content_hash = compute_project_snapshot_content_hash(observed_artifacts)
        if observed_content_hash != validated.content_hash:
            raise ProjectSnapshotVerificationError("remote artifact set content_hash mismatch")

        logger.bind(
            event="m365.project_snapshot.verify.complete",
            correlation_id=validated.correlation_id,
            status=verification_status,
            artifact_count=len(validated.artifacts),
        ).info("m365.project_snapshot.verify.complete")
        return ProjectSnapshotVerificationResult(
            status=verification_status,
            project_id=validated.project.id,
            content_hash=validated.content_hash,
            correlation_id=validated.correlation_id,
            snapshot_folder=snapshot_folder,
            manifest_web_url=remote_manifest_document.document.web_url,
            items=tuple(verified_items),
        )

    async def _upload_artifact(
        self,
        manifest: SharePointProjectSnapshotManifestV1,
        artifact: ProjectSnapshotArtifactV1,
        content: bytes,
        remote_parent: str,
        remote_path: str,
        *,
        site_id: str | None,
        drive_id: str | None,
        dry_run: bool,
    ) -> ProjectSnapshotUploadItemResult:
        return await self._upload_document(
            kind="artifact",
            relative_path=artifact.relative_path,
            remote_path=remote_path,
            file_name=PurePosixPath(artifact.relative_path).name,
            content=content,
            folder_path=remote_parent,
            metadata={
                **_base_metadata(manifest),
                "IVArtifactRole": artifact.role,
                "IVArtifactPath": artifact.relative_path,
                "IVArtifactSha256": artifact.sha256,
                "IVArtifactSize": artifact.size_bytes,
                "IVArtifactOrigin": artifact.origin,
                "IVSourceObject": artifact.source_object,
            },
            site_id=site_id,
            drive_id=drive_id,
            dry_run=dry_run,
        )

    async def _upload_document(
        self,
        *,
        kind: Literal["artifact", "manifest"],
        relative_path: str,
        remote_path: str,
        file_name: str,
        content: bytes,
        folder_path: str,
        metadata: dict[str, str | int | bool],
        site_id: str | None,
        drive_id: str | None,
        dry_run: bool,
    ) -> ProjectSnapshotUploadItemResult:
        try:
            document = await self._loader.upload_document(
                file_name,
                content,
                folder_path=folder_path,
                site_id=site_id,
                drive_id=drive_id,
                metadata=metadata,
            )
            return ProjectSnapshotUploadItemResult(
                kind=kind,
                relative_path=relative_path,
                remote_path=remote_path,
                status="dry_run" if dry_run else "uploaded",
                native_id=document.native_id,
                web_url=document.web_url,
            )
        except Exception as exc:  # noqa: BLE001 - external adapter result is normalized
            if _is_conflict(exc):
                return ProjectSnapshotUploadItemResult(
                    kind=kind,
                    relative_path=relative_path,
                    remote_path=remote_path,
                    status="conflict",
                    error_code="conflict_409",
                )
            return ProjectSnapshotUploadItemResult(
                kind=kind,
                relative_path=relative_path,
                remote_path=remote_path,
                status="failed",
                error_code="upload_failed",
                retryable=_is_retryable(exc),
            )


def compute_project_snapshot_content_hash(
    artifacts: tuple[ProjectSnapshotArtifactV1, ...] | list[Mapping[str, Any]],
) -> str:
    """Reproduce the runtime's canonical artifact hash byte-for-byte."""
    normalized: list[ProjectSnapshotArtifactV1] = []
    for artifact in artifacts:
        if isinstance(artifact, ProjectSnapshotArtifactV1):
            normalized.append(artifact)
        else:
            normalized.append(ProjectSnapshotArtifactV1.model_validate(dict(artifact), strict=True))
    digest = hashlib.sha256()
    for artifact in sorted(normalized, key=lambda item: item.relative_path):
        digest.update(artifact.relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(artifact.role.encode("utf-8"))
        digest.update(b"\0")
        digest.update(artifact.sha256.encode("ascii"))
        digest.update(b"\0")
        digest.update(artifact.size_bytes.to_bytes(8, byteorder="little", signed=False))
    return digest.hexdigest()


def _verification_status(
    manifest: SharePointProjectSnapshotManifestV1,
    project_folder: str,
    snapshot_folder: str,
    upload_result: ProjectSnapshotUploadResult | None,
) -> VerificationStatus:
    if upload_result is None:
        return "verified"
    expected = (
        upload_result.project_id == manifest.project.id
        and upload_result.content_hash == manifest.content_hash
        and upload_result.correlation_id == manifest.correlation_id
        and upload_result.project_folder == project_folder
        and upload_result.snapshot_folder == snapshot_folder
    )
    if not expected:
        raise ProjectSnapshotVerificationError(
            "upload result does not identify the expected snapshot"
        )
    if upload_result.status == "uploaded":
        return "verified"
    if upload_result.status != "conflict":
        raise ProjectSnapshotVerificationError(
            "upload_result must be a completed upload or an explicit 409 conflict"
        )
    if not any(
        item.status == "conflict" and item.error_code == "conflict_409"
        for item in upload_result.items
    ):
        raise ProjectSnapshotVerificationError(
            "upload_result has no explicit 409 item for verified_existing"
        )
    return "verified_existing"


def _verify_remote_document(
    remote: ProjectSnapshotRemoteDocument,
    *,
    remote_path: str,
    expected_name: str,
    expected_metadata: Mapping[str, str | int],
    expected_content: bytes | None = None,
    expected_size: int | None = None,
    expected_sha256: str | None = None,
) -> None:
    content = remote.content
    if type(content) is not bytes:
        raise ProjectSnapshotVerificationError(f"remote content is not bytes for {remote_path!r}")
    if remote.document.name != expected_name:
        raise ProjectSnapshotVerificationError(f"remote document name mismatch for {remote_path!r}")

    actual_size = len(content)
    required_size = len(expected_content) if expected_content is not None else expected_size
    if required_size is None or actual_size != required_size:
        raise ProjectSnapshotVerificationError(f"remote size mismatch for {remote_path!r}")
    if remote.document.size_bytes is not None and remote.document.size_bytes != actual_size:
        raise ProjectSnapshotVerificationError(
            f"SharePoint-reported size mismatch for {remote_path!r}"
        )

    actual_sha256 = hashlib.sha256(content).hexdigest()
    required_sha256 = (
        hashlib.sha256(expected_content).hexdigest()
        if expected_content is not None
        else expected_sha256
    )
    if required_sha256 is None or actual_sha256 != required_sha256:
        raise ProjectSnapshotVerificationError(f"remote sha256 mismatch for {remote_path!r}")
    if expected_content is not None and content != expected_content:
        raise ProjectSnapshotVerificationError(f"remote bytes mismatch for {remote_path!r}")

    for field, expected in expected_metadata.items():
        actual = remote.metadata.get(field)
        if not _metadata_matches(actual, expected):
            raise ProjectSnapshotVerificationError(
                f"remote metadata mismatch for {remote_path!r}: {field}"
            )


def _metadata_matches(actual: Any, expected: str | int) -> bool:
    if isinstance(expected, int):
        if isinstance(actual, bool):
            return False
        if isinstance(actual, int):
            return actual == expected
        return isinstance(actual, str) and actual.isdecimal() and int(actual) == expected
    return type(actual) is str and actual == expected


def _verified_item(
    kind: Literal["artifact", "manifest"],
    relative_path: str,
    remote_path: str,
    remote: ProjectSnapshotRemoteDocument,
) -> ProjectSnapshotVerifiedItem:
    return ProjectSnapshotVerifiedItem(
        kind=kind,
        relative_path=relative_path,
        remote_path=remote_path,
        native_id=remote.document.native_id,
        size_bytes=len(remote.content),
        sha256=hashlib.sha256(remote.content).hexdigest(),
    )


def _validate_manifest(
    manifest: SharePointProjectSnapshotManifestV1 | Mapping[str, Any],
) -> SharePointProjectSnapshotManifestV1:
    try:
        if isinstance(manifest, SharePointProjectSnapshotManifestV1):
            return manifest
        if not isinstance(manifest, Mapping):
            raise TypeError("manifest must be a mapping or manifest-v1 model")
        payload = dict(manifest)
        # JSON arrays are materialized as lists. Convert only the two declared
        # collection fields, while retaining strict validation for every value.
        if isinstance(payload.get("artifacts"), list):
            payload["artifacts"] = tuple(payload["artifacts"])
        if isinstance(payload.get("capability_gaps"), list):
            payload["capability_gaps"] = tuple(payload["capability_gaps"])
        return SharePointProjectSnapshotManifestV1.model_validate(payload, strict=True)
    except (TypeError, ValueError) as exc:
        raise ProjectSnapshotValidationError("invalid ProjectSnapshotBundle manifest v1") from exc


def _validate_artifact_bytes(
    manifest: SharePointProjectSnapshotManifestV1,
    artifact_bytes: Mapping[str, bytes],
) -> dict[str, bytes]:
    if not isinstance(artifact_bytes, Mapping):
        raise ProjectSnapshotValidationError("artifact_bytes must be an in-memory mapping")

    payloads: dict[str, bytes] = {}
    normalized_keys: set[str] = set()
    for raw_path, content in artifact_bytes.items():
        if type(raw_path) is not str:
            raise ProjectSnapshotValidationError(
                "artifact byte keys must be relative strings, never local Path objects"
            )
        try:
            safe_path = _validate_relative_artifact_path(raw_path)
        except ValueError as exc:
            raise ProjectSnapshotValidationError("unsafe artifact byte path") from exc
        normalized = unicodedata.normalize("NFC", safe_path).casefold()
        if normalized in normalized_keys:
            raise ProjectSnapshotValidationError("duplicate artifact byte path")
        normalized_keys.add(normalized)
        if type(content) is not bytes:
            raise ProjectSnapshotValidationError(
                "artifact payloads must be bytes; local paths and symlinks are forbidden"
            )
        payloads[safe_path] = content

    manifest_paths = {artifact.relative_path for artifact in manifest.artifacts}
    if set(payloads) != manifest_paths:
        missing = sorted(manifest_paths - set(payloads))
        extra = sorted(set(payloads) - manifest_paths)
        raise ProjectSnapshotValidationError(
            f"artifact byte set does not match manifest (missing={missing!r}, extra={extra!r})"
        )

    for artifact in manifest.artifacts:
        content = payloads[artifact.relative_path]
        if len(content) != artifact.size_bytes:
            raise ProjectSnapshotValidationError(
                f"artifact size mismatch for {artifact.relative_path!r}"
            )
        if hashlib.sha256(content).hexdigest() != artifact.sha256:
            raise ProjectSnapshotValidationError(
                f"artifact sha256 mismatch for {artifact.relative_path!r}"
            )
    return payloads


def _validate_relative_artifact_path(value: str) -> str:
    if value != unicodedata.normalize("NFC", value):
        raise ValueError("relative_path must use NFC Unicode normalization")
    if value.startswith(("/", "\\")) or _WINDOWS_DRIVE_RE.match(value):
        raise ValueError("absolute artifact paths are forbidden")
    if "\\" in value or "://" in value or value.lower().startswith("file:"):
        raise ValueError("local or URL-like artifact paths are forbidden")
    path = PurePosixPath(value)
    parts = path.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("artifact paths must be normalized and traversal-free")
    if path.as_posix() != value or value.endswith("/"):
        raise ValueError("artifact paths must be normalized POSIX relative paths")
    if value.casefold() == _RESERVED_MANIFEST_PATH.casefold():
        raise ValueError(f"{_RESERVED_MANIFEST_PATH!r} is reserved")
    for part in parts:
        _validate_sharepoint_segment(part)
    return value


def _validate_artifact_hierarchy(
    artifacts: tuple[ProjectSnapshotArtifactV1, ...],
) -> None:
    nodes: dict[str, tuple[str, Literal["folder", "artifact"]]] = {}
    for artifact in artifacts:
        parts = PurePosixPath(artifact.relative_path).parts
        for index in range(1, len(parts)):
            folder = "/".join(parts[:index])
            normalized = unicodedata.normalize("NFC", folder).casefold()
            existing = nodes.get(normalized)
            if existing and (existing[0] != folder or existing[1] != "folder"):
                raise ValueError(f"ambiguous SharePoint artifact hierarchy at {folder!r}")
            nodes[normalized] = (folder, "folder")

        normalized_artifact = unicodedata.normalize("NFC", artifact.relative_path).casefold()
        existing = nodes.get(normalized_artifact)
        if existing:
            raise ValueError(f"duplicate or colliding artifact path {artifact.relative_path!r}")
        nodes[normalized_artifact] = (artifact.relative_path, "artifact")


def _validate_remote_root(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProjectSnapshotValidationError("target_root must be a non-empty SharePoint path")
    if "\\" in value or _WINDOWS_DRIVE_RE.match(value) or "://" in value:
        raise ProjectSnapshotValidationError("target_root must be a SharePoint drive path")
    stripped = value.strip("/")
    if not stripped:
        return "/"
    parts = PurePosixPath(stripped).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ProjectSnapshotValidationError("target_root must be normalized and traversal-free")
    try:
        for part in parts:
            _validate_sharepoint_segment(part)
    except ValueError as exc:
        raise ProjectSnapshotValidationError("target_root contains an unsafe segment") from exc
    normalized = "/" + "/".join(parts)
    if len(normalized) > _MAX_REMOTE_PATH_LENGTH:
        raise ProjectSnapshotValidationError("target_root exceeds SharePoint path limit")
    return normalized


def _validate_sharepoint_segment(value: str) -> None:
    if not value or value != value.strip() or value.endswith("."):
        raise ValueError("SharePoint path segments must be non-empty and trimmed")
    if any(char in _INVALID_SHAREPOINT_CHARS or ord(char) < 32 for char in value):
        raise ValueError("SharePoint path segment contains an unsafe character")


def _validate_trimmed_text(value: str) -> str:
    if value != value.strip() or any(ord(char) < 32 for char in value):
        raise ValueError("value must be trimmed and contain no control characters")
    return value


def _project_folder_name(manifest: SharePointProjectSnapshotManifestV1) -> str:
    slug = _folder_token(manifest.project.name, fallback="project")
    identity_hash = hashlib.sha256(manifest.project.id.encode("utf-8")).hexdigest()[:12]
    return f"project--{slug[:80]}--{identity_hash}"


def _snapshot_folder_name(manifest: SharePointProjectSnapshotManifestV1) -> str:
    correlation_hash = hashlib.sha256(manifest.correlation_id.encode("utf-8")).hexdigest()[:12]
    return f"snapshot--{manifest.content_hash[:24]}--{correlation_hash}"


def _folder_token(value: str, *, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    token = _SAFE_TOKEN_RE.sub("-", normalized.casefold()).strip(".-_")
    return token or fallback


def _join_remote(parent: str, child: str) -> str:
    path = "/" + "/".join(part for part in (parent.strip("/"), child.strip("/")) if part)
    if len(path) > _MAX_REMOTE_PATH_LENGTH:
        raise ProjectSnapshotValidationError("composed SharePoint path exceeds path limit")
    return path


def _required_folders(
    remote_root: str,
    project_folder_name: str,
    snapshot_folder_name: str,
    artifacts: tuple[ProjectSnapshotArtifactV1, ...],
) -> list[tuple[str, str, str]]:
    project_folder = _join_remote(remote_root, project_folder_name)
    snapshot_folder = _join_remote(project_folder, snapshot_folder_name)
    folders: list[tuple[str, str, str]] = [
        (remote_root, project_folder_name, project_folder),
        (project_folder, snapshot_folder_name, snapshot_folder),
    ]
    relative_directories: set[str] = set()
    for artifact in artifacts:
        parent = PurePosixPath(artifact.relative_path).parent
        current = PurePosixPath()
        if parent.as_posix() == ".":
            continue
        for part in parent.parts:
            current /= part
            relative_directories.add(current.as_posix())
    for relative in sorted(relative_directories, key=lambda path: (path.count("/"), path)):
        relative_path = PurePosixPath(relative)
        parent_relative = relative_path.parent.as_posix()
        parent_path = (
            snapshot_folder
            if parent_relative == "."
            else _join_remote(snapshot_folder, parent_relative)
        )
        remote_path = _join_remote(snapshot_folder, relative)
        folders.append((parent_path, relative_path.name, remote_path))
    return folders


def _relative_to_snapshot(remote_path: str, snapshot_folder: str) -> str:
    if remote_path == snapshot_folder:
        return "."
    prefix = f"{snapshot_folder}/"
    if remote_path.startswith(prefix):
        return remote_path[len(prefix) :]
    return remote_path


def _canonical_manifest_bytes(manifest: SharePointProjectSnapshotManifestV1) -> bytes:
    payload = manifest.model_dump(mode="json")
    payload["artifacts"] = sorted(
        payload["artifacts"],
        key=lambda artifact: artifact["relative_path"],
    )
    return json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _base_metadata(manifest: SharePointProjectSnapshotManifestV1) -> dict[str, str]:
    return {
        "IVSchemaVersion": manifest.schema_version,
        "IVBundleType": manifest.bundle_type,
        "IVProjectId": manifest.project.id,
        "IVProjectName": manifest.project.name,
        "IVSourceSystem": manifest.project.source_system,
        "IVProfileId": manifest.profile.id,
        "IVSnapshotStatus": manifest.status,
        "IVCorrelationId": manifest.correlation_id,
        "IVBundleSha256": manifest.content_hash,
        "IVTargetKind": "mock_target",
    }


def _is_below_any(path: str, roots: set[str]) -> bool:
    return any(path == root or path.startswith(f"{root}/") for root in roots)


def _is_conflict(exc: BaseException) -> bool:
    return isinstance(exc, AdapterTerminalError) and (
        "409" in str(exc) or "konflikt" in str(exc).casefold()
    )


def _is_retryable(exc: BaseException) -> bool:
    return is_retryable_error(exc)


def _overall_status(
    items: list[ProjectSnapshotUploadItemResult],
    *,
    dry_run: bool,
) -> UploadStatus:
    if any(item.status == "conflict" for item in items):
        return "conflict"
    if any(item.status in {"failed", "skipped"} for item in items):
        return "partial_failure"
    return "dry_run" if dry_run else "uploaded"
