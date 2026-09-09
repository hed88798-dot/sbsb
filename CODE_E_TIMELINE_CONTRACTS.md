# Code E E1 Timeline Planning Contracts

## Ownership

`ConfirmedShotPlanV1` is produced by the Stage-1 Shot Planning / Human Review authority.
`NarrationTimingSnapshotV1` is produced by the Narration / TTS Orchestration authority. Code E
only validates and consumes both snapshots. Their shared location in `packages/contracts` does
not transfer producer or business ownership to Code E.

The producer implementations are outside Code E V0.1.

## Confirmed shot plan

Only `review_state: CONFIRMED` is executable. Source ranges are Unicode code-point offsets with
start inclusive and end exclusive: `[source_start, source_end)`. Slot identity is shared without
translation across the confirmed plan, Code D `slot_id` and Timeline.

`visual_continuity_group_id` is an upstream fact. Code E must not infer it from source text. Equal
groups permit later policy evaluation for visual continuity; different groups require a switch.

`route: NO_MATCH` means the confirmed Stage-1 route does not request ANIMAL or PRODUCT local
material selection. It is distinct from Code D `status: NO_MATCH`, which reports that a requested
ANIMAL or PRODUCT selection produced no committed material.

## Exact narration timing

Only `timing_kind: EXACT` is executable. Slot and pause intervals use integer milliseconds and
must be ordered, positive, non-overlapping, within `total_duration_ms`, and mutually disjoint.
Declared intervals do not have to cover the full audio duration; head/tail padding and other
unmodeled gaps remain allowed in E1.

The timing snapshot binds the exact `shot_plan_id`, `shot_plan_hash`, `source_document_id` and
`source_document_hash`. Any mismatch fails closed.

## Committed Code D reference

One physical Timeline segment will reference exactly one committed Code D decision through:

```text
selection_request_id
decision_receipt_hash
asset_id
shot_id
```

The reference is not proof by itself. Desktop Main must later read the existing committed
request/receipt/result bytes from SQLite and validate status, receipt hash, asset, Shot, batch,
video and shared slot identity. E1 does not add that read API.

Multiple physical segments for one future ACTIVE_STITCH are represented by multiple ordered
references. No aggregate selection protocol is introduced.

## Canonical hashes

All E1 hashes use the repository's existing canonical JSON rule—object keys sort recursively,
arrays retain order—followed by SHA-256 over the JSON UTF-8 bytes. The implementation reuses
`@app/domain-media-index` helpers.

Self-hashed objects exclude only their own hash field from their preimage:

```text
shot_plan_hash excludes shot_plan_hash
timing_snapshot_hash excludes timing_snapshot_hash
timeline_request_hash excludes timeline_request_hash
```

Nested snapshot hashes remain part of a containing request's preimage because they are business
bindings.

## E1 boundary

`TimelinePlanningRequestV1` is an immutable input snapshot envelope only. E1 contains no
executable Timeline, planner, duration rule, fallback execution, persistence, Main service, IPC,
UI, renderer, FFmpeg integration or Digital Human behavior.
