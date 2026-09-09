import type { TimelinePlanningRequestV1 } from '@app/contracts';
import { canonicalJson, sha256 } from '@app/domain-media-index';
import { parseTimelinePlanningRequestV1 } from './hash.js';

const IDENTITY_MAX_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

interface ResolvedMaterialDecisionBaseV1 {
  selection_request_id: string;
  decision_receipt_hash: string;
  batch_id: string;
  video_id: string;
  slot_id: string;
}

export interface ResolvedSelectedMaterialDecisionEvidenceV1 extends ResolvedMaterialDecisionBaseV1 {
  status: 'SELECTED';
  asset_id: string;
  shot_id: string;
  revision: number;
  shot_start_ms: number;
  shot_end_ms: number;
}

export interface ResolvedNoMatchMaterialDecisionEvidenceV1 extends ResolvedMaterialDecisionBaseV1 {
  status: 'NO_MATCH';
}

export type ResolvedMaterialDecisionEvidenceV1 =
  | ResolvedSelectedMaterialDecisionEvidenceV1
  | ResolvedNoMatchMaterialDecisionEvidenceV1;

export interface TimelinePlannerInputV1 {
  request: TimelinePlanningRequestV1;
  resolved_material_decisions: readonly ResolvedMaterialDecisionEvidenceV1[];
}

export type TimelineMaterialDurationStateV1 =
  | 'MATERIAL_AVAILABLE'
  | 'MATERIAL_INSUFFICIENT_DURATION';

export interface TimelineSelectedMaterialPlanningFactV1 {
  selection_request_id: string;
  decision_receipt_hash: string;
  batch_id: string;
  video_id: string;
  slot_id: string;
  asset_id: string;
  shot_id: string;
  revision: number;
  shot_start_ms: number;
  shot_end_ms: number;
  available_duration_ms: number;
  duration_delta_ms: number;
  duration_state: TimelineMaterialDurationStateV1;
}

interface TimelineSlotPlanningFactBaseV1 {
  slot_id: string;
  order_index: number;
  source_start: number;
  source_end: number;
  route: 'ANIMAL' | 'PRODUCT' | 'NO_MATCH';
  visual_continuity_group_id: string;
  timeline_start_ms: number;
  timeline_end_ms: number;
  required_duration_ms: number;
}

export interface TimelineMaterialSlotPlanningFactV1 extends TimelineSlotPlanningFactBaseV1 {
  route: 'ANIMAL' | 'PRODUCT';
  state: TimelineMaterialDurationStateV1;
  selected_materials: readonly [
    TimelineSelectedMaterialPlanningFactV1,
    ...TimelineSelectedMaterialPlanningFactV1[],
  ];
  fallback: null;
}

export interface TimelineUpstreamFallbackSlotPlanningFactV1 extends TimelineSlotPlanningFactBaseV1 {
  route: 'NO_MATCH';
  state: 'FALLBACK_REQUIRED';
  selected_materials: readonly [];
  fallback: {
    source: 'SHOT_PLAN_ROUTE_NO_MATCH';
  };
}

export interface TimelineCodeDNoMatchSlotPlanningFactV1 extends TimelineSlotPlanningFactBaseV1 {
  route: 'ANIMAL' | 'PRODUCT';
  state: 'FALLBACK_REQUIRED';
  selected_materials: readonly [];
  fallback: {
    source: 'CODE_D_SELECTION_NO_MATCH';
    selection_request_id: string;
    decision_receipt_hash: string;
    batch_id: string;
    video_id: string;
    slot_id: string;
  };
}

export type TimelineSlotPlanningFactV1 =
  | TimelineMaterialSlotPlanningFactV1
  | TimelineUpstreamFallbackSlotPlanningFactV1
  | TimelineCodeDNoMatchSlotPlanningFactV1;

export interface TimelinePausePlanningFactV1 {
  pause_id: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
}

export interface TimelinePlanningFactsV1 {
  schema_version: '1.0';
  planning_request_id: string;
  timeline_request_hash: string;
  shot_plan_id: string;
  shot_plan_hash: string;
  timing_snapshot_id: string;
  timing_snapshot_hash: string;
  source_document_id: string;
  source_document_hash: string;
  narration_audio_id: string;
  narration_audio_hash: string;
  total_duration_ms: number;
  timeline_policy_id: string;
  timeline_policy_version: string;
  timeline_policy_snapshot_hash: string;
  material_context: { batch_id: string; video_id: string } | null;
  slots: readonly TimelineSlotPlanningFactV1[];
  pauses: readonly TimelinePausePlanningFactV1[];
  planning_facts_hash: string;
}

type TimelinePlanningFactsHashInput =
  | TimelinePlanningFactsV1
  | Omit<TimelinePlanningFactsV1, 'planning_facts_hash'>;

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

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(code);
  return value;
}

function integer(value: unknown, code: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(code);
  return value as number;
}

function parseResolvedEvidence(value: unknown): ResolvedMaterialDecisionEvidenceV1 {
  if (!isRecord(value)) fail('RESOLVED_DECISION_EVIDENCE_INVALID');
  const baseKeys = [
    'selection_request_id',
    'decision_receipt_hash',
    'batch_id',
    'video_id',
    'slot_id',
    'status',
  ] as const;
  if (value.status === 'SELECTED') {
    assertExactKeys(
      value,
      [...baseKeys, 'asset_id', 'shot_id', 'revision', 'shot_start_ms', 'shot_end_ms'],
      'RESOLVED_SELECTED_DECISION_EVIDENCE_INVALID',
    );
    const shotStartMs = integer(value.shot_start_ms, 'SELECTED_SHOT_RANGE_INVALID', 0);
    const shotEndMs = integer(value.shot_end_ms, 'SELECTED_SHOT_RANGE_INVALID', 1);
    if (shotEndMs <= shotStartMs) fail('SELECTED_SHOT_RANGE_INVALID');
    return {
      selection_request_id: identity(value.selection_request_id, 'RESOLVED_DECISION_ID_INVALID'),
      decision_receipt_hash: hash(value.decision_receipt_hash, 'RESOLVED_RECEIPT_HASH_INVALID'),
      batch_id: identity(value.batch_id, 'RESOLVED_BATCH_ID_INVALID'),
      video_id: identity(value.video_id, 'RESOLVED_VIDEO_ID_INVALID'),
      slot_id: identity(value.slot_id, 'RESOLVED_SLOT_ID_INVALID'),
      status: 'SELECTED',
      asset_id: identity(value.asset_id, 'RESOLVED_ASSET_ID_INVALID'),
      shot_id: identity(value.shot_id, 'RESOLVED_SHOT_ID_INVALID'),
      revision: integer(value.revision, 'RESOLVED_REVISION_INVALID', 1),
      shot_start_ms: shotStartMs,
      shot_end_ms: shotEndMs,
    };
  }
  if (value.status === 'NO_MATCH') {
    assertExactKeys(value, baseKeys, 'RESOLVED_NO_MATCH_DECISION_EVIDENCE_INVALID');
    return {
      selection_request_id: identity(value.selection_request_id, 'RESOLVED_DECISION_ID_INVALID'),
      decision_receipt_hash: hash(value.decision_receipt_hash, 'RESOLVED_RECEIPT_HASH_INVALID'),
      batch_id: identity(value.batch_id, 'RESOLVED_BATCH_ID_INVALID'),
      video_id: identity(value.video_id, 'RESOLVED_VIDEO_ID_INVALID'),
      slot_id: identity(value.slot_id, 'RESOLVED_SLOT_ID_INVALID'),
      status: 'NO_MATCH',
    };
  }
  return fail('RESOLVED_DECISION_STATUS_INVALID');
}

function parsePlannerInput(value: unknown): {
  request: TimelinePlanningRequestV1;
  resolved: ResolvedMaterialDecisionEvidenceV1[];
} {
  if (!isRecord(value)) fail('TIMELINE_PLANNER_INPUT_INVALID');
  assertExactKeys(
    value,
    ['request', 'resolved_material_decisions'],
    'TIMELINE_PLANNER_INPUT_INVALID',
  );
  const request = parseTimelinePlanningRequestV1(value.request);
  if (!Array.isArray(value.resolved_material_decisions)) {
    fail('RESOLVED_DECISION_EVIDENCE_INVALID');
  }
  return {
    request,
    resolved: value.resolved_material_decisions.map(parseResolvedEvidence),
  };
}

function materialFact(
  evidence: ResolvedSelectedMaterialDecisionEvidenceV1,
  requiredDurationMs: number,
): TimelineSelectedMaterialPlanningFactV1 {
  const availableDurationMs = evidence.shot_end_ms - evidence.shot_start_ms;
  const durationDeltaMs = availableDurationMs - requiredDurationMs;
  return {
    selection_request_id: evidence.selection_request_id,
    decision_receipt_hash: evidence.decision_receipt_hash,
    batch_id: evidence.batch_id,
    video_id: evidence.video_id,
    slot_id: evidence.slot_id,
    asset_id: evidence.asset_id,
    shot_id: evidence.shot_id,
    revision: evidence.revision,
    shot_start_ms: evidence.shot_start_ms,
    shot_end_ms: evidence.shot_end_ms,
    available_duration_ms: availableDurationMs,
    duration_delta_ms: durationDeltaMs,
    duration_state: durationDeltaMs >= 0 ? 'MATERIAL_AVAILABLE' : 'MATERIAL_INSUFFICIENT_DURATION',
  };
}

export function computeTimelinePlanningFactsHash(value: TimelinePlanningFactsHashInput): string {
  const preimage = Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== 'planning_facts_hash'),
  );
  return sha256(canonicalJson(preimage));
}

export function normalizeTimelinePlanningFactsV1(value: unknown): TimelinePlanningFactsV1 {
  const { request, resolved } = parsePlannerInput(value);
  const evidenceByRequestId = new Map<string, ResolvedMaterialDecisionEvidenceV1>();
  for (const evidence of resolved) {
    if (evidenceByRequestId.has(evidence.selection_request_id)) {
      fail('DUPLICATE_RESOLVED_SELECTION_REQUEST_ID');
    }
    evidenceByRequestId.set(evidence.selection_request_id, evidence);
  }

  const materialContext = resolved[0]
    ? { batch_id: resolved[0].batch_id, video_id: resolved[0].video_id }
    : null;
  if (
    materialContext &&
    resolved.some(
      (evidence) =>
        evidence.batch_id !== materialContext.batch_id ||
        evidence.video_id !== materialContext.video_id,
    )
  ) {
    fail('CONFLICTING_MATERIAL_DECISION_CONTEXT');
  }

  const planSlots = new Map(request.confirmed_shot_plan.slots.map((slot) => [slot.slot_id, slot]));
  for (const evidence of resolved) {
    const slot = planSlots.get(evidence.slot_id);
    if (!slot) fail('RESOLVED_DECISION_UNKNOWN_SLOT');
    if (slot.route === 'NO_MATCH') fail('UNEXPECTED_DECISION_FOR_UPSTREAM_NO_MATCH_SLOT');
  }

  const selectedBySlot = new Map<string, ResolvedSelectedMaterialDecisionEvidenceV1[]>();
  const referencedSelectionIds = new Set<string>();
  for (const reference of request.committed_selection_refs) {
    const evidence = evidenceByRequestId.get(reference.selection_request_id);
    if (!evidence) fail('SELECTION_REFERENCE_CANNOT_RESOLVE');
    if (evidence.status !== 'SELECTED') fail('SELECTION_REFERENCE_REQUIRES_SELECTED_DECISION');
    if (evidence.decision_receipt_hash !== reference.decision_receipt_hash) {
      fail('SELECTED_DECISION_RECEIPT_HASH_MISMATCH');
    }
    if (evidence.asset_id !== reference.asset_id) fail('SELECTED_DECISION_ASSET_ID_MISMATCH');
    if (evidence.shot_id !== reference.shot_id) fail('SELECTED_DECISION_SHOT_ID_MISMATCH');
    referencedSelectionIds.add(evidence.selection_request_id);
    const selected = selectedBySlot.get(evidence.slot_id) ?? [];
    selected.push(evidence);
    selectedBySlot.set(evidence.slot_id, selected);
  }

  const noMatchBySlot = new Map<string, ResolvedNoMatchMaterialDecisionEvidenceV1[]>();
  for (const evidence of resolved) {
    if (evidence.status === 'SELECTED') {
      if (!referencedSelectionIds.has(evidence.selection_request_id)) {
        fail('UNREFERENCED_SELECTED_DECISION');
      }
      continue;
    }
    const decisions = noMatchBySlot.get(evidence.slot_id) ?? [];
    decisions.push(evidence);
    noMatchBySlot.set(evidence.slot_id, decisions);
  }

  const timingBySlot = new Map(
    request.narration_timing_snapshot.slot_timings.map((timing) => [timing.slot_id, timing]),
  );
  const slots: TimelineSlotPlanningFactV1[] = request.confirmed_shot_plan.slots.map((slot) => {
    const timing = timingBySlot.get(slot.slot_id);
    if (!timing) fail('TIMING_SLOT_CANNOT_RESOLVE');
    const base = {
      slot_id: slot.slot_id,
      order_index: slot.order_index,
      source_start: slot.source_start,
      source_end: slot.source_end,
      route: slot.route,
      visual_continuity_group_id: slot.visual_continuity_group_id,
      timeline_start_ms: timing.start_ms,
      timeline_end_ms: timing.end_ms,
      required_duration_ms: timing.end_ms - timing.start_ms,
    };
    const selected = selectedBySlot.get(slot.slot_id) ?? [];
    const noMatches = noMatchBySlot.get(slot.slot_id) ?? [];
    if (slot.route === 'NO_MATCH') {
      return {
        ...base,
        route: 'NO_MATCH',
        state: 'FALLBACK_REQUIRED',
        selected_materials: [],
        fallback: { source: 'SHOT_PLAN_ROUTE_NO_MATCH' },
      };
    }
    if (selected.length > 0 && noMatches.length > 0) {
      fail('CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT');
    }
    if (noMatches.length > 1) fail('CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT');
    if (selected.length === 0) {
      const noMatch = noMatches[0];
      if (!noMatch) fail('MISSING_MATERIAL_DECISION_EVIDENCE');
      return {
        ...base,
        route: slot.route,
        state: 'FALLBACK_REQUIRED',
        selected_materials: [],
        fallback: {
          source: 'CODE_D_SELECTION_NO_MATCH',
          selection_request_id: noMatch.selection_request_id,
          decision_receipt_hash: noMatch.decision_receipt_hash,
          batch_id: noMatch.batch_id,
          video_id: noMatch.video_id,
          slot_id: noMatch.slot_id,
        },
      };
    }
    const selectedMaterials = selected.map((evidence) =>
      materialFact(evidence, base.required_duration_ms),
    ) as [TimelineSelectedMaterialPlanningFactV1, ...TimelineSelectedMaterialPlanningFactV1[]];
    return {
      ...base,
      route: slot.route,
      state: selectedMaterials.some((material) => material.duration_delta_ms >= 0)
        ? 'MATERIAL_AVAILABLE'
        : 'MATERIAL_INSUFFICIENT_DURATION',
      selected_materials: selectedMaterials,
      fallback: null,
    };
  });

  const preimage: Omit<TimelinePlanningFactsV1, 'planning_facts_hash'> = {
    schema_version: '1.0',
    planning_request_id: request.planning_request_id,
    timeline_request_hash: request.timeline_request_hash,
    shot_plan_id: request.confirmed_shot_plan.shot_plan_id,
    shot_plan_hash: request.confirmed_shot_plan.shot_plan_hash,
    timing_snapshot_id: request.narration_timing_snapshot.timing_snapshot_id,
    timing_snapshot_hash: request.narration_timing_snapshot.timing_snapshot_hash,
    source_document_id: request.confirmed_shot_plan.source_document_id,
    source_document_hash: request.confirmed_shot_plan.source_document_hash,
    narration_audio_id: request.narration_timing_snapshot.narration_audio_id,
    narration_audio_hash: request.narration_timing_snapshot.narration_audio_hash,
    total_duration_ms: request.narration_timing_snapshot.total_duration_ms,
    timeline_policy_id: request.timeline_policy_id,
    timeline_policy_version: request.timeline_policy_version,
    timeline_policy_snapshot_hash: request.timeline_policy_snapshot_hash,
    material_context: materialContext,
    slots,
    pauses: request.narration_timing_snapshot.pause_intervals.map((pause) => ({
      pause_id: pause.pause_id,
      start_ms: pause.start_ms,
      end_ms: pause.end_ms,
      duration_ms: pause.end_ms - pause.start_ms,
    })),
  };
  return { ...preimage, planning_facts_hash: computeTimelinePlanningFactsHash(preimage) };
}
