import { canonicalJson, sha256 } from '@app/domain-media-index';
import {
  computeTimelinePlanningFactsHash,
  type TimelineMaterialSlotPlanningFactV1,
  type TimelinePlanningFactsV1,
  type TimelineSelectedMaterialPlanningFactV1,
  type TimelineSlotPlanningFactV1,
} from './planner.js';

const IDENTITY_MAX_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface TimelineDurationPolicyV1 {
  schema_version: '1.0';
  policy_id: string;
  policy_version: string;
  policy_snapshot_hash: string;
  active_extension_mode: 'SAME_VISUAL_CONTINUITY';
  active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED';
  passive_extension_target_min_ms: number;
  passive_extension_max_ms: number;
  pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL';
  source_consumption_strategy: 'FORWARD_FROM_SHOT_START';
}

export interface TimelineDurationPlannerInputV1 {
  planning_facts: TimelinePlanningFactsV1;
  duration_policy: TimelineDurationPolicyV1;
}

export type TimelinePhysicalSegmentReasonV1 =
  | 'DIRECT'
  | 'ACTIVE_EXTENSION'
  | 'ACTIVE_STITCH'
  | 'PASSIVE_EXTENSION'
  | 'PAUSE_COVERAGE';

export interface TimelinePhysicalSegmentV1 {
  segment_id: string;
  kind: 'REAL_MATERIAL';
  slot_ids: readonly string[];
  visual_continuity_group_id: string;
  timeline_start_ms: number;
  timeline_end_ms: number;
  duration_ms: number;
  source_asset_id: string;
  source_shot_id: string;
  source_revision: number;
  source_start_ms: number;
  source_end_ms: number;
  selection_request_id: string;
  decision_receipt_hash: string;
  selection_slot_id: string;
  reason_codes: readonly TimelinePhysicalSegmentReasonV1[];
}

export interface TimelineFallbackRequirementV1 {
  requirement_id: string;
  kind: 'FALLBACK_REQUIRED';
  source:
    | 'SHOT_PLAN_ROUTE_NO_MATCH'
    | 'CODE_D_SELECTION_NO_MATCH'
    | 'DECLARED_PAUSE_WITHOUT_REAL_SIDES';
  slot_id: string | null;
  pause_id: string | null;
  route: 'ANIMAL' | 'PRODUCT' | 'NO_MATCH' | null;
  visual_continuity_group_id: string | null;
  timeline_start_ms: number;
  timeline_end_ms: number;
  duration_ms: number;
  committed_no_match: {
    selection_request_id: string;
    decision_receipt_hash: string;
    batch_id: string;
    video_id: string;
  } | null;
}

export interface TimelineAdditionalSelectionRequirementV1 {
  requirement_id: string;
  kind: 'ADDITIONAL_SELECTION_REQUIRED';
  reason: 'MATERIAL_EXHAUSTED' | 'PAUSE_COVERAGE_MATERIAL_EXHAUSTED';
  slot_id: string;
  route: 'ANIMAL' | 'PRODUCT';
  visual_continuity_group_id: string;
  timeline_start_ms: number;
  timeline_end_ms: number;
  duration_ms: number;
  remaining_duration_ms: number;
}

export interface TimelineUnusedCommittedSelectionRefV1 {
  selection_request_id: string;
  decision_receipt_hash: string;
  asset_id: string;
  shot_id: string;
  slot_id: string;
}

export interface TimelineExecutionDomainIntervalV1 {
  execution_interval_id: string;
  kind: 'NARRATION_SLOT' | 'DECLARED_PAUSE' | 'PASSIVE_EXTENSION';
  slot_id: string | null;
  pause_id: string | null;
  timeline_start_ms: number;
  timeline_end_ms: number;
  duration_ms: number;
}

export interface TimelineSlotTransitionV1 {
  from_slot_id: string;
  to_slot_id: string;
  decision: 'ACTIVE_EXTENSION' | 'ACTIVE_STITCH' | 'SWITCH';
  reason:
    | 'SAME_ROUTE_AND_VISUAL_CONTINUITY'
    | 'ROUTE_CHANGE'
    | 'VISUAL_CONTINUITY_CHANGE'
    | 'FALLBACK_BOUNDARY'
    | 'UNRESOLVED_PREVIOUS_COVERAGE';
}

export interface TimelineDurationPlanV1 {
  schema_version: '1.0';
  planning_request_id: string;
  planning_facts_hash: string;
  policy_id: string;
  policy_version: string;
  policy_snapshot_hash: string;
  source_consumption_strategy: 'FORWARD_FROM_SHOT_START';
  segments: readonly TimelinePhysicalSegmentV1[];
  fallback_requirements: readonly TimelineFallbackRequirementV1[];
  additional_selection_requirements: readonly TimelineAdditionalSelectionRequirementV1[];
  unused_committed_selection_refs: readonly TimelineUnusedCommittedSelectionRefV1[];
  execution_domain_intervals: readonly TimelineExecutionDomainIntervalV1[];
  slot_transitions: readonly TimelineSlotTransitionV1[];
  duration_plan_hash: string;
}

type TimelineDurationPolicyHashInput =
  | TimelineDurationPolicyV1
  | Omit<TimelineDurationPolicyV1, 'policy_snapshot_hash'>;
type TimelineDurationPlanHashInput =
  | TimelineDurationPlanV1
  | Omit<TimelineDurationPlanV1, 'duration_plan_hash'>;

type SegmentDraft = Omit<TimelinePhysicalSegmentV1, 'segment_id'>;
type FallbackDraft = Omit<TimelineFallbackRequirementV1, 'requirement_id'>;
type AdditionalDraft = Omit<TimelineAdditionalSelectionRequirementV1, 'requirement_id'>;
type ExecutionIntervalDraft = Omit<TimelineExecutionDomainIntervalV1, 'execution_interval_id'>;

interface ActiveMaterialState {
  current: TimelineSelectedMaterialPlanningFactV1 | null;
  queue: TimelineSelectedMaterialPlanningFactV1[];
}

interface Interval {
  timeline_start_ms: number;
  timeline_end_ms: number;
}

const REASON_ORDER: readonly TimelinePhysicalSegmentReasonV1[] = [
  'DIRECT',
  'ACTIVE_EXTENSION',
  'PAUSE_COVERAGE',
  'ACTIVE_STITCH',
  'PASSIVE_EXTENSION',
];

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  code: string,
): void {
  const expected = new Set(expectedKeys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    fail(code);
  }
}

function identity(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > IDENTITY_MAX_LENGTH ||
    value.trim() !== value
  ) {
    fail(code);
  }
  return value;
}

function integer(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(code);
  return value;
}

function normalizedReasons(
  existing: readonly TimelinePhysicalSegmentReasonV1[],
  additions: readonly TimelinePhysicalSegmentReasonV1[],
): TimelinePhysicalSegmentReasonV1[] {
  const combined = new Set([...existing, ...additions]);
  return REASON_ORDER.filter((reason) => combined.has(reason));
}

export function computeTimelineDurationPolicyHash(value: TimelineDurationPolicyHashInput): string {
  const preimage = Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== 'policy_snapshot_hash'),
  );
  return sha256(canonicalJson(preimage));
}

export function parseTimelineDurationPolicyV1(value: unknown): TimelineDurationPolicyV1 {
  if (!isRecord(value)) fail('TIMELINE_DURATION_POLICY_INVALID');
  assertExactKeys(
    value,
    [
      'schema_version',
      'policy_id',
      'policy_version',
      'policy_snapshot_hash',
      'active_extension_mode',
      'active_stitch_mode',
      'passive_extension_target_min_ms',
      'passive_extension_max_ms',
      'pause_coverage_mode',
      'source_consumption_strategy',
    ],
    'TIMELINE_DURATION_POLICY_INVALID',
  );
  if (
    value.schema_version !== '1.0' ||
    value.active_extension_mode !== 'SAME_VISUAL_CONTINUITY' ||
    value.active_stitch_mode !== 'WHEN_CURRENT_MATERIAL_EXHAUSTED' ||
    value.pause_coverage_mode !== 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL' ||
    value.source_consumption_strategy !== 'FORWARD_FROM_SHOT_START'
  ) {
    fail('TIMELINE_DURATION_POLICY_INVALID');
  }
  const parsed: TimelineDurationPolicyV1 = {
    schema_version: '1.0',
    policy_id: identity(value.policy_id, 'TIMELINE_DURATION_POLICY_INVALID'),
    policy_version: identity(value.policy_version, 'TIMELINE_DURATION_POLICY_INVALID'),
    policy_snapshot_hash: hash(value.policy_snapshot_hash, 'TIMELINE_DURATION_POLICY_INVALID'),
    active_extension_mode: 'SAME_VISUAL_CONTINUITY',
    active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
    passive_extension_target_min_ms: integer(
      value.passive_extension_target_min_ms,
      'TIMELINE_DURATION_POLICY_INVALID',
    ),
    passive_extension_max_ms: integer(
      value.passive_extension_max_ms,
      'TIMELINE_DURATION_POLICY_INVALID',
    ),
    pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
  };
  if (computeTimelineDurationPolicyHash(parsed) !== parsed.policy_snapshot_hash) {
    fail('TIMELINE_POLICY_BINDING_MISMATCH');
  }
  return parsed;
}

export function computeTimelineDurationPlanHash(value: TimelineDurationPlanHashInput): string {
  const preimage = Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== 'duration_plan_hash'),
  );
  return sha256(canonicalJson(preimage));
}

function isRealSlot(slot: TimelineSlotPlanningFactV1): slot is TimelineMaterialSlotPlanningFactV1 {
  return slot.route !== 'NO_MATCH' && slot.fallback === null && slot.selected_materials.length > 0;
}

function assertPlanningFacts(value: unknown): TimelinePlanningFactsV1 {
  if (!isRecord(value)) fail('TIMELINE_PLANNING_FACTS_INVALID');
  const facts = value as unknown as TimelinePlanningFactsV1;
  if (
    !Array.isArray(facts.slots) ||
    !Array.isArray(facts.pauses) ||
    typeof facts.planning_facts_hash !== 'string' ||
    computeTimelinePlanningFactsHash(facts) !== facts.planning_facts_hash
  ) {
    fail('TIMELINE_PLANNING_FACTS_HASH_MISMATCH');
  }
  const baseIntervals: Interval[] = [];
  const selectionIds = new Set<string>();
  let previousOrder = -1;
  for (const slot of facts.slots) {
    if (
      !Number.isSafeInteger(slot.order_index) ||
      slot.order_index <= previousOrder ||
      !Number.isSafeInteger(slot.timeline_start_ms) ||
      !Number.isSafeInteger(slot.timeline_end_ms) ||
      slot.timeline_start_ms < 0 ||
      slot.timeline_end_ms <= slot.timeline_start_ms ||
      slot.required_duration_ms !== slot.timeline_end_ms - slot.timeline_start_ms
    ) {
      fail('TIMELINE_PLANNING_FACTS_GEOMETRY_INVALID');
    }
    previousOrder = slot.order_index;
    baseIntervals.push(slot);
    if (isRealSlot(slot)) {
      for (const material of slot.selected_materials) {
        if (
          selectionIds.has(material.selection_request_id) ||
          material.slot_id !== slot.slot_id ||
          !Number.isSafeInteger(material.shot_start_ms) ||
          !Number.isSafeInteger(material.shot_end_ms) ||
          material.shot_start_ms < 0 ||
          material.shot_end_ms <= material.shot_start_ms ||
          material.available_duration_ms !== material.shot_end_ms - material.shot_start_ms ||
          material.duration_delta_ms !== material.available_duration_ms - slot.required_duration_ms
        ) {
          fail('TIMELINE_PLANNING_FACTS_MATERIAL_INVALID');
        }
        selectionIds.add(material.selection_request_id);
      }
    }
  }
  for (const pause of facts.pauses) {
    if (
      !Number.isSafeInteger(pause.start_ms) ||
      !Number.isSafeInteger(pause.end_ms) ||
      pause.start_ms < 0 ||
      pause.end_ms <= pause.start_ms ||
      pause.duration_ms !== pause.end_ms - pause.start_ms
    ) {
      fail('TIMELINE_PLANNING_FACTS_GEOMETRY_INVALID');
    }
    baseIntervals.push({ timeline_start_ms: pause.start_ms, timeline_end_ms: pause.end_ms });
  }
  const ordered = [...baseIntervals].sort(
    (left, right) => left.timeline_start_ms - right.timeline_start_ms,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.timeline_start_ms < ordered[index - 1]!.timeline_end_ms) {
      fail('TIMELINE_PLANNING_FACTS_GEOMETRY_INVALID');
    }
  }
  return facts;
}

function compatibleRealSlots(
  left: TimelineSlotPlanningFactV1,
  right: TimelineSlotPlanningFactV1,
): boolean {
  return (
    isRealSlot(left) &&
    isRealSlot(right) &&
    left.route === right.route &&
    left.visual_continuity_group_id === right.visual_continuity_group_id
  );
}

function remainingSource(
  material: TimelineSelectedMaterialPlanningFactV1,
  sourceCursors: ReadonlyMap<string, number>,
): number {
  const cursor = sourceCursors.get(material.selection_request_id);
  if (cursor === undefined) fail('SOURCE_CURSOR_MISSING');
  return material.shot_end_ms - cursor;
}

function appendSegment(
  drafts: SegmentDraft[],
  material: TimelineSelectedMaterialPlanningFactV1,
  timelineStartMs: number,
  timelineEndMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
  slotId: string,
  visualContinuityGroupId: string,
  reasons: readonly TimelinePhysicalSegmentReasonV1[],
): void {
  const previous = drafts.at(-1);
  if (
    previous &&
    previous.selection_request_id === material.selection_request_id &&
    previous.timeline_end_ms === timelineStartMs &&
    previous.source_end_ms === sourceStartMs
  ) {
    previous.timeline_end_ms = timelineEndMs;
    previous.duration_ms = previous.timeline_end_ms - previous.timeline_start_ms;
    previous.source_end_ms = sourceEndMs;
    if (!previous.slot_ids.includes(slotId)) previous.slot_ids = [...previous.slot_ids, slotId];
    previous.reason_codes = normalizedReasons(previous.reason_codes, reasons);
    return;
  }
  drafts.push({
    kind: 'REAL_MATERIAL',
    slot_ids: [slotId],
    visual_continuity_group_id: visualContinuityGroupId,
    timeline_start_ms: timelineStartMs,
    timeline_end_ms: timelineEndMs,
    duration_ms: timelineEndMs - timelineStartMs,
    source_asset_id: material.asset_id,
    source_shot_id: material.shot_id,
    source_revision: material.revision,
    source_start_ms: sourceStartMs,
    source_end_ms: sourceEndMs,
    selection_request_id: material.selection_request_id,
    decision_receipt_hash: material.decision_receipt_hash,
    selection_slot_id: material.slot_id,
    reason_codes: normalizedReasons([], reasons),
  });
}

function consume(
  material: TimelineSelectedMaterialPlanningFactV1,
  timelineStartMs: number,
  durationMs: number,
  slotId: string,
  visualContinuityGroupId: string,
  reasons: readonly TimelinePhysicalSegmentReasonV1[],
  sourceCursors: Map<string, number>,
  usedSelectionIds: Set<string>,
  segments: SegmentDraft[],
): void {
  if (durationMs <= 0) fail('SOURCE_CONSUMPTION_INVALID');
  const sourceStartMs = sourceCursors.get(material.selection_request_id);
  if (sourceStartMs === undefined) fail('SOURCE_CURSOR_MISSING');
  const sourceEndMs = sourceStartMs + durationMs;
  if (sourceEndMs > material.shot_end_ms) fail('SOURCE_CONSUMPTION_EXCEEDS_SHOT');
  sourceCursors.set(material.selection_request_id, sourceEndMs);
  usedSelectionIds.add(material.selection_request_id);
  appendSegment(
    segments,
    material,
    timelineStartMs,
    timelineStartMs + durationMs,
    sourceStartMs,
    sourceEndMs,
    slotId,
    visualContinuityGroupId,
    reasons,
  );
}

function consumeInterval(
  state: ActiveMaterialState,
  timelineStartMs: number,
  timelineEndMs: number,
  slot: TimelineMaterialSlotPlanningFactV1,
  firstReasons: readonly TimelinePhysicalSegmentReasonV1[],
  stitchedReasons: readonly TimelinePhysicalSegmentReasonV1[],
  sourceCursors: Map<string, number>,
  usedSelectionIds: Set<string>,
  segments: SegmentDraft[],
): number {
  let cursor = timelineStartMs;
  let firstPiece = true;
  while (cursor < timelineEndMs) {
    if (state.current && remainingSource(state.current, sourceCursors) === 0) state.current = null;
    if (!state.current) state.current = state.queue.shift() ?? null;
    if (!state.current) break;
    const consumed = Math.min(
      timelineEndMs - cursor,
      remainingSource(state.current, sourceCursors),
    );
    if (consumed === 0) {
      state.current = null;
      continue;
    }
    consume(
      state.current,
      cursor,
      consumed,
      slot.slot_id,
      slot.visual_continuity_group_id,
      firstPiece ? firstReasons : stitchedReasons,
      sourceCursors,
      usedSelectionIds,
      segments,
    );
    cursor += consumed;
    firstPiece = false;
    if (remainingSource(state.current, sourceCursors) === 0) state.current = null;
  }
  return cursor;
}

function intervalDuration(interval: Interval): number {
  return interval.timeline_end_ms - interval.timeline_start_ms;
}

function assertPositiveInterval(interval: Interval, code: string): void {
  if (
    !Number.isSafeInteger(interval.timeline_start_ms) ||
    !Number.isSafeInteger(interval.timeline_end_ms) ||
    interval.timeline_start_ms < 0 ||
    interval.timeline_end_ms <= interval.timeline_start_ms
  ) {
    fail(code);
  }
}

function assertExactlyCovered(domain: readonly Interval[], outcomes: readonly Interval[]): void {
  const orderedDomain = [...domain].sort(
    (left, right) => left.timeline_start_ms - right.timeline_start_ms,
  );
  for (let index = 1; index < orderedDomain.length; index += 1) {
    if (orderedDomain[index]!.timeline_start_ms < orderedDomain[index - 1]!.timeline_end_ms) {
      fail('EXECUTION_DOMAIN_OVERLAP');
    }
  }
  const orderedOutcomes = [...outcomes].sort(
    (left, right) => left.timeline_start_ms - right.timeline_start_ms,
  );
  for (let index = 1; index < orderedOutcomes.length; index += 1) {
    if (orderedOutcomes[index]!.timeline_start_ms < orderedOutcomes[index - 1]!.timeline_end_ms) {
      fail('EXECUTION_COVERAGE_OVERLAP');
    }
  }
  for (const expected of orderedDomain) {
    let cursor = expected.timeline_start_ms;
    const intersections = orderedOutcomes.filter(
      (outcome) =>
        outcome.timeline_start_ms < expected.timeline_end_ms &&
        expected.timeline_start_ms < outcome.timeline_end_ms,
    );
    for (const outcome of intersections) {
      const start = Math.max(outcome.timeline_start_ms, expected.timeline_start_ms);
      const end = Math.min(outcome.timeline_end_ms, expected.timeline_end_ms);
      if (start < cursor) fail('EXECUTION_COVERAGE_OVERLAP');
      if (start > cursor) fail('EXECUTION_COVERAGE_SILENT_HOLE');
      cursor = end;
    }
    if (cursor !== expected.timeline_end_ms) fail('EXECUTION_COVERAGE_SILENT_HOLE');
  }
  for (const outcome of orderedOutcomes) {
    let cursor = outcome.timeline_start_ms;
    const intersections = orderedDomain.filter(
      (expected) =>
        expected.timeline_start_ms < outcome.timeline_end_ms &&
        outcome.timeline_start_ms < expected.timeline_end_ms,
    );
    for (const expected of intersections) {
      const start = Math.max(expected.timeline_start_ms, outcome.timeline_start_ms);
      const end = Math.min(expected.timeline_end_ms, outcome.timeline_end_ms);
      if (start !== cursor) fail('OUTCOME_OUTSIDE_EXECUTION_DOMAIN');
      cursor = end;
    }
    if (cursor !== outcome.timeline_end_ms) fail('OUTCOME_OUTSIDE_EXECUTION_DOMAIN');
  }
}

export function validateTimelineDurationPlanV1(value: unknown): TimelineDurationPlanV1 {
  if (!isRecord(value)) fail('TIMELINE_DURATION_PLAN_INVALID');
  const plan = value as unknown as TimelineDurationPlanV1;
  if (
    !Array.isArray(plan.segments) ||
    !Array.isArray(plan.fallback_requirements) ||
    !Array.isArray(plan.additional_selection_requirements) ||
    !Array.isArray(plan.unused_committed_selection_refs) ||
    !Array.isArray(plan.execution_domain_intervals) ||
    !Array.isArray(plan.slot_transitions)
  ) {
    fail('TIMELINE_DURATION_PLAN_INVALID');
  }
  for (const interval of plan.execution_domain_intervals) {
    assertPositiveInterval(interval, 'EXECUTION_DOMAIN_INTERVAL_INVALID');
    if (interval.duration_ms !== intervalDuration(interval)) {
      fail('EXECUTION_DOMAIN_INTERVAL_INVALID');
    }
  }
  for (const segment of plan.segments) {
    assertPositiveInterval(segment, 'PHYSICAL_SEGMENT_GEOMETRY_INVALID');
    if (
      segment.kind !== 'REAL_MATERIAL' ||
      segment.duration_ms !== intervalDuration(segment) ||
      segment.source_end_ms <= segment.source_start_ms ||
      segment.source_end_ms - segment.source_start_ms !== segment.duration_ms ||
      segment.slot_ids.length === 0
    ) {
      fail('PHYSICAL_SEGMENT_GEOMETRY_INVALID');
    }
  }
  for (const requirement of plan.fallback_requirements) {
    assertPositiveInterval(requirement, 'FALLBACK_REQUIREMENT_GEOMETRY_INVALID');
    if (
      requirement.kind !== 'FALLBACK_REQUIRED' ||
      requirement.duration_ms !== intervalDuration(requirement)
    ) {
      fail('FALLBACK_REQUIREMENT_GEOMETRY_INVALID');
    }
  }
  for (const requirement of plan.additional_selection_requirements) {
    assertPositiveInterval(requirement, 'ADDITIONAL_SELECTION_REQUIREMENT_GEOMETRY_INVALID');
    if (
      requirement.kind !== 'ADDITIONAL_SELECTION_REQUIRED' ||
      requirement.duration_ms !== intervalDuration(requirement) ||
      requirement.remaining_duration_ms !== requirement.duration_ms
    ) {
      fail('ADDITIONAL_SELECTION_REQUIREMENT_GEOMETRY_INVALID');
    }
  }
  assertExactlyCovered(plan.execution_domain_intervals, [
    ...plan.segments,
    ...plan.fallback_requirements,
    ...plan.additional_selection_requirements,
  ]);
  if (
    typeof plan.duration_plan_hash !== 'string' ||
    computeTimelineDurationPlanHash(plan) !== plan.duration_plan_hash
  ) {
    fail('TIMELINE_DURATION_PLAN_HASH_MISMATCH');
  }
  return plan;
}

function pushAdditionalRequirement(
  drafts: AdditionalDraft[],
  slot: TimelineMaterialSlotPlanningFactV1,
  timelineStartMs: number,
  timelineEndMs: number,
  reason: TimelineAdditionalSelectionRequirementV1['reason'],
): void {
  drafts.push({
    kind: 'ADDITIONAL_SELECTION_REQUIRED',
    reason,
    slot_id: slot.slot_id,
    route: slot.route,
    visual_continuity_group_id: slot.visual_continuity_group_id,
    timeline_start_ms: timelineStartMs,
    timeline_end_ms: timelineEndMs,
    duration_ms: timelineEndMs - timelineStartMs,
    remaining_duration_ms: timelineEndMs - timelineStartMs,
  });
}

function transitionFor(
  previous: TimelineSlotPlanningFactV1,
  current: TimelineSlotPlanningFactV1,
  canContinue: boolean,
  carryingCurrent: boolean,
  barrier: boolean,
): TimelineSlotTransitionV1 {
  if (!isRealSlot(previous) || !isRealSlot(current)) {
    return {
      from_slot_id: previous.slot_id,
      to_slot_id: current.slot_id,
      decision: 'SWITCH',
      reason: 'FALLBACK_BOUNDARY',
    };
  }
  if (previous.route !== current.route) {
    return {
      from_slot_id: previous.slot_id,
      to_slot_id: current.slot_id,
      decision: 'SWITCH',
      reason: 'ROUTE_CHANGE',
    };
  }
  if (previous.visual_continuity_group_id !== current.visual_continuity_group_id) {
    return {
      from_slot_id: previous.slot_id,
      to_slot_id: current.slot_id,
      decision: 'SWITCH',
      reason: 'VISUAL_CONTINUITY_CHANGE',
    };
  }
  if (barrier || !canContinue) {
    return {
      from_slot_id: previous.slot_id,
      to_slot_id: current.slot_id,
      decision: 'SWITCH',
      reason: 'UNRESOLVED_PREVIOUS_COVERAGE',
    };
  }
  return {
    from_slot_id: previous.slot_id,
    to_slot_id: current.slot_id,
    decision: carryingCurrent ? 'ACTIVE_EXTENSION' : 'ACTIVE_STITCH',
    reason: 'SAME_ROUTE_AND_VISUAL_CONTINUITY',
  };
}

function nextEventStart(
  events: readonly { start: number }[],
  currentStart: number,
  currentEnd: number,
  totalDurationMs: number,
): number {
  return (
    events.find((candidate) => candidate.start >= currentEnd && candidate.start !== currentStart)
      ?.start ?? totalDurationMs
  );
}

export function planTimelineDurationV1(value: unknown): TimelineDurationPlanV1 {
  if (!isRecord(value)) fail('TIMELINE_DURATION_PLANNER_INPUT_INVALID');
  assertExactKeys(
    value,
    ['planning_facts', 'duration_policy'],
    'TIMELINE_DURATION_PLANNER_INPUT_INVALID',
  );
  const facts = assertPlanningFacts(value.planning_facts);
  const policy = parseTimelineDurationPolicyV1(value.duration_policy);
  if (
    policy.policy_id !== facts.timeline_policy_id ||
    policy.policy_version !== facts.timeline_policy_version ||
    policy.policy_snapshot_hash !== facts.timeline_policy_snapshot_hash
  ) {
    fail('TIMELINE_POLICY_BINDING_MISMATCH');
  }

  const allMaterials = facts.slots.flatMap((slot) =>
    isRealSlot(slot) ? [...slot.selected_materials] : [],
  );
  const sourceCursors = new Map<string, number>();
  for (const material of allMaterials) {
    if (sourceCursors.has(material.selection_request_id)) {
      fail('DUPLICATE_SELECTION_ID_IN_PLANNING_FACTS');
    }
    sourceCursors.set(material.selection_request_id, material.shot_start_ms);
  }

  const segments: SegmentDraft[] = [];
  const fallbackRequirements: FallbackDraft[] = [];
  const additionalRequirements: AdditionalDraft[] = [];
  const executionIntervals: ExecutionIntervalDraft[] = facts.slots.map((slot) => ({
    kind: 'NARRATION_SLOT',
    slot_id: slot.slot_id,
    pause_id: null,
    timeline_start_ms: slot.timeline_start_ms,
    timeline_end_ms: slot.timeline_end_ms,
    duration_ms: slot.required_duration_ms,
  }));
  executionIntervals.push(
    ...facts.pauses.map((pause) => ({
      kind: 'DECLARED_PAUSE' as const,
      slot_id: null,
      pause_id: pause.pause_id,
      timeline_start_ms: pause.start_ms,
      timeline_end_ms: pause.end_ms,
      duration_ms: pause.duration_ms,
    })),
  );
  const transitions: TimelineSlotTransitionV1[] = [];
  const usedSelectionIds = new Set<string>();
  const state: ActiveMaterialState = { current: null, queue: [] };

  const slotByStart = new Map(facts.slots.map((slot) => [slot.timeline_start_ms, slot]));
  const slotByEnd = new Map(facts.slots.map((slot) => [slot.timeline_end_ms, slot]));
  const baseEvents = [
    ...facts.slots.map((slot) => ({
      kind: 'SLOT' as const,
      start: slot.timeline_start_ms,
      end: slot.timeline_end_ms,
      slot,
    })),
    ...facts.pauses.map((pause) => ({
      kind: 'PAUSE' as const,
      start: pause.start_ms,
      end: pause.end_ms,
      pause,
    })),
  ].sort((left, right) => left.start - right.start);

  let previousSlot: TimelineSlotPlanningFactV1 | null = null;
  let barrierSincePreviousSlot = false;
  let spanNormalDurationMs = 0;
  let spanHasShortage = false;

  for (const event of baseEvents) {
    if (event.kind === 'PAUSE') {
      const left = slotByEnd.get(event.start);
      const right = slotByStart.get(event.end);
      if (left && right && isRealSlot(left) && isRealSlot(right) && previousSlot === left) {
        const coveredUntil = consumeInterval(
          state,
          event.start,
          event.end,
          left,
          state.current ? ['PAUSE_COVERAGE'] : ['PAUSE_COVERAGE', 'ACTIVE_STITCH'],
          ['PAUSE_COVERAGE', 'ACTIVE_STITCH'],
          sourceCursors,
          usedSelectionIds,
          segments,
        );
        if (coveredUntil < event.end) {
          pushAdditionalRequirement(
            additionalRequirements,
            left,
            coveredUntil,
            event.end,
            'PAUSE_COVERAGE_MATERIAL_EXHAUSTED',
          );
          spanHasShortage = true;
          barrierSincePreviousSlot = true;
        }
      } else {
        fallbackRequirements.push({
          kind: 'FALLBACK_REQUIRED',
          source: 'DECLARED_PAUSE_WITHOUT_REAL_SIDES',
          slot_id: null,
          pause_id: event.pause.pause_id,
          route: null,
          visual_continuity_group_id: null,
          timeline_start_ms: event.start,
          timeline_end_ms: event.end,
          duration_ms: event.end - event.start,
          committed_no_match: null,
        });
        state.current = null;
        state.queue = [];
        barrierSincePreviousSlot = true;
      }
      continue;
    }

    const slot = event.slot;
    const previousCompatible = previousSlot ? compatibleRealSlots(previousSlot, slot) : false;

    if (!isRealSlot(slot)) {
      if (previousSlot) {
        transitions.push(transitionFor(previousSlot, slot, false, false, true));
      }
      fallbackRequirements.push({
        kind: 'FALLBACK_REQUIRED',
        source: slot.fallback.source,
        slot_id: slot.slot_id,
        pause_id: null,
        route: slot.route,
        visual_continuity_group_id: slot.visual_continuity_group_id,
        timeline_start_ms: slot.timeline_start_ms,
        timeline_end_ms: slot.timeline_end_ms,
        duration_ms: slot.required_duration_ms,
        committed_no_match:
          slot.fallback.source === 'CODE_D_SELECTION_NO_MATCH'
            ? {
                selection_request_id: slot.fallback.selection_request_id,
                decision_receipt_hash: slot.fallback.decision_receipt_hash,
                batch_id: slot.fallback.batch_id,
                video_id: slot.fallback.video_id,
              }
            : null,
      });
      state.current = null;
      state.queue = [];
      spanNormalDurationMs = 0;
      spanHasShortage = false;
      barrierSincePreviousSlot = true;
      previousSlot = slot;
      continue;
    }

    const canContinue = previousCompatible && !barrierSincePreviousSlot;
    const carryingCurrent =
      canContinue && state.current !== null && remainingSource(state.current, sourceCursors) > 0;
    if (!canContinue) {
      state.current = null;
      spanNormalDurationMs = 0;
      spanHasShortage = false;
    }
    state.queue = [...slot.selected_materials];

    if (previousSlot) {
      transitions.push(
        transitionFor(previousSlot, slot, canContinue, carryingCurrent, barrierSincePreviousSlot),
      );
    }

    const coveredUntil = consumeInterval(
      state,
      slot.timeline_start_ms,
      slot.timeline_end_ms,
      slot,
      carryingCurrent ? ['ACTIVE_EXTENSION'] : canContinue ? ['ACTIVE_STITCH'] : ['DIRECT'],
      ['ACTIVE_STITCH'],
      sourceCursors,
      usedSelectionIds,
      segments,
    );
    spanNormalDurationMs += slot.required_duration_ms;
    if (coveredUntil < slot.timeline_end_ms) {
      pushAdditionalRequirement(
        additionalRequirements,
        slot,
        coveredUntil,
        slot.timeline_end_ms,
        'MATERIAL_EXHAUSTED',
      );
      spanHasShortage = true;
      barrierSincePreviousSlot = true;
    } else {
      barrierSincePreviousSlot = false;
    }

    const slotIndex = facts.slots.indexOf(slot);
    const nextSlot = facts.slots[slotIndex + 1];
    const nextCompatible = nextSlot ? compatibleRealSlots(slot, nextSlot) : false;
    const interveningPauses = nextSlot
      ? facts.pauses.filter(
          (pause) =>
            pause.start_ms >= slot.timeline_end_ms && pause.end_ms <= nextSlot.timeline_start_ms,
        )
      : [];
    const canPotentiallyContinue =
      nextCompatible &&
      (interveningPauses.length === 0 ||
        (interveningPauses.length === 1 &&
          interveningPauses[0]!.start_ms === slot.timeline_end_ms &&
          interveningPauses[0]!.end_ms === nextSlot!.timeline_start_ms));

    if (
      !canPotentiallyContinue &&
      !spanHasShortage &&
      spanNormalDurationMs < policy.passive_extension_target_min_ms &&
      policy.passive_extension_max_ms > 0 &&
      state.current &&
      remainingSource(state.current, sourceCursors) > 0
    ) {
      const windowEnd = nextEventStart(
        baseEvents,
        slot.timeline_start_ms,
        slot.timeline_end_ms,
        facts.total_duration_ms,
      );
      const extensionMs = Math.min(
        policy.passive_extension_target_min_ms - spanNormalDurationMs,
        policy.passive_extension_max_ms,
        Math.max(0, windowEnd - slot.timeline_end_ms),
        remainingSource(state.current, sourceCursors),
      );
      if (extensionMs > 0) {
        executionIntervals.push({
          kind: 'PASSIVE_EXTENSION',
          slot_id: slot.slot_id,
          pause_id: null,
          timeline_start_ms: slot.timeline_end_ms,
          timeline_end_ms: slot.timeline_end_ms + extensionMs,
          duration_ms: extensionMs,
        });
        consume(
          state.current,
          slot.timeline_end_ms,
          extensionMs,
          slot.slot_id,
          slot.visual_continuity_group_id,
          ['PASSIVE_EXTENSION'],
          sourceCursors,
          usedSelectionIds,
          segments,
        );
      }
    }

    previousSlot = slot;
  }

  const finalizedSegments: TimelinePhysicalSegmentV1[] = segments.map((segment, index) => ({
    segment_id: 'segment_' + String(index + 1).padStart(6, '0'),
    ...segment,
  }));
  const finalizedFallbacks: TimelineFallbackRequirementV1[] = fallbackRequirements.map(
    (requirement, index) => ({
      requirement_id: 'fallback_' + String(index + 1).padStart(6, '0'),
      ...requirement,
    }),
  );
  const finalizedAdditional: TimelineAdditionalSelectionRequirementV1[] =
    additionalRequirements.map((requirement, index) => ({
      requirement_id: 'additional_' + String(index + 1).padStart(6, '0'),
      ...requirement,
    }));
  const finalizedExecutionIntervals: TimelineExecutionDomainIntervalV1[] = executionIntervals
    .sort((left, right) => left.timeline_start_ms - right.timeline_start_ms)
    .map((interval, index) => ({
      execution_interval_id: 'execution_' + String(index + 1).padStart(6, '0'),
      ...interval,
    }));
  const unusedSelections: TimelineUnusedCommittedSelectionRefV1[] = allMaterials
    .filter((material) => !usedSelectionIds.has(material.selection_request_id))
    .map((material) => ({
      selection_request_id: material.selection_request_id,
      decision_receipt_hash: material.decision_receipt_hash,
      asset_id: material.asset_id,
      shot_id: material.shot_id,
      slot_id: material.slot_id,
    }));

  const preimage: Omit<TimelineDurationPlanV1, 'duration_plan_hash'> = {
    schema_version: '1.0',
    planning_request_id: facts.planning_request_id,
    planning_facts_hash: facts.planning_facts_hash,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_snapshot_hash: policy.policy_snapshot_hash,
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
    segments: finalizedSegments,
    fallback_requirements: finalizedFallbacks,
    additional_selection_requirements: finalizedAdditional,
    unused_committed_selection_refs: unusedSelections,
    execution_domain_intervals: finalizedExecutionIntervals,
    slot_transitions: transitions,
  };
  return validateTimelineDurationPlanV1({
    ...preimage,
    duration_plan_hash: computeTimelineDurationPlanHash(preimage),
  });
}
