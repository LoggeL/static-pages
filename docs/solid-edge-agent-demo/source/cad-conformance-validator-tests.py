from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from validator import ConformanceValidator

REPO = Path(__file__).resolve().parents[2]
SCHEMA = json.loads(
    (REPO / "docs/architecture/cad-connector-contract-v1.schema.json").read_text()
)
EXAMPLE = json.loads(
    (REPO / "docs/architecture/cad-connector-solid-edge-2026.example.json").read_text()
)
KICAD_EXAMPLE = json.loads(
    (REPO / "docs/architecture/cad-connector-kicad.example.json").read_text()
)


def receipt() -> dict:
    connector = copy.deepcopy(EXAMPLE["connector"])
    fingerprint = EXAMPLE["environment"]["fingerprint"]
    correlation = "de6e093e-0a36-4321-8b51-b470d3f5676b"
    capabilities = [
        (
            "cad.read.project_metadata",
            "source_verified",
            "metadata.json",
            "metadata_json",
            "application/json",
        ),
        (
            "cad.export.native_snapshot",
            "source_verified",
            "source/model.par",
            "native_part",
            "application/octet-stream",
        ),
        (
            "cad.export.neutral_geometry",
            "derived_verified",
            "generated/model.stp",
            "neutral_geometry",
            "model/step",
        ),
    ]
    selected_routes = [
        {
            "capability": capability,
            "route_id": "se.live-com",
            "fallback_used": False,
            "selection_reason": "Verified primary route for the current start mode.",
        }
        for capability, *_ in capabilities
    ]
    capability_results = [
        {
            "capability": capability,
            "status": "fulfilled",
            "route_id": "se.live-com",
            "quality": quality,
            "required": True,
            "checks": [{"code": "capture.readback", "status": "passed"}],
        }
        for capability, quality, *_ in capabilities
    ]
    provenance = []
    artifacts = []
    for index, (capability, quality, path, role, media_type) in enumerate(
        capabilities, start=1
    ):
        provenance_id = f"capture.provenance-{index}"
        provenance.append(
            {
                "id": provenance_id,
                "source_object_urn": f"urn:iv:cad:test:document:{index}",
                "connector_id": connector["id"],
                "connector_version": connector["connector_version"],
                "route_id": "se.live-com",
                "native_type": "test-document",
                "native_path": f"redacted/project/document-{index}",
                "source_revision": "revision-1",
                "start_mode": "interactive_existing_process",
                "saved_state": "saved_disk_backed",
                "observed_at": "2026-08-26T17:00:00Z",
                "correlation_id": correlation,
                "transformations": ["capture.copy-v1"] if index > 1 else [],
                "evidence_refs": [{"kind": "test_run", "ref": f"run/artifact-{index}"}],
            }
        )
        artifacts.append(
            {
                "relative_path": path,
                "role": role,
                "media_type": media_type,
                "origin": "native" if role == "native_part" else "generated",
                "size_bytes": 100 + index,
                "sha256": f"{index:064x}",
                "quality": quality,
                "provenance_ref": provenance_id,
                "checks": [{"code": "artifact.sha256", "status": "passed"}],
            }
        )
    return {
        "document_kind": "capture_receipt",
        "schema_version": "1.0",
        "contract_id": "cad-connector-v1",
        "correlation_id": correlation,
        "captured_at": "2026-08-26T17:00:01Z",
        "status": "verified",
        "profile_id": "cad-part-snapshot-v1",
        "connector": connector,
        "environment_fingerprint": fingerprint,
        "start_mode": "interactive_existing_process",
        "source_consistency": "saved_disk_backed",
        "source_revision_before": "revision-1",
        "source_revision_after": "revision-1",
        "selected_routes": selected_routes,
        "capability_results": capability_results,
        "entity_counts": {
            "projects": 1,
            "documents": 1,
            "part_definitions": 1,
            "component_occurrences": 0,
            "bom_snapshots": 0,
            "bom_positions": 0,
            "artifacts": len(artifacts),
        },
        "artifacts": artifacts,
        "provenance": provenance,
        "findings": [],
        "content_hash": "a" * 64,
    }


class ConformanceValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = ConformanceValidator(SCHEMA)

    def test_checked_in_solid_edge_manifest_is_conformant(self) -> None:
        result = self.validator.validate(EXAMPLE)
        self.assertTrue(result.valid, result.errors)
        self.assertEqual([], result.warnings)

    def test_checked_in_kicad_manifest_uses_the_same_contract(self) -> None:
        result = self.validator.validate(KICAD_EXAMPLE)
        self.assertTrue(result.valid, result.errors)
        self.assertEqual([], result.warnings)

    def test_schema_rejects_unknown_property(self) -> None:
        candidate = copy.deepcopy(EXAMPLE)
        candidate["connector"]["secret_extension"] = True
        result = self.validator.validate(candidate)
        self.assertFalse(result.valid)
        self.assertIn(
            "schema.additional_property", {item.code for item in result.errors}
        )

    def test_manifest_rejects_duplicate_and_unresolved_routes(self) -> None:
        candidate = copy.deepcopy(EXAMPLE)
        candidate["routes"].append(copy.deepcopy(candidate["routes"][0]))
        candidate["capabilities"][0]["fallback_routes"] = ["missing.route"]
        result = self.validator.validate(candidate)
        codes = {item.code for item in result.errors}
        self.assertIn("contract.duplicate_id", codes)
        self.assertIn("contract.unresolved_route", codes)

    def test_manifest_rejects_incomparable_performance_evidence(self) -> None:
        candidate = copy.deepcopy(EXAMPLE)
        baseline = candidate["routes"][1]["performance_baselines"][0]
        baseline["environment_fingerprint"] = "f" * 64
        baseline["p50_ms"], baseline["p95_ms"], baseline["max_ms"] = 10, 9, 8
        result = self.validator.validate(candidate)
        codes = {item.code for item in result.errors}
        self.assertIn("contract.environment_mismatch", codes)
        self.assertIn("contract.performance_order", codes)

    def test_manifest_requires_complete_fail_closed_registry(self) -> None:
        candidate = copy.deepcopy(EXAMPLE)
        candidate["fail_closed"] = candidate["fail_closed"][:-1]
        result = self.validator.validate(candidate)
        self.assertIn(
            "contract.fail_closed_registry_incomplete",
            {item.code for item in result.errors},
        )

    def test_receipt_and_manifest_are_conformant_together(self) -> None:
        result = self.validator.validate(receipt(), manifest=EXAMPLE)
        self.assertTrue(result.valid, result.errors)
        self.assertEqual([], result.warnings)

    def test_receipt_fails_closed_on_revision_and_artifact_failure(self) -> None:
        candidate = receipt()
        candidate["source_revision_after"] = "revision-2"
        candidate["artifacts"][0]["checks"][0]["status"] = "failed"
        result = self.validator.validate(candidate, manifest=EXAMPLE)
        codes = {item.code for item in result.errors}
        self.assertIn("CAD-FC-005", codes)
        self.assertIn("CAD-FC-008", codes)

    def test_receipt_rejects_undeclared_fallback_and_missing_provenance(self) -> None:
        candidate = receipt()
        candidate["selected_routes"][0].update(
            {
                "route_id": "se.ui-diagnostics",
                "fallback_used": True,
                "fallback_error_code": "route.failed",
            }
        )
        candidate["capability_results"][0]["route_id"] = "se.ui-diagnostics"
        candidate["artifacts"][0]["provenance_ref"] = "missing.provenance"
        result = self.validator.validate(candidate, manifest=EXAMPLE)
        codes = {item.code for item in result.errors}
        self.assertIn("CAD-FC-003", codes)
        self.assertIn("contract.unresolved_provenance", codes)


if __name__ == "__main__":
    unittest.main()
