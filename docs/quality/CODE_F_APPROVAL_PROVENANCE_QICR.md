# Code F Approval Provenance QICR

This document records the verify-only quality boundary for Python artifact and
toolchain provenance reviews.

The original Approval Provenance v1 contract remains available for historical
replay only. New issuance uses the versioned v2 contract in
`schemas/compliance/artifact-approval-provenance/v2/`; v1 records are not
rewritten in place and cannot be reused for the current Inventory v3 or
Toolchain v1 subjects.

## Required invariants

- Raw candidate validation is performed on exact immutable subject bytes. The
  input SHA must equal the subject SHA; no approval projection or field
  injection is allowed.
- Approval v2 records bind the exact subject, trusted schema ID/version/raw-byte
  SHA-256, target descriptor, frozen review snapshot, authority policy and
  explicit scope. The schema identity is part of canonical approval bytes and
  the exact-subject equality key.
- Historical approvals are immutable. Revocation and supersession use new
  records; effective state is calculated by the verifier.
- Unknown authority or scope mismatch fails closed. Provenance approval never
  implies license, vulnerability, native, distribution or CVE approval.
- CI verifies records only. It never issues an approval.
- Large worker, Python environment, wheel-cache or PyInstaller artifacts are
  not uploaded for this gate. Actions evidence remains within the repository's
  20 MiB per-artifact and 25 MiB per-run policy.

## Inventory v2 compatibility result

The current candidates are schema-shaped but not valid approval subjects under
the established v2 semantics: `graph_complete` is factual completeness and
must be true, while package `review_status` is a legacy approval lifecycle
assertion. Their `false`/`PENDING` values therefore require a versioned subject
migration. Code C must produce v3; Code F does not convert or self-approve v2.

## Toolchain result

Toolchain v1 intake evidence is provenance evidence, not a combined license or
vulnerability disposition. It can be used as an exact provenance subject once
the corresponding review snapshot is frozen. License and vulnerability review
remain separate records and gates.

Run the contract smoke check with:

```text
pnpm compliance:approval:verify
```

The verifier resolves subject schema identity from the shared main-contract
mapping and recomputes raw schema bytes. Subject- or approval-self-asserted
schema hashes are never authoritative. Inventory v3 and Toolchain v1 are both
currently classified as `SINGLE_SELF_CONTAINED_SCHEMA`; their exact trusted
hashes are checked before an Approval v2 record can verify.
