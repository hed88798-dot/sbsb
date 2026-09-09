# Code D Material Selection Policy V0.1 Completion Report

Completion date: 2026-09-09

Implementation commit: `e742ce64656a0ae137cfc53613e61b75d7332d14`

The final closeout commit is the Git commit containing this report; its exact SHA is reported in the task closeout summary because a commit cannot embed its own SHA.

```text
CODE_D_V0_1:
PASS

FINAL_COMMIT:
SELF (the commit containing this report; exact SHA is in the closeout summary)

START_MAIN_BASELINE:
b10fe3e695c6e9ad43cbd278040e73d8e6858ac6

CODE_C_CLOSEOUT_BASELINE:
4df253f9b181043ab10a1d97a888f7980f1b9dde

CODE0_ARCHITECTURE_COMPATIBILITY:
PASS

OPEN_SOURCE_REFERENCE_REVIEW:
PASS

COMMERCIAL_LICENSE_PRECHECK:
PASS

NEW_PRODUCTION_DEPENDENCIES:
NONE

POLICY_ID:
material-selection-policy-v1

POLICY_VERSION:
1.0.0

POLICY_SHA256:
02efadddb7a30b6bcc2eec2497a1cb0736812d750631354a0d759fdde4dbd489

MATERIAL_SELECTION_REQUEST_CONTRACT:
packages/contracts/src/material-selection.ts + schemas/material-selection/v1/material-selection-request.schema.json

MATERIAL_SELECTION_RESULT_CONTRACT:
packages/contracts/src/material-selection.ts + schemas/material-selection/v1/material-selection-result.schema.json

DECISION_RECEIPT_CONTRACT:
packages/contracts/src/material-selection.ts + schemas/material-selection/v1/selection-decision-receipt.schema.json

DB_MIGRATION:
migrations/desktop-sqlite/003_material_selection_v1.sql

UNIT_TESTS:
7 PASS

CONTRACT_TESTS:
5 PASS

CODE_D_SCOPED_TESTS:
28 PASS / 0 FAIL across 6 files

BATCH_REGRESSION:
PASS

DETERMINISM_GATE:
PASS

CANDIDATE_ORDER_INDEPENDENCE:
PASS

SAME_VIDEO_EXACT_SHOT_REPEAT_GATE:
PASS

RECENCY_POLICY_GATE:
PASS

FREQUENCY_BALANCE_GATE:
PASS

SCARCITY_DEGRADATION_GATE:
PASS

NO_MATCH_GATE:
PASS

IDEMPOTENCY_GATE:
PASS

RESTART_RECOVERY_GATE:
PASS

CONCURRENCY_GATE:
PASS

REAL_CODE_C_CANDIDATE_SMOKE:
PASS

ELIGIBLE_CANDIDATE_BOUNDARY:
PASS

AUTHORITATIVE_USAGE_HISTORY_SOURCE:
MAIN_FROM_SQLITE

TOP_LEVEL_SELECTION_STATUS:
SELECTED_NO_MATCH_ONLY

COMMITTED_DECISION_PERSISTENCE:
PASS

NO_MATCH_PERSISTENCE:
PASS

NO_MATCH_IDEMPOTENCY:
PASS

POLICY_SNAPSHOT_HASH_PERSISTED:
PASS

CODE_C_CONTRACT_CHANGED:
NO

MEDIA_INDEX_CONTRACT_CHANGED:
NO

SIDECAR_PROTOCOL_CHANGED:
NO

V3_BASELINE_CHANGED:
NO

WORKER_CHANGED:
NO

SIGLIP_CHANGED:
NO

CODE_D_UI_IMPLEMENTED:
NO

TIMELINE_IMPLEMENTED:
NO

RENDER_IMPLEMENTED:
NO

DIGITAL_HUMAN_IMPLEMENTED:
NO

REMAINING_BLOCKERS:
Only inherited/non-Code-D gates: external MSVC redistribution release gate; unavailable Python 3.13.15 on this host; frozen Code C/compliance formatting, lint and portability findings.

RECOMMENDATION:
ACCEPT_CODE_D_V0_1
```

## Regression baseline

| Scenario       | Selections | Unique assets | Unique Shots | Repeats | Degraded | Usage distribution        |
| -------------- | ---------- | ------------- | ------------ | ------- | -------- | ------------------------- |
| rich-animal    | 10         | 5             | 5            | 5       | 5        | `2 / 2 / 2 / 2 / 2`       |
| medium-product | 10         | 2             | 4            | 6       | 8        | `asset_a: 5 / asset_b: 5` |
| scarce-animal  | 10         | 1             | 1            | 9       | 9        | `asset_only: 10`          |

The developer harness emits every selected sequence and all 30 SHA-256 decision receipt identities. The recorded values are an empirical V0.1 baseline, not post-hoc acceptance thresholds.

## Verification record

- Code D build, typecheck, scoped Prettier, scoped ESLint, dependency direction, workflow security, secret scan and `git diff --check`: PASS.
- Empty database migration, Code C v2 to Code D v3 upgrade with backup, rollback recovery, foreign-key validation and WAL: PASS.
- Full repository tests: 57 files passed, 3 skipped, and 5 failed only because the required Python 3.13.15 runtime is unavailable on this host; 457 tests passed and 3 skipped. No Code D test failed.
- Full repository formatting retains 23 pre-existing Code C/compliance evidence warnings; full repository ESLint retains 3 pre-existing Code C tooling errors.
- Portability check retains 5 pre-existing Code C/compliance evidence path findings. Code D introduced no developer-specific path.
- Stable release licensing remains externally blocked by the already-recorded Microsoft Visual C++ Redistributable condition. It is non-blocking for Code D development.

## Frozen-boundary proof

A diff against Code C closeout `4df253f9…` shows no change to Code C candidate contract, Media Index implementation/schema, Sidecar protocol, V3 golden baseline, Worker or SigLIP assets. Code D consumes the frozen candidate output through a read-only compatibility adapter and never expands the eligible set.
