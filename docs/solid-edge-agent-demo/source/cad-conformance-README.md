# CAD Connector V1 conformance validator

This directory contains a dependency-free validator for the checked-in
manufacturer-neutral CAD connector contract. It validates both JSON Schema
shape and the semantic references that JSON Schema cannot express.

Run the checked-in Solid Edge example:

```bash
python3 tooling/cad-conformance/validator.py \
  docs/architecture/cad-connector-solid-edge-2026.example.json
```

Validate a manifest and one or more receipts together to enable route,
profile, connector, environment, quality and provenance cross-checks:

```bash
python3 tooling/cad-conformance/validator.py \
  path/to/capability-manifest.json \
  path/to/capture-receipt.json
```

Warnings describe evidence/readiness gaps without making an honest capability
manifest structurally invalid. Use `--strict` when those warnings should fail a
release gate.

Run tests:

```bash
python3 -m unittest discover -s tooling/cad-conformance -p 'test_*.py' -v
```

The embedded schema adapter intentionally supports exactly the Draft 2020-12
keywords used by `docs/architecture/cad-connector-contract-v1.schema.json`.
Tests must be extended if the contract adopts another schema keyword.
