# Code E E2 Pure Timeline Planner Core

E2 turns frozen E1 execution input plus authoritative resolved Code D facts into deterministic
planning facts. Its public entry point is `normalizeTimelinePlanningFactsV1` in
`packages/timeline/src/planner.ts`.

## Authority boundary

`ConfirmedShotPlanV1` remains owned by Stage-1 Shot Planning / Human Review, and
`NarrationTimingSnapshotV1` remains owned by Narration / TTS orchestration. E2 consumes both
through the frozen `TimelinePlanningRequestV1` parser and does not change their meaning.

`ResolvedMaterialDecisionEvidenceV1` is an internal pure-domain projection, not a new Code D
contract or authority. E2 tests construct fixture facts directly. The future E5 production path
must read the already committed Code D request, receipt and result bytes from SQLite through
Desktop Main, validate them with their existing schemas, and only then create this projection.
UI and Renderer input is never authoritative.

The timeline package does not open SQLite, import `local-db`, call Code C retrieval, or invoke the
Code D selector.

## Deterministic binding

- A `SELECTED` outcome must have one frozen E1 `CommittedMaterialSelectionRefV1`.
- `selection_request_id` resolves the authoritative evidence. Array position is never slot
  identity.
- Receipt hash, asset identity and shot identity must match exactly.
- The resolved evidence supplies `slot_id`, `batch_id`, `video_id`, revision and the committed
  shot range.
- A Code D `NO_MATCH` outcome binds directly through resolved evidence and requires no fabricated
  selected-material reference.
- Shot Plan route `NO_MATCH` is a separate upstream fallback fact and requires no Code D outcome.
- Conflicting, duplicate, missing, unreferenced or unaccounted authoritative evidence fails
  closed.

Multiple `SELECTED` references may resolve to one logical slot. Their deterministic order is the
frozen E1 reference order. E2 derives facts for every selected shot independently; it does not sum
their durations or interpret them as a stitch.

## Derived facts

For each confirmed slot, E2 copies its source boundary, route and upstream
`visual_continuity_group_id`, binds the exact narration timing, then derives:

```text
required_duration_ms  = timeline_end_ms - timeline_start_ms
available_duration_ms = shot_end_ms - shot_start_ms
duration_delta_ms     = available_duration_ms - required_duration_ms
```

The factual states are limited to `MATERIAL_AVAILABLE`, `MATERIAL_INSUFFICIENT_DURATION`, and
`FALLBACK_REQUIRED`. Insufficient duration is not an error and does not trigger another selection.
Pause facts are copied only from declared `pause_intervals`; narration gaps do not create pauses.

The result binds the existing planning request, upstream hashes, narration audio, policy identity,
and consistent Code D batch/video context. `planning_facts_hash` uses the existing project
canonical serialization and SHA-256 helper, excluding itself from its preimage.

## Explicitly deferred to E3 or later

E2 emits no executable timeline, physical segments, source trim, active extension, active stitch,
passive extension, pause coverage, second Code D request, FFmpeg instruction, render operation or
Digital Human operation. The timeline policy identity is preserved without inventing or applying
duration parameters.
