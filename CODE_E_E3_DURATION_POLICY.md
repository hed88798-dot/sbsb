# Code E E3 Duration Policy and Physical Timeline Core

E3 converts frozen TimelinePlanningFactsV1 plus an exact, hash-bound TimelineDurationPolicyV1
into TimelineDurationPlanV1. It is pure deterministic domain logic in packages/timeline; it
performs no persistence, orchestration, selection, rendering or media execution.

## Policy identity

The policy records only the modes and bounded millisecond parameters required by E3:

    active_extension_mode: SAME_VISUAL_CONTINUITY
    active_stitch_mode: WHEN_CURRENT_MATERIAL_EXHAUSTED
    pause_coverage_mode: PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL
    source_consumption_strategy: FORWARD_FROM_SHOT_START
    passive_extension_target_min_ms: non-negative integer fixture value
    passive_extension_max_ms: non-negative integer fixture value

policy_snapshot_hash uses the existing project canonical serialization and SHA-256 helper and
excludes itself from its preimage. Policy ID, version and hash must exactly match the identity
already carried by E2 facts. E3 freezes no production threshold values; tests use explicit fixture
policies only.

## Real-material execution

Each committed decision has an independent source cursor keyed by selection_request_id, even when
two decisions reference the same asset and shot. A cursor starts at that decision's shot_start_ms
and advances one-to-one with timeline consumption. It never resets while the same decision
continues through active extension or pause coverage and never exceeds shot_end_ms.

The only compatible real-route transitions are ANIMAL to ANIMAL and PRODUCT to PRODUCT. Active
extension additionally requires exact equality of the upstream visual_continuity_group_id.
Character offsets and source text are never used to infer continuity. A route change, continuity
change or fallback boundary produces an explicit SWITCH transition.

The current material is consumed first. Another already committed selection is used only after the
current material is exhausted, producing ACTIVE_STITCH. If the first material is sufficient, later
selections remain unused and are reported in unused_committed_selection_refs. E3 never searches
candidates or requests Code D.

Contiguous use of one decision is represented by one physical segment. Its reason_codes can record
DIRECT, ACTIVE_EXTENSION, ACTIVE_STITCH, PAUSE_COVERAGE, and PASSIVE_EXTENSION without creating
fake cuts. Every segment retains exactly one committed selection request, receipt, asset, shot and
revision identity.

## Pause and passive extension

Only declared E2 pause facts are processed. A pause exactly between two real-material slots is
covered from the previous visual side, using its current material and then its remaining committed
stitch materials if necessary. Other declared pauses become explicit fallback requirements.
Undeclared timing gaps never become pause coverage.

Passive extension is considered only after a fully covered real visual span whose narration
duration is below the fixture policy target. It consumes only the currently displayed decision's
remaining source and is capped by the target deficit, policy maximum, available downstream window,
and same-source remainder. It cannot enter the next real slot, introduce a second material, or hide
a source shortage. No loop, freeze frame, reverse playback, speed change or time stretch exists.

## Exact execution coverage

The output declares its execution domain as narration slot intervals, declared pause intervals,
and any legally allocated passive-extension intervals. Every point in that domain is covered by
exactly one of REAL_MATERIAL, FALLBACK_REQUIRED, or ADDITIONAL_SELECTION_REQUIRED.

Fallback and additional-selection requirements carry exact timeline start, end and duration.
Additional-selection requirements also carry equal remaining_duration_ms, plus the logical slot,
route and continuity group required by future orchestration. A validator rejects silent holes,
overlap, double coverage, geometry inconsistencies, source/timeline duration mismatch, and outcomes
outside the declared execution domain.

Unmodeled head, tail and ordinary timing gaps remain outside the execution domain unless a bounded
passive-extension interval is explicitly allocated. E3 does not synthesize hidden work for them.

## Deferred boundary

E3 emits no SQLite writes, migration, Desktop Main service, IPC, UI, second Code D request,
Digital Human clip, FFmpeg/filtergraph command, render instruction or MP4. E4 remains unauthorized.
