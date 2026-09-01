# ADR-020: Approval Provenance v2 Subject Schema Exact-Bytes Binding

- **Status:** Accepted for the Code F QICR
- **Date:** 2026-09-01
- **Decision owner:** Code F / Quality, Release & Compliance Continuous Owner

## Context

Approval Provenance v1 bound subject type, ID, schema version and subject
bytes, but could not express or verify the exact schema bytes used to interpret
those subjects. Adding a field to v1 would silently change historical
semantics, so this is a versioned contract defect rather than a v1 migration.

The reviewed Code C subjects remain frozen at:

```text
CODE_C_HEAD: ce5590e262a522e1ebff6039c6acae7423a3e778
MAIN_QUALITY_BASELINE: 849e386862c042619357d284b71f9c6d2b27c130
REVIEW_BUNDLE_ID: code-c-python-inventory-review-ce5590e262a5-a809279fe384ac9b
REVIEW_BUNDLE_SHA256: a809279fe384ac9b2360faf31c9978d035583467c21e480748316b3b4b5d8b8a
```

## Decision

Approval Provenance v2 adds required `subject_schema_id` and
`subject_schema_sha256` fields. The schema SHA is a lower-case SHA-256 of the
raw schema file and participates in canonical approval bytes, approval hashes,
snapshot entries and exact-subject equality. Canonicalization remains
`json-utf8-lf-v1`.

The verifier uses a shared-main trusted binding map keyed by subject type and
subject schema version. It reads the mapped file, checks its `$id`, rejects
external `$ref` values, recomputes the raw-byte SHA-256 and compares that
identity with both the Approval and its Review Snapshot. Self-asserted subject
or approval values are therefore not authority.

Both current subject contracts are self-contained:

```text
PYTHON_ARTIFACT_INVENTORY v3:
  https://local.app/schemas/compliance/python-artifact-inventory/v3/inventory.schema.json
  7a4999d4e31c83f3691ad69be6dc49822c4d0eebd77330964401ae349ae64e0e

TOOLCHAIN_EVIDENCE v1:
  https://local.app/schemas/compliance/python-toolchain-inventory/v1/inventory.schema.json
  b5e1035ccde3adcdffc1dbf1d73418c1585d0e292669020622b9b42acb3e9bd2
```

No subject-side schema, resolver, target descriptor or toolchain evidence
bytes are changed by this QICR. Revocation remains v1 because it references an
exact approval record hash and is decoupled from approval schema version.

## Compatibility and issuance policy

- v1 schemas, verifier behavior and fixtures remain available for historical
  replay.
- New issuance is v2-only; v1 issuance and v1 reuse for the current 4+2 are
  forbidden.
- This QICR creates no Review Snapshot and no Inventory or Toolchain approval.
  Those records are created only after this contract reaches `main`.
- Code C subject regeneration is not required; Code C remains on hold and is
  not notified by this QICR.

## Required negative regressions

The contract tests cover correct binding, wrong or malformed hashes, missing
v2 hash, changed subject bytes, same-version/same-ID schema bytes changed in a
trusted binding, and a self-asserted identity that disagrees with the trusted
main mapping. Transitive-closure drift is not applicable while both contracts
remain self-contained.
