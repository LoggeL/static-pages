"""Dependency-free validator for the iV CAD Connector Contract V1.

The JSON schema remains the source of truth for document shape.  This module
implements only the Draft 2020-12 keywords used by the checked-in schema and
adds the cross-reference and fail-closed checks described by the contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

REQUIRED_FAIL_CLOSED_CODES = frozenset(
    f"CAD-FC-{number:03d}" for number in range(1, 15)
)
QUALITY_RANK = {
    "conflicting": 0,
    "unavailable": 1,
    "inferred": 2,
    "source_observed": 3,
    "derived_verified": 4,
    "source_verified": 5,
}


@dataclass(frozen=True)
class Finding:
    code: str
    path: str
    message: str
    severity: str = "error"


@dataclass
class ValidationResult:
    document: str
    document_kind: str
    errors: list[Finding]
    warnings: list[Finding]

    @property
    def valid(self) -> bool:
        return not self.errors

    def as_json(self) -> dict[str, Any]:
        return {
            "document": self.document,
            "document_kind": self.document_kind,
            "valid": self.valid,
            "errors": [asdict(item) for item in self.errors],
            "warnings": [asdict(item) for item in self.warnings],
        }


class SchemaValidator:
    """Small schema adapter covering every keyword used by the V1 schema."""

    def __init__(self, schema: dict[str, Any]) -> None:
        self.schema = schema

    def validate(self, instance: Any) -> list[Finding]:
        findings: list[Finding] = []
        self._validate(instance, self.schema, "$", findings)
        return findings

    def _validate(
        self,
        instance: Any,
        schema: Any,
        path: str,
        findings: list[Finding],
    ) -> None:
        if schema is True:
            return
        if schema is False:
            findings.append(
                Finding("schema.false", path, "Value is prohibited by the schema.")
            )
            return
        if not isinstance(schema, dict):
            findings.append(
                Finding(
                    "schema.invalid", path, "Schema node must be an object or boolean."
                )
            )
            return

        if "$ref" in schema:
            self._validate(instance, self._resolve_ref(schema["$ref"]), path, findings)
            return

        one_of = schema.get("oneOf")
        if one_of is not None:
            candidate_findings: list[list[Finding]] = []
            for candidate in one_of:
                branch_findings: list[Finding] = []
                self._validate(instance, candidate, path, branch_findings)
                candidate_findings.append(branch_findings)
            matches = sum(
                1 for branch_findings in candidate_findings if not branch_findings
            )
            if matches != 1:
                findings.append(
                    Finding(
                        "schema.one_of",
                        path,
                        f"Value must match exactly one schema branch; matched {matches}.",
                    )
                )
                if matches == 0 and candidate_findings:
                    findings.extend(min(candidate_findings, key=len))
                return

        for candidate in schema.get("allOf", []):
            self._validate(instance, candidate, path, findings)

        condition = schema.get("if")
        if condition is not None and self._matches(instance, condition):
            self._validate(instance, schema.get("then", True), path, findings)

        if "not" in schema and self._matches(instance, schema["not"]):
            findings.append(
                Finding("schema.not", path, "Value matches a prohibited schema.")
            )

        if "const" in schema and instance != schema["const"]:
            findings.append(
                Finding("schema.const", path, f"Expected {schema['const']!r}.")
            )
        if "enum" in schema and instance not in schema["enum"]:
            findings.append(
                Finding(
                    "schema.enum",
                    path,
                    f"Value {instance!r} is not in the allowed set.",
                )
            )

        expected_type = schema.get("type")
        if expected_type is not None and not self._has_type(instance, expected_type):
            findings.append(
                Finding("schema.type", path, f"Expected JSON type {expected_type}.")
            )
            return

        if isinstance(instance, dict):
            required = schema.get("required", [])
            for name in required:
                if name not in instance:
                    findings.append(
                        Finding(
                            "schema.required",
                            f"{path}.{name}",
                            "Required property is missing.",
                        )
                    )
            properties = schema.get("properties", {})
            for name, value in instance.items():
                child_path = f"{path}.{name}"
                if name in properties:
                    self._validate(value, properties[name], child_path, findings)
                elif schema.get("additionalProperties") is False:
                    findings.append(
                        Finding(
                            "schema.additional_property",
                            child_path,
                            "Property is not allowed.",
                        )
                    )

        if isinstance(instance, list):
            if len(instance) < schema.get("minItems", 0):
                findings.append(
                    Finding("schema.min_items", path, "Array contains too few items.")
                )
            if schema.get("uniqueItems"):
                fingerprints = [
                    json.dumps(value, sort_keys=True, separators=(",", ":"))
                    for value in instance
                ]
                if len(fingerprints) != len(set(fingerprints)):
                    findings.append(
                        Finding(
                            "schema.unique_items", path, "Array items must be unique."
                        )
                    )
            item_schema = schema.get("items")
            if item_schema is not None:
                for index, value in enumerate(instance):
                    self._validate(value, item_schema, f"{path}[{index}]", findings)

        if isinstance(instance, str):
            if len(instance) < schema.get("minLength", 0):
                findings.append(
                    Finding("schema.min_length", path, "String is too short.")
                )
            if len(instance) > schema.get("maxLength", sys.maxsize):
                findings.append(
                    Finding("schema.max_length", path, "String is too long.")
                )
            pattern = schema.get("pattern")
            if pattern is not None and re.search(pattern, instance) is None:
                findings.append(
                    Finding(
                        "schema.pattern", path, f"String does not match {pattern!r}."
                    )
                )
            if schema.get("format") == "uuid" and not _is_uuid(instance):
                findings.append(
                    Finding("schema.format_uuid", path, "String is not a UUID.")
                )
            if schema.get("format") == "date-time" and not _is_datetime(instance):
                findings.append(
                    Finding(
                        "schema.format_datetime",
                        path,
                        "String is not an RFC 3339 date-time.",
                    )
                )

        if _is_number(instance):
            if instance < schema.get("minimum", instance):
                findings.append(
                    Finding("schema.minimum", path, "Number is below the minimum.")
                )
            if instance > schema.get("maximum", instance):
                findings.append(
                    Finding("schema.maximum", path, "Number is above the maximum.")
                )

    def _matches(self, instance: Any, schema: Any) -> bool:
        findings: list[Finding] = []
        self._validate(instance, schema, "$", findings)
        return not findings

    def _resolve_ref(self, reference: str) -> Any:
        if not reference.startswith("#/"):
            raise ValueError(f"Only local JSON pointers are supported: {reference}")
        current: Any = self.schema
        for raw_segment in reference[2:].split("/"):
            segment = raw_segment.replace("~1", "/").replace("~0", "~")
            current = current[segment]
        return current

    @staticmethod
    def _has_type(instance: Any, expected: str) -> bool:
        return {
            "object": isinstance(instance, dict),
            "array": isinstance(instance, list),
            "string": isinstance(instance, str),
            "boolean": isinstance(instance, bool),
            "integer": isinstance(instance, int) and not isinstance(instance, bool),
            "number": _is_number(instance),
        }.get(expected, False)


class ConformanceValidator:
    """Validate V1 documents through one manufacturer-neutral interface."""

    def __init__(self, schema: dict[str, Any]) -> None:
        self.schema_validator = SchemaValidator(schema)

    def validate(
        self,
        document: dict[str, Any],
        *,
        name: str = "<memory>",
        manifest: dict[str, Any] | None = None,
    ) -> ValidationResult:
        errors = self.schema_validator.validate(document)
        warnings: list[Finding] = []
        kind = (
            str(document.get("document_kind", "unknown"))
            if isinstance(document, dict)
            else "unknown"
        )
        if kind == "capability_manifest":
            self._manifest_semantics(document, errors, warnings)
        elif kind == "capture_receipt":
            self._receipt_semantics(document, manifest, errors, warnings)
        else:
            errors.append(
                Finding(
                    "contract.document_kind",
                    "$.document_kind",
                    "Unsupported document kind.",
                )
            )
        return ValidationResult(
            name, kind, _deduplicate(errors), _deduplicate(warnings)
        )

    def _manifest_semantics(
        self,
        document: dict[str, Any],
        errors: list[Finding],
        warnings: list[Finding],
    ) -> None:
        start_modes = _index(document.get("start_modes"), "id", "$.start_modes", errors)
        routes = _index(document.get("routes"), "id", "$.routes", errors)
        capabilities = _index(
            document.get("capabilities"), "id", "$.capabilities", errors
        )
        profiles = _index(document.get("profiles"), "id", "$.profiles", errors)
        fail_closed = _index(
            document.get("fail_closed"), "code", "$.fail_closed", errors
        )

        missing_fail_closed = sorted(REQUIRED_FAIL_CLOSED_CODES - set(fail_closed))
        if missing_fail_closed:
            errors.append(
                Finding(
                    "contract.fail_closed_registry_incomplete",
                    "$.fail_closed",
                    "Missing required rules: " + ", ".join(missing_fail_closed),
                )
            )

        environment_fingerprint = _nested(document, "environment", "fingerprint")
        for route_id, route in routes.items():
            route_path = f"$.routes[{route_id}]"
            for mode in _strings(route.get("allowed_start_modes")):
                if mode not in start_modes:
                    errors.append(
                        Finding(
                            "contract.unresolved_start_mode",
                            route_path,
                            f"Unknown start mode {mode!r}.",
                        )
                    )
            for capability_id in _strings(route.get("capabilities")):
                if capability_id not in capabilities:
                    errors.append(
                        Finding(
                            "contract.unresolved_capability",
                            route_path,
                            f"Unknown capability {capability_id!r}.",
                        )
                    )
            for index, baseline in enumerate(
                _objects(route.get("performance_baselines"))
            ):
                baseline_path = f"{route_path}.performance_baselines[{index}]"
                operation = baseline.get("operation")
                if operation not in route.get("capabilities", []):
                    errors.append(
                        Finding(
                            "contract.performance_operation",
                            baseline_path,
                            "Operation is not advertised by the route.",
                        )
                    )
                if baseline.get("start_mode") not in route.get(
                    "allowed_start_modes", []
                ):
                    errors.append(
                        Finding(
                            "contract.performance_start_mode",
                            baseline_path,
                            "Start mode is not allowed by the route.",
                        )
                    )
                if baseline.get("environment_fingerprint") != environment_fingerprint:
                    errors.append(
                        Finding(
                            "contract.environment_mismatch",
                            baseline_path,
                            "Environment fingerprint differs from the manifest.",
                        )
                    )
                p50, p95, maximum = (
                    baseline.get("p50_ms"),
                    baseline.get("p95_ms"),
                    baseline.get("max_ms"),
                )
                if all(_is_number(value) for value in (p50, p95, maximum)) and not (
                    p50 <= p95 <= maximum
                ):
                    errors.append(
                        Finding(
                            "contract.performance_order",
                            baseline_path,
                            "Expected p50_ms <= p95_ms <= max_ms.",
                        )
                    )
                if (
                    isinstance(baseline.get("sample_count"), int)
                    and baseline["sample_count"] < 10
                ):
                    warnings.append(
                        Finding(
                            "contract.performance_sample_count",
                            baseline_path,
                            "Fewer than ten measured samples; only a declared large-assembly exception may use five.",
                            "warning",
                        )
                    )

        for capability_id, capability in capabilities.items():
            capability_path = f"$.capabilities[{capability_id}]"
            primary = capability.get("primary_route")
            if primary is not None:
                self._route_supports(
                    primary, capability_id, routes, capability_path, errors
                )
            for fallback in _strings(capability.get("fallback_routes")):
                self._route_supports(
                    fallback, capability_id, routes, capability_path, errors
                )

        for profile_id, profile in profiles.items():
            profile_path = f"$.profiles[{profile_id}]"
            required = set(_strings(profile.get("required_capabilities")))
            optional = set(_strings(profile.get("optional_capabilities")))
            overlap = sorted(required & optional)
            if overlap:
                errors.append(
                    Finding(
                        "contract.profile_overlap",
                        profile_path,
                        "Capabilities are both required and optional: "
                        + ", ".join(overlap),
                    )
                )
            for capability_id in sorted(required | optional):
                if capability_id not in capabilities:
                    errors.append(
                        Finding(
                            "contract.unresolved_capability",
                            profile_path,
                            f"Unknown capability {capability_id!r}.",
                        )
                    )
            unavailable = sorted(
                capability_id
                for capability_id in required
                if capability_id in capabilities
                and capabilities[capability_id].get("status") != "verified"
            )
            if unavailable:
                warnings.append(
                    Finding(
                        "CAD-FC-001",
                        profile_path,
                        "Profile is correctly declared but not currently releasable; required capabilities are not verified: "
                        + ", ".join(unavailable),
                        "warning",
                    )
                )

    @staticmethod
    def _route_supports(
        route_id: Any,
        capability_id: str,
        routes: dict[str, dict[str, Any]],
        path: str,
        errors: list[Finding],
    ) -> None:
        route = routes.get(route_id)
        if route is None:
            errors.append(
                Finding(
                    "contract.unresolved_route", path, f"Unknown route {route_id!r}."
                )
            )
        elif capability_id not in route.get("capabilities", []):
            errors.append(
                Finding(
                    "contract.route_capability_mismatch",
                    path,
                    f"Route {route_id!r} does not advertise {capability_id!r}.",
                )
            )

    def _receipt_semantics(
        self,
        document: dict[str, Any],
        manifest: dict[str, Any] | None,
        errors: list[Finding],
        warnings: list[Finding],
    ) -> None:
        selected = _index(
            document.get("selected_routes"), "capability", "$.selected_routes", errors
        )
        results = _index(
            document.get("capability_results"),
            "capability",
            "$.capability_results",
            errors,
        )
        provenance = _index(document.get("provenance"), "id", "$.provenance", errors)
        artifacts = _objects(document.get("artifacts"))
        _index(artifacts, "relative_path", "$.artifacts", errors)

        expected_artifact_count = _nested(document, "entity_counts", "artifacts")
        if isinstance(expected_artifact_count, int) and expected_artifact_count != len(
            artifacts
        ):
            errors.append(
                Finding(
                    "contract.artifact_count",
                    "$.entity_counts.artifacts",
                    "Count does not match the artifacts array.",
                )
            )

        correlation = document.get("correlation_id")
        connector = document.get("connector", {})
        start_mode = document.get("start_mode")
        for provenance_id, item in provenance.items():
            path = f"$.provenance[{provenance_id}]"
            if item.get("correlation_id") != correlation:
                errors.append(
                    Finding(
                        "contract.correlation_mismatch",
                        path,
                        "Provenance correlation_id differs from the receipt.",
                    )
                )
            if item.get("connector_id") != connector.get("id") or item.get(
                "connector_version"
            ) != connector.get("connector_version"):
                errors.append(
                    Finding(
                        "contract.connector_mismatch",
                        path,
                        "Provenance connector identity differs from the receipt.",
                    )
                )
            if item.get("start_mode") != start_mode:
                errors.append(
                    Finding(
                        "contract.start_mode_mismatch",
                        path,
                        "Provenance start_mode differs from the receipt.",
                    )
                )

        for index, artifact in enumerate(artifacts):
            path = f"$.artifacts[{index}]"
            if artifact.get("provenance_ref") not in provenance:
                errors.append(
                    Finding(
                        "contract.unresolved_provenance",
                        path,
                        "Artifact provenance_ref is unresolved.",
                    )
                )
            if document.get("status") == "verified" and any(
                check.get("status") == "failed"
                for check in _objects(artifact.get("checks"))
            ):
                errors.append(
                    Finding(
                        "CAD-FC-008",
                        path,
                        "Verified receipt contains a failed artifact check.",
                    )
                )

        if document.get("status") in {"verified", "partial"} and document.get(
            "source_revision_before"
        ) != document.get("source_revision_after"):
            errors.append(
                Finding("CAD-FC-005", "$", "Source revision changed during capture.")
            )
        if document.get("status") == "verified" and any(
            item.get("severity") == "blocking"
            for item in _objects(document.get("findings"))
        ):
            errors.append(
                Finding(
                    "contract.blocking_finding",
                    "$.findings",
                    "Verified receipt contains a blocking finding.",
                )
            )

        for capability_id, result in results.items():
            path = f"$.capability_results[{capability_id}]"
            if result.get("status") == "fulfilled" and capability_id not in selected:
                errors.append(
                    Finding(
                        "contract.route_not_selected",
                        path,
                        "Fulfilled capability has no selected route.",
                    )
                )
            if result.get("status") == "fulfilled" and result.get("quality") in {
                "unavailable",
                "conflicting",
            }:
                errors.append(
                    Finding(
                        "contract.fulfilled_quality",
                        path,
                        "Fulfilled capability has an unusable quality.",
                    )
                )
            if (
                result.get("route_id") is not None
                and capability_id in selected
                and result.get("route_id") != selected[capability_id].get("route_id")
            ):
                errors.append(
                    Finding(
                        "contract.route_result_mismatch",
                        path,
                        "Result route_id differs from selected route.",
                    )
                )

        for capability_id, selection in selected.items():
            path = f"$.selected_routes[{capability_id}]"
            if selection.get("fallback_used") and not selection.get(
                "fallback_error_code"
            ):
                errors.append(
                    Finding(
                        "CAD-FC-003",
                        path,
                        "Fallback use requires the original fallback_error_code.",
                    )
                )

        if manifest is None:
            warnings.append(
                Finding(
                    "contract.manifest_missing",
                    "$",
                    "Receipt was not cross-checked against a capability manifest.",
                    "warning",
                )
            )
            return
        self._receipt_against_manifest(
            document, manifest, selected, results, provenance, errors
        )

    def _receipt_against_manifest(
        self,
        receipt: dict[str, Any],
        manifest: dict[str, Any],
        selected: dict[str, dict[str, Any]],
        results: dict[str, dict[str, Any]],
        provenance: dict[str, dict[str, Any]],
        errors: list[Finding],
    ) -> None:
        routes = _index(manifest.get("routes"), "id", "manifest.routes", errors)
        capabilities = _index(
            manifest.get("capabilities"), "id", "manifest.capabilities", errors
        )
        profiles = _index(manifest.get("profiles"), "id", "manifest.profiles", errors)
        start_modes = _index(
            manifest.get("start_modes"), "id", "manifest.start_modes", errors
        )

        if receipt.get("connector") != manifest.get("connector"):
            errors.append(
                Finding(
                    "contract.connector_mismatch",
                    "$.connector",
                    "Receipt connector differs from the manifest.",
                )
            )
        if receipt.get("environment_fingerprint") != _nested(
            manifest, "environment", "fingerprint"
        ):
            errors.append(
                Finding(
                    "contract.environment_mismatch",
                    "$.environment_fingerprint",
                    "Receipt environment differs from the manifest.",
                )
            )
        if receipt.get("start_mode") not in start_modes:
            errors.append(
                Finding(
                    "CAD-FC-002",
                    "$.start_mode",
                    "Start mode is not declared by the manifest.",
                )
            )

        profile = profiles.get(receipt.get("profile_id"))
        if profile is None:
            errors.append(
                Finding(
                    "contract.unresolved_profile",
                    "$.profile_id",
                    "Profile is not declared by the manifest.",
                )
            )
        else:
            for capability_id in _strings(profile.get("required_capabilities")):
                result = results.get(capability_id)
                if result is None or result.get("status") != "fulfilled":
                    errors.append(
                        Finding(
                            "CAD-FC-001",
                            "$.capability_results",
                            f"Required capability {capability_id!r} is not fulfilled.",
                        )
                    )

        for capability_id, selection in selected.items():
            path = f"$.selected_routes[{capability_id}]"
            route_id = selection.get("route_id")
            route = routes.get(route_id)
            capability = capabilities.get(capability_id)
            if route is None or capability is None:
                errors.append(
                    Finding(
                        "contract.unresolved_reference",
                        path,
                        "Selected route or capability is absent from the manifest.",
                    )
                )
                continue
            if capability_id not in route.get("capabilities", []) or receipt.get(
                "start_mode"
            ) not in route.get("allowed_start_modes", []):
                errors.append(
                    Finding(
                        "CAD-FC-002",
                        path,
                        "Selected route is not valid for the capability and start mode.",
                    )
                )
            declared_routes = {
                capability.get("primary_route"),
                *_strings(capability.get("fallback_routes")),
            }
            if route_id not in declared_routes:
                errors.append(
                    Finding(
                        "CAD-FC-003",
                        path,
                        "Selected route is not a declared primary or fallback route.",
                    )
                )
            if selection.get("fallback_used") and route_id not in capability.get(
                "fallback_routes", []
            ):
                errors.append(
                    Finding(
                        "CAD-FC-003",
                        path,
                        "fallback_used is true for a non-fallback route.",
                    )
                )
            result = results.get(capability_id)
            if result is not None:
                quality = result.get("quality")
                ceiling = capability.get("quality_ceiling")
                if (
                    quality in QUALITY_RANK
                    and ceiling in QUALITY_RANK
                    and QUALITY_RANK[quality] > QUALITY_RANK[ceiling]
                ):
                    errors.append(
                        Finding(
                            "contract.quality_ceiling",
                            path,
                            f"Result quality {quality!r} exceeds ceiling {ceiling!r}.",
                        )
                    )

        for provenance_id, item in provenance.items():
            if item.get("route_id") not in routes:
                errors.append(
                    Finding(
                        "contract.unresolved_route",
                        f"$.provenance[{provenance_id}]",
                        "Provenance route is absent from the manifest.",
                    )
                )


def validate_files(
    schema_path: Path, document_paths: Sequence[Path]
) -> list[ValidationResult]:
    schema = _load_json(schema_path)
    documents = [(path, _load_json(path)) for path in document_paths]
    manifests = [
        document
        for _, document in documents
        if document.get("document_kind") == "capability_manifest"
    ]
    manifest = manifests[0] if len(manifests) == 1 else None
    validator = ConformanceValidator(schema)
    return [
        validator.validate(
            document,
            name=str(path),
            manifest=None if document is manifest else manifest,
        )
        for path, document in documents
    ]


def _index(
    values: Any,
    key: str,
    path: str,
    errors: list[Finding],
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for index, value in enumerate(_objects(values)):
        identifier = value.get(key)
        if not isinstance(identifier, str):
            continue
        if identifier in result:
            errors.append(
                Finding(
                    "contract.duplicate_id",
                    f"{path}[{index}].{key}",
                    f"Duplicate identifier {identifier!r}.",
                )
            )
        else:
            result[identifier] = value
    return result


def _objects(value: Any) -> list[dict[str, Any]]:
    return (
        [item for item in value if isinstance(item, dict)]
        if isinstance(value, list)
        else []
    )


def _strings(value: Any) -> list[str]:
    return (
        [item for item in value if isinstance(item, str)]
        if isinstance(value, list)
        else []
    )


def _nested(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False


def _is_datetime(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.tzinfo is not None
    except (ValueError, AttributeError):
        return False


def _deduplicate(findings: Iterable[Finding]) -> list[Finding]:
    return list(dict.fromkeys(findings))


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("documents", nargs="+", type=Path)
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("docs/architecture/cad-connector-contract-v1.schema.json"),
    )
    parser.add_argument(
        "--strict", action="store_true", help="Treat warnings as failures."
    )
    args = parser.parse_args(argv)
    try:
        results = validate_files(args.schema, args.documents)
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(
            json.dumps(
                {"valid": False, "fatal_error": str(exc)}, ensure_ascii=False, indent=2
            )
        )
        return 2
    payload = {
        "contract_id": "cad-connector-v1",
        "valid": all(
            result.valid and (not args.strict or not result.warnings)
            for result in results
        ),
        "results": [result.as_json() for result in results],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
