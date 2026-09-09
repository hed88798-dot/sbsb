# ADR-021: Material Selection Policy V1

- Status: Accepted for Code D V0.1
- Date: 2026-09-09
- Owners: Code D / Desktop Main / local-db

## Context

Code C provides a frozen semantically eligible Shot candidate set. Batch video production still needs deterministic diversity, recency, frequency and scarcity behavior without moving semantic truth into Auto Edit or trusting caller-supplied history.

## Decision

Implement `material-selection-policy-v1@1.0.0` as a pure TypeScript selector in `packages/domain-auto-edit`. A compatibility adapter consumes the unchanged Code C candidate contract. Hard constraints are evaluated before relaxable scarcity levels and ordered preferences; stable identity resolves final ties.

Desktop Main is the production authority. It derives usage from SQLite committed `SELECTED` decisions and performs read/select/commit in one `IMMEDIATE` transaction. Both `SELECTED` and `NO_MATCH` decisions are append-only and idempotent by `selection_request_id`; only `SELECTED` rows contribute to usage.

The exact policy JSON, candidate set, history snapshot and receipt receive canonical SHA-256 identities. No general rules engine, optimizer, service or new production dependency is added.

## Consequences

- Same inputs and snapshots produce the same receipt and selected identity.
- Candidate array order cannot affect selection.
- An exact Shot cannot repeat within a video, even under scarcity.
- Policy evolution requires a new version or exact snapshot hash; historical decisions remain reproducible.
- Main remains the sole database writer and Renderer cannot forge history.
- Timeline, rendering, UI and Digital Human remain outside this ADR.
