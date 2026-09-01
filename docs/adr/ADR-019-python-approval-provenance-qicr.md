# ADR-019: Python Approval Provenance QICR and Inventory Subject Compatibility

- **Status:** Accepted for the Code F QICR
- **Date:** 2026-09-01
- **Decision owner:** Code F / Quality, Release & Compliance Continuous Owner

## Decision

The current Code C Python Inventory v2 candidates are **not approvable immutable
subjects**. The v2 contract uses `graph_complete: true` as a factual schema
requirement and requires package provenance `review_status: APPROVED`. The
submitted candidates intentionally contain `graph_complete: false` and
`review_status: PENDING`; those values cannot be reinterpreted by an external
approval record without creating a second source of truth. The formal result is:

```text
INVENTORY_V2_IMMUTABLE_SUBJECT_COMPATIBILITY:
REQUIRES_VERSIONED_INVENTORY_MIGRATION
```

Code C remains the producer of the next Inventory subject. Code F must not
rewrite the current v2 bytes, inject approval fields during validation, or issue
an approval for them. After this contract is merged, Code C will regenerate a
v3 candidate from the same reviewed facts and re-run the approval
reconciliation.

## Phase 0 evidence boundary

The decision was made against the exact Code C review bundle and subject bytes:

```text
CODE_C_HEAD: 5bd956b5eae2c8730144acc962ad085719ea250f
MAIN_QUALITY_BASELINE: 7a034a6b0244d1dbff0eae839a5d6ea837a0efe3
REVIEW_BUNDLE_ID: code-c-python-inventory-review-5bd956b5eae2-e6ed884abd8c2397
REVIEW_BUNDLE_SHA256: a3de5d14d1c985413b19950b541a9203c080e97ece4295e8fe3062f3f67c9061
ACTIONS_ARCHIVE_SHA256: e57c30583d30298265523571f971f74df38687b242be70ba4789e5acbf133ad6
```

The four candidate SHA-256 values and the two toolchain evidence SHA-256 values
are recorded in the review snapshot generated for each future approval. Raw
validation uses the subject file itself; no approval projection or validation
time field injection is permitted. Code C did not change the shared v2 schema or
validator.

## v3 subject contract

Inventory v3 is a representation/contract migration, not a dependency
re-resolution. Its factual subject has `subject_state: CANDIDATE`,
`graph_complete: true`, and provenance facts without a review lifecycle field.
Review and approval are external, exact-subject companion records. The
migration is forbidden from changing the artifact set, dependency graph,
resolver provenance, target descriptor, or runtime/build role. A v2 approval is
never reusable for a v3 subject, even when all package facts happen to match;
the schema identity and exact subject bytes are different.

## Approval provenance contract

`schemas/compliance/artifact-approval-provenance/v1/` defines immutable approval,
review-snapshot, authority-policy, and revocation records. Every approval binds
the exact subject SHA, target descriptor SHA, review snapshot SHA, authority
policy SHA, reviewer identity/role/authority, scope, decision, expiry and
recheck triggers. Records use the repository canonicalization
`json-utf8-lf-v1`; no record contains a self-referential hash. Revocation is a
separate immutable record, and effective state is computed as `ACTIVE`,
`REVOKED`, `SUPERSEDED`, `EXPIRED`, `RECHECK_REQUIRED`, or `REJECTED`.
The authority policy identity is the SHA-256 of its canonical JSON bytes, so
presentation-only key/array formatting cannot silently create a new policy.

The verifier is deliberately verify-only. CI may validate, replay, and evaluate
records, but it cannot create an `APPROVED` record. A mutable global approval
registry is not an authority.

## Scope separation

The current authority policy grants only:

```text
PYTHON_ARTIFACT_INVENTORY_PROVENANCE
TOOLCHAIN_PROVENANCE_APPROVAL
```

Those scopes cover identity, dependency graph, target/role binding and source
provenance only. They do not imply license, native reconciliation,
vulnerability, distribution, or CVE Stage A approval. Toolchain provenance,
license disposition, and vulnerability disposition remain independent gates.
The current toolchain v1 evidence is intake evidence and does not itself create
an approval assertion; its provenance subject can be reviewed independently
when the bundle is ready.

## Current release state

No current 4+2 approvals are issued by this QICR. Python Inventory remains
`BLOCKED_PENDING_CODE_C_REGENERATION`; CPython Stage A rebind remains pending;
Python license and vulnerability gates are not run by this decision. Previously
rejected candidate hashes remain permanently unapproved and cannot match a
future approval by inventory ID alone.
