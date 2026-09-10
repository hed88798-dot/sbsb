# Code E E4 Timeline Persistence, Versioning and Recovery

E4 persists an already-created E1 request, E2 planning facts, E3 exact policy and E3 duration plan
as one immutable Timeline version. It does not normalize, plan, select, render or orchestrate.

## Storage model

Migration 004 creates one core table, timeline_plan_versions. Its primary key is timeline_id plus
version, while planning_request_id is globally unique and remains the idempotency authority.
timeline_request_hash is the only request-content hash. No planning_request_hash field, column or
semantic alias exists.

Version history is linear:

    version 1 has parent_version NULL
    version N has parent_version N - 1

SQLite CHECK constraints enforce this geometry and reject versions below one. BEFORE UPDATE and
BEFORE DELETE triggers reject mutation of committed rows. The Repository exposes commit, exact
version read, latest read, planning-request read and ordered version listing; it exposes no update,
delete or overwrite method.

## Commit order and concurrency

TimelinePlanRepository executes commitVersion inside a SQLite IMMEDIATE transaction:

1. Look up planning_request_id.
2. If it exists, verify exact timeline identity and canonical artifact bytes, then return the
   original historical version.
3. Only for a new planning_request_id, read the latest timeline version and compare
   expected_parent_version.
4. Insert exactly latest plus one with the validated parent.

Therefore an exact V1 retry still returns V1 after V2, V3 or V4 exists, regardless of the retry's
stale expected parent. The same ID with different timeline identity or artifact bytes fails with
TIMELINE_PLAN_IDEMPOTENCY_CONFLICT. A new request based on a stale parent fails with
TIMELINE_PLAN_VERSION_CONFLICT. Two new requests based on one parent cannot both commit.

## Immutable artifact chain

Commit and recovery validate, without re-planning:

- the frozen TimelinePlanningRequestV1 parser and timeline_request_hash;
- planning request identity, shot-plan identity, timing identity and policy identity carried by
  TimelinePlanningFactsV1, plus planning_facts_hash;
- TimelineDurationPolicyV1 canonical self-hash and its exact binding to planning facts;
- TimelineDurationPlanV1 integrity, duration_plan_hash, request/facts/policy bindings and execution
  coverage.

Every artifact JSON column uses the existing project canonical serializer. Recovery parses the
stored bytes, requires those bytes to already be canonical, repeats hash and cross-binding
validation, and compares duplicated indexed identity columns. Corruption fails closed and is never
rewritten.

E4 does not duplicate raw resolved Code D evidence. Timeline artifacts retain the used
selection_request_id and decision_receipt_hash identities; complete Code D request, receipt and
result authority remains in material_selection_decisions.

## Commit receipt

TimelinePlanCommitReceiptV1 binds timeline ID, version lineage, planning request ID,
timeline_request_hash, planning_facts_hash, policy_snapshot_hash, duration_plan_hash and the
original committed_at. commit_receipt_hash uses canonical serialization plus SHA-256 and excludes
itself from its preimage. Exact retry returns the original receipt and timestamp.

Plans containing FALLBACK_REQUIRED or ADDITIONAL_SELECTION_REQUIRED are valid committed business
artifacts, not persistence failures.

## Deferred boundary

E4 adds no Job type, MaterialSelectionRepository read extension, Desktop Main service, IPC, UI,
Code D execution, additional-selection execution, Digital Human operation, FFmpeg command, render
operation or production passive-extension threshold. E5 remains unauthorized.
