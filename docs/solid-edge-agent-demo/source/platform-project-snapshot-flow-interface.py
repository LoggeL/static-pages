from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from iv_connect.adapters.com.microsoft365.project_snapshot import (
    ProjectSnapshotArtifactV1,
    ProjectSnapshotCapabilityGapV1,
    ProjectSnapshotProfileV1,
    ProjectSnapshotProjectV1,
)

FlowPhase = Literal[
    "preview",
    "publishing",
    "verifying",
    "succeeded",
    "needs_attention",
    "cancelled",
]
FlowOwnershipPhase = Literal[
    "reserved",
    "abandoned",
    "preview",
    "publishing",
    "verifying",
    "succeeded",
    "needs_attention",
    "cancelled",
]
FlowChoice = Literal["confirm_default", "cancel", "retry_failed"]


class FlowUiRequestV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    allowed_responses: tuple[FlowChoice, ...]
    decision_authority: Literal["user"]


class FlowProjectV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    source_name: str


class FlowTargetV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["sharepoint_mock_target", "aras"]
    display_name: str
    required: bool = True
    target_version: str = Field(pattern=r"^[0-9a-f]{64}$")


class FlowArtifactSummaryV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    native: int = Field(ge=0)
    generated: int = Field(ge=0)
    content_hash: str


class FlowCapabilityGapV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: str
    required: bool
    reason: str


class FlowDeviationV1(BaseModel):
    """One concrete preview difference that can be acknowledged by stable ID."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^gap-[0-9a-f]{16}$")
    capability: str
    disposition: Literal["excluded", "blocked"]
    reason: str
    required: bool
    requires_confirmation: bool


class FlowPreviewV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project: FlowProjectV1
    profile: str
    default_targets: tuple[FlowTargetV1, ...]
    artifact_summary: FlowArtifactSummaryV1
    capability_gaps: tuple[FlowCapabilityGapV1, ...]
    decision_authority: Literal["user"]
    deviations: tuple[FlowDeviationV1, ...] = ()
    policy_outcome: Literal["allow", "require_review", "deny"]


class FlowTargetReceiptV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: Literal["sharepoint_mock_target", "aras"]
    status: Literal["verified", "failed", "retry_pending", "skipped"]
    external_reference: str | None = None
    retryable: bool = False
    error_code: str | None = None


class FlowResultV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["verified", "partial_failure", "failed", "cancelled"]
    snapshot_id: str
    content_hash: str
    target_receipts: tuple[FlowTargetReceiptV1, ...]


class FlowAttentionV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    retryable: bool


class ProjectSnapshotFlowViewV1(BaseModel):
    """The complete, redacted projection consumed by the Dialog Host."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    flow_id: str
    revision: str
    phase: FlowPhase
    ui_request: FlowUiRequestV1 | None = None
    preview: FlowPreviewV1 | None = None
    result: FlowResultV1 | None = None
    attention: FlowAttentionV1 | None = None


class ProjectSnapshotFlowReservationRequestV1(BaseModel):
    """Deterministic ownership handshake completed before bundle upload."""

    model_config = ConfigDict(extra="forbid", strict=True)

    correlation_id: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )


class ProjectSnapshotFlowReservationV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    flow_id: str
    correlation_id: str
    revision: str
    phase: FlowOwnershipPhase


class ProjectSnapshotFlowAbandonmentV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    flow_id: str
    accepted: bool
    phase: FlowOwnershipPhase | None = None


class ProjectSnapshotFlowListItemV1(ProjectSnapshotFlowViewV1):
    """Studio list projection with durable ordering timestamps."""

    created_at: str
    updated_at: str


class ProjectSnapshotFlowCollectionV1(BaseModel):
    """Workspace-scoped, redacted read model for Studio operations views."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    items: tuple[ProjectSnapshotFlowListItemV1, ...]


class ProjectSnapshotBundleViewV1(BaseModel):
    """Validated manifest projection; artifact bytes and storage paths stay private."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    bundle_type: Literal["project_snapshot"] = "project_snapshot"
    flow_id: str
    revision: str
    phase: FlowPhase
    correlation_id: str
    created_at: str
    status: Literal["verified", "partial"]
    project: ProjectSnapshotProjectV1
    profile: ProjectSnapshotProfileV1
    artifacts: tuple[ProjectSnapshotArtifactV1, ...]
    capability_gaps: tuple[ProjectSnapshotCapabilityGapV1, ...]
    content_hash: str


class ProjectSnapshotFlowResponseV1(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    request_id: str = Field(min_length=1, max_length=80)
    expected_revision: str = Field(pattern=r"^[1-9][0-9]*$")
    choice: FlowChoice
    decision_authority: Literal["user"]
    confirmed_deviation_ids: list[str] = Field(default_factory=list, max_length=1_000)
