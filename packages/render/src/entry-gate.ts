import type { TimelinePlanningRequestV1 } from '@app/contracts';
import {
  type TimelineDurationPlanV1,
  type TimelinePlanningFactsV1,
  type TimelineSelectedMaterialPlanningFactV1,
} from '@app/timeline';
import type { RenderAcceptedTimelineRequestV1 } from './contracts.js';

export interface RenderTimelineCommitReceiptV1 {
  timeline_id: string;
  version: number;
  duration_plan_hash: string;
  commit_receipt_hash: string;
}

export interface RenderCommittedTimelineV1 {
  timeline_id: string;
  version: number;
  planning_request: TimelinePlanningRequestV1;
  planning_facts: TimelinePlanningFactsV1;
  duration_plan: TimelineDurationPlanV1;
  commit_receipt: RenderTimelineCommitReceiptV1;
}

export interface VerifiedCodeDDecisionV1 {
  selection_request_id: string;
  decision_receipt_hash: string;
  slot_id: string;
  status: 'SELECTED';
  asset_id: string;
  shot_id: string;
  revision: number;
  shot_start_ms: number;
  shot_end_ms: number;
}

export interface StructurallyBoundRenderSegmentV1 {
  segment_id: string;
  asset_id: string;
  revision: number;
  shot_id: string;
  shot_start_ms: number;
  shot_end_ms: number;
  source_start_ms: number;
  source_end_ms: number;
  timeline_start_ms: number;
  timeline_end_ms: number;
  selection_request_id: string;
  decision_receipt_hash: string;
  selection_slot_id: string;
}

function exactlyOne<T>(values: readonly T[], code: string): T {
  if (values.length !== 1) throw new Error(code);
  return values[0]!;
}

function selectedMaterials(
  facts: TimelinePlanningFactsV1,
): TimelineSelectedMaterialPlanningFactV1[] {
  return facts.slots.flatMap((slot) => slot.selected_materials);
}

export function validateRenderEntryV1(input: {
  request: RenderAcceptedTimelineRequestV1;
  timeline: RenderCommittedTimelineV1;
  code_d_decisions: readonly VerifiedCodeDDecisionV1[];
}): StructurallyBoundRenderSegmentV1[] {
  const { request, timeline } = input;
  if (
    timeline.timeline_id !== request.timeline_id ||
    timeline.version !== request.timeline_version ||
    timeline.commit_receipt.timeline_id !== request.timeline_id ||
    timeline.commit_receipt.version !== request.timeline_version
  ) {
    throw new Error('RENDER_TIMELINE_EXACT_PIN_MISMATCH');
  }
  if (
    timeline.commit_receipt.commit_receipt_hash !== request.expected_timeline_commit_receipt_hash
  ) {
    throw new Error('RENDER_TIMELINE_RECEIPT_MISMATCH');
  }
  if (timeline.commit_receipt.duration_plan_hash !== timeline.duration_plan.duration_plan_hash) {
    throw new Error('RENDER_TIMELINE_DURATION_PLAN_BINDING_MISMATCH');
  }
  if (timeline.duration_plan.additional_selection_requirements.length > 0) {
    throw new Error('RENDER_ADDITIONAL_SELECTION_UNRESOLVED');
  }
  if (timeline.duration_plan.fallback_requirements.length > 0) {
    throw new Error('RENDER_FALLBACK_UNRESOLVED');
  }

  const materials = selectedMaterials(timeline.planning_facts);
  const selectionRefs = timeline.planning_request.committed_selection_refs;
  const decisions = input.code_d_decisions;
  const segmentIds = new Set<string>();

  return timeline.duration_plan.segments.map((segment) => {
    if (segmentIds.has(segment.segment_id)) {
      throw new Error('RENDER_SEGMENT_ID_DUPLICATE');
    }
    segmentIds.add(segment.segment_id);
    const material = exactlyOne(
      materials.filter(
        (candidate) => candidate.selection_request_id === segment.selection_request_id,
      ),
      'RENDER_SEGMENT_MATERIAL_BINDING_NOT_EXACTLY_ONE',
    );
    const selectionRef = exactlyOne(
      selectionRefs.filter(
        (candidate) => candidate.selection_request_id === segment.selection_request_id,
      ),
      'RENDER_SEGMENT_SELECTION_REF_NOT_EXACTLY_ONE',
    );
    const decision = exactlyOne(
      decisions.filter(
        (candidate) => candidate.selection_request_id === segment.selection_request_id,
      ),
      'RENDER_SEGMENT_CODE_D_EVIDENCE_NOT_EXACTLY_ONE',
    );
    if (
      segment.decision_receipt_hash !== material.decision_receipt_hash ||
      segment.decision_receipt_hash !== selectionRef.decision_receipt_hash ||
      segment.decision_receipt_hash !== decision.decision_receipt_hash
    ) {
      throw new Error('RENDER_SEGMENT_DECISION_RECEIPT_MISMATCH');
    }
    if (
      segment.selection_slot_id !== material.slot_id ||
      segment.selection_slot_id !== decision.slot_id
    ) {
      throw new Error('RENDER_SEGMENT_SELECTION_SLOT_MISMATCH');
    }
    if (
      segment.source_asset_id !== material.asset_id ||
      segment.source_asset_id !== selectionRef.asset_id ||
      segment.source_asset_id !== decision.asset_id
    ) {
      throw new Error('RENDER_SEGMENT_ASSET_ID_MISMATCH');
    }
    if (
      segment.source_shot_id !== material.shot_id ||
      segment.source_shot_id !== selectionRef.shot_id ||
      segment.source_shot_id !== decision.shot_id
    ) {
      throw new Error('RENDER_SEGMENT_SHOT_ID_MISMATCH');
    }
    if (segment.source_revision !== material.revision) {
      throw new Error('RENDER_SEGMENT_REVISION_MISMATCH');
    }
    if (
      decision.revision !== material.revision ||
      decision.shot_start_ms !== material.shot_start_ms ||
      decision.shot_end_ms !== material.shot_end_ms
    ) {
      throw new Error('RENDER_SEGMENT_CODE_D_SOURCE_IDENTITY_MISMATCH');
    }
    if (
      segment.source_start_ms < material.shot_start_ms ||
      segment.source_end_ms > material.shot_end_ms ||
      segment.source_end_ms <= segment.source_start_ms
    ) {
      throw new Error('RENDER_SEGMENT_SOURCE_RANGE_MISMATCH');
    }
    return {
      segment_id: segment.segment_id,
      asset_id: segment.source_asset_id,
      revision: segment.source_revision,
      shot_id: segment.source_shot_id,
      shot_start_ms: material.shot_start_ms,
      shot_end_ms: material.shot_end_ms,
      source_start_ms: segment.source_start_ms,
      source_end_ms: segment.source_end_ms,
      timeline_start_ms: segment.timeline_start_ms,
      timeline_end_ms: segment.timeline_end_ms,
      selection_request_id: segment.selection_request_id,
      decision_receipt_hash: segment.decision_receipt_hash,
      selection_slot_id: segment.selection_slot_id,
    };
  });
}
