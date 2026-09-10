# Code E E3.1 Completion Report

## Scope

E3.1 adds one pure Timeline-domain resolver for an already committed supplemental Code D
`NO_MATCH`. It binds an immutable parent duration plan, an ordinary child duration plan, and
verified supplemental decision facts. It replaces only the exact matching child
`ADDITIONAL_SELECTION_REQUIRED` outcome with a traceable `FALLBACK_REQUIRED` outcome.

No E1, E2, frozen E3, E4, Code C, Code D, SQLite, Desktop Main, render, or Digital Human file was
changed.

## Compatibility gates

```text
REQUIREMENT_ID_STABLE_ACROSS_CHILD_REPLAN:
YES

REQUIREMENT_ID_ALGORITHM_CHANGED:
NO

EXISTING_E3_VALIDATOR_COMPATIBILITY:
PASS

EXISTING_E4_ARTIFACT_CHAIN_COMPATIBILITY:
PASS

E4_CHANGE_REQUIRED:
NO
```

Frozen E3 assigns additional requirement identities from their deterministic output order
(`additional_000001`, `additional_000002`, ...). The identity does not include a planning request
ID or duration plan hash, so an ordinary child replan with unchanged shortage geometry preserves
the parent requirement identity.

The resolved child passes the existing `validateTimelineDurationPlanV1` without a relaxed or
E3.1-specific validator. An integration fixture commits the immutable parent as Timeline V1 and
the resolved child as V2 through the existing `TimelinePlanRepository`, then verifies typed read
and database reopen recovery.

## Resolution behavior

```text
RESOLUTION_TYPE:
TimelineSupplementalNoMatchResolutionV1

SUPPORTED_STATUS:
NO_MATCH_ONLY

PARENT_CHILD_RESOLUTION_BINDING:
PASS

PARENT_PLAN_IMMUTABLE:
PASS

CHILD_PLAN_IS_RESOLUTION_TARGET:
PASS

PARENT_CHILD_REQUIREMENT_GEOMETRY_MATCH:
PASS

SUPPLEMENTAL_NEW_DECISION_ID_RULE:
PASS

SUPPLEMENTAL_COMMITTED_REPLAY_IDEMPOTENCY:
PASS

ONE_SUPPLEMENTAL_DECISION_ONE_REQUIREMENT:
PASS

PARENT_VERSION_MUTATED:
NO
```

The resolver verifies both duration plan hashes, requires a new child planning request ID, finds
the parent and child additional requirements by one stable requirement ID, and compares exact
slot, route, continuity group, timeline geometry, remaining duration, and reason. It rejects a
supplemental selection request ID already consumed by a parent real-material segment or already
bound to a different fallback requirement.

The parent object is never mutated. The child keeps existing segments, execution-domain
intervals, unrelated fallbacks, unrelated additional requirements, unused-selection accounting,
and transitions. The resolved gap keeps its requirement ID and exact timeline interval, receives
the supplemental committed NO_MATCH identity, and the child duration plan hash is recomputed.

## Test evidence

```text
E3_1_SCOPED_TESTS:
22 PASS / 0 FAIL

FROZEN_TIMELINE_REGRESSION:
174 PASS / 0 FAIL

TIMELINE_PACKAGE_TYPECHECK:
PASS

TIMELINE_PACKAGE_BUILD:
PASS

FORMAT_CHECK:
PASS

SCOPED_LINT:
PASS

DETERMINISM_100_RUNS:
PASS
```

The scoped tests cover parent/child hash validation, stable requirement identity, exact geometry,
NO_MATCH-only enforcement, old decision reuse rejection, one-decision/one-requirement binding,
retry determinism, immutable parent and real-material preservation, exact coverage, multiple
independent resolutions, existing E3 validation, and existing E4 commit/read/recovery.

The 174-test regression set includes the frozen E1 contract tests, E2 planner tests, E3 duration
tests, E4 repository tests, and all new E3.1 tests.
