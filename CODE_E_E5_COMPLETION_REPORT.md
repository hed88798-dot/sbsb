# Code E E5 Completion Report

Completion date: 2026-09-10

## Result

```text
CODE_E_E5:
PASS

E3_1_FROZEN_BASELINE:
15c927966f42ee4a2fffb54e4f2ab74b04f1b4b5

E1_BYTES_CHANGED:
NO

E2_SEMANTICS_CHANGED:
NO

E3_SEMANTICS_CHANGED:
NO

E3_1_SEMANTICS_CHANGED:
NO

E4_SEMANTICS_CHANGED:
NO

MIGRATION:
NONE
```

E5 adds a Desktop Main-only `TimelineOrchestrationService`. Initial planning resolves explicit,
verified Code D identities, validates the exact historical media revision, invokes the frozen E2
normalizer and E3 duration planner, and commits the resulting immutable version through the
existing E4 repository. A plan containing `ADDITIONAL_SELECTION_REQUIRED` is committed before
any continuation begins.

One continuation call reads one committed parent requirement, performs at most one supplemental
Code D decision, and commits at most one child Timeline version. It never loops over requirements,
queries Code C, edits Timeline geometry, renders media, or creates a second persistence authority.

## Code D evidence and candidate authority

```text
TYPED_D_COMMITTED_EVIDENCE_READ:
PASS

D_EVIDENCE_HASH_AND_IDENTITY_BINDING:
PASS

SELECTED_EXACT_CANDIDATE_RECOVERY:
PASS

INITIAL_NO_MATCH_EXPLICIT_CARRIER:
PASS

LATEST_D_DECISION_GUESSING_USED:
NO

CODE_D_FROZEN_HASH_HELPERS_REUSED:
PASS

E5_CUSTOM_D_HASH_PREIMAGE:
NO

SUPPLEMENTAL_CANDIDATE_AUTHORITY_SOURCE:
FIRST_AUTHORITATIVE_SELECTED_DECISION_FOR_SLOT

SUPPLEMENTAL_CANDIDATE_AUTHORITY_CHAIN:
PASS

CANDIDATE_SET_FORK_DETECTION:
PASS

CANDIDATE_SET_FORK_POLICY:
FAIL_CLOSED

LATEST_CANDIDATE_SET_GUESSING:
NO
```

The typed repository read parses the already committed request, receipt, and result bytes using
the frozen Code D schemas. Main validation calls the existing canonical serialization and hash
semantics for the candidate set, usage history, policy, and decision receipt; it does not rerun
the selector to validate history.

For supplemental selection, every candidate is checked without filtering. The exact committed
candidate snapshot, candidate-set identity, contract version, hash, and canonical candidate bytes
come from the first authoritative selected decision for that slot. Every already consumed
supplemental decision in the parent must point to the same candidate authority. A fork fails
before another D selection runs. Only the authoritative usage history is refreshed, after which
the unchanged Code D selector and policy produce the new committed decision.

## Exact media execution validity

```text
EXACT_REVISION_EXECUTION_VALIDITY:
PASS

ACTIVE_REVISION_SUBSTITUTION:
NO

SEMANTIC_REINFERENCE_FOR_EXECUTION_VALIDITY:
NO

SUPPLEMENTAL_CANDIDATE_SET_PRESERVED:
PASS

INVALID_CANDIDATE_FILTERING:
NO
```

The read-only Media Index path checks the exact asset, revision, shot, source range, READY states,
PRESENT location, readable file, and historical revision file hash. A valid non-active historical
revision can execute. Missing or changed historical bytes fail closed and are never replaced with
the active revision. Initial planning checks selected media only; a new supplemental D decision is
preceded by validation of every candidate and followed by a second validation of the selected
candidate.

## Continuation and recovery

```text
SUPPLEMENTAL_SELECTION_REQUEST_ID:
DETERMINISTIC_NEW_PER_BUSINESS_OPERATION

SUPPLEMENTAL_SELECTION_RETRY_SAME_ID:
PASS

FRESH_AUTHORITATIVE_USAGE_HISTORY:
PASS

E5_SELECTION_POLICY:
NONE

REQUIREMENT_BEARING_VN_COMMITTED_FIRST:
PASS

ONE_REQUIREMENT_PER_CONTINUATION:
PASS

SUPPLEMENTAL_SELECTED_PATH:
PASS

SUPPLEMENTAL_NO_MATCH_PATH:
PASS

E3_1_USED_ONLY_FOR_SUPPLEMENTAL_NO_MATCH:
PASS

CHILD_PLANNING_REQUEST_ID_DETERMINISTIC:
PASS

D_COMMIT_CRASH_RECOVERY:
PASS

CHILD_COMMIT_REPLAY:
PASS

STALE_PARENT_PRE_D_GUARD:
PASS

PARENT_VERSION_IMMUTABLE:
PASS
```

Supplemental D and child planning identities are canonical SHA-256 derivations of the immutable
parent, requirement, and committed-decision chain. A crash retry reuses an existing D decision and
an already committed child. A stale parent fails before a new D decision; if D already committed
but the child did not and the parent is now stale, the orphaned immutable D history is retained and
the continuation fails closed.

Supplemental `SELECTED` appends one E1 selection reference without reordering history and follows
ordinary E2/E3. Supplemental `NO_MATCH` never enters E2 as a slot-level outcome; ordinary E2/E3
first reproduce the exact shortage and the frozen E3.1 resolver converts only that gap. Parent
initial whole-slot Code D `NO_MATCH` identities are recovered from the committed parent artifacts,
typed-read again, and supplied to every child E2 replan without caller redeclaration.

## Verification evidence

```text
E5_SCOPED_TESTS:
40 PASS / 0 FAIL

FROZEN_TIMELINE_REGRESSION:
198 PASS / 0 FAIL

COMBINED_C_D_TIMELINE_E5_REGRESSION:
230 PASS / 0 FAIL

DESKTOP_TYPECHECK:
PASS

WORKSPACE_BUILD:
PASS

FORMAT_CHECK:
PASS

LINT:
PASS

DEPENDENCY_DIRECTION:
PASS

E5_VERTICAL_SMOKE_SELECTED:
PASS

E5_VERTICAL_SMOKE_NO_MATCH:
PASS
```

The selected vertical smoke commits V1 with a shortage, performs a new D decision from the same
candidate authority with fresh history, and commits V2 with `ACTIVE_STITCH` segments bound to two
separate decisions. The NO_MATCH smoke preserves the already consumed real-material interval and
converts only the remaining exact gap into a committed-decision-backed fallback.

The complete repository Vitest run reached 664 passing tests and 3 skipped tests. Five unrelated
Python-dependent suites could not start because the frozen Python 3.13.15 runtime is absent on this
host. All TypeScript workspace packages built successfully before that environment-only failure;
the scoped and frozen E5 evidence above is complete and passing.

## Scope proof

```text
CODE_D_SELECTOR_CHANGED:
NO

CODE_D_POLICY_CHANGED:
NO

CODE_C_RERUN:
NO

SQLITE_CHANGED:
NO_SCHEMA_CHANGE

JOBS_CHANGED:
NO

IPC_CHANGED:
NO

UI_CHANGED:
NO

RENDER_IMPLEMENTED:
NO

DIGITAL_HUMAN_IMPLEMENTED:
NO

NEW_PRODUCTION_DEPENDENCIES:
NONE

FIRST_ACTUAL_BLOCKER:
NONE_IN_E5_SCOPE

RECOMMENDATION:
PROCEED_E6
```

E5 changes no Timeline schema, duration policy, physical segment rule, persistence migration,
renderer, Sidecar, Worker, or product UI. The only added package dependency is the existing
internal `@app/timeline` workspace package used by Desktop Main.
