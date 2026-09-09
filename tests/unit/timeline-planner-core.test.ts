import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  committedMaterialSelectionRefV1Schema,
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type CommittedMaterialSelectionRefV1,
  type ConfirmedShotPlanSlotV1,
  type ConfirmedShotPlanV1,
  type NarrationPauseIntervalV1,
  type NarrationSlotTimingV1,
  type NarrationTimingSnapshotV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import { canonicalJson } from '../../packages/domain-media-index/src/signature.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelinePlanningFactsHash,
  computeTimelinePlanningRequestHash,
  normalizeTimelinePlanningFactsV1,
  type ResolvedNoMatchMaterialDecisionEvidenceV1,
  type ResolvedSelectedMaterialDecisionEvidenceV1,
  type TimelinePlannerInputV1,
} from '../../packages/timeline/src/index.js';

const sourceDocumentHash = '1'.repeat(64);
const narrationAudioHash = '2'.repeat(64);
const policyHash = '3'.repeat(64);
const receiptHashA = '4'.repeat(64);
const receiptHashB = '5'.repeat(64);
const receiptHashC = '6'.repeat(64);

function makePlan(
  slots: ConfirmedShotPlanSlotV1[] = [
    {
      slot_id: 'slot_1',
      order_index: 0,
      source_start: 0,
      source_end: 2,
      source_text: '牛羊',
      route: 'ANIMAL',
      visual_continuity_group_id: 'visual_group_shared',
    },
    {
      slot_id: 'slot_2',
      order_index: 1,
      source_start: 2,
      source_end: 4,
      source_text: '产品',
      route: 'PRODUCT',
      visual_continuity_group_id: 'visual_group_shared',
    },
    {
      slot_id: 'slot_3',
      order_index: 2,
      source_start: 4,
      source_end: 6,
      source_text: '讲解',
      route: 'NO_MATCH',
      visual_continuity_group_id: 'visual_group_fallback',
    },
  ],
): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'shot_plan_1',
    shot_plan_version: 1,
    source_document_id: 'script_1',
    source_document_version: 1,
    source_document_hash: sourceDocumentHash,
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots,
  };
  return confirmedShotPlanV1Schema.parse({
    ...preimage,
    shot_plan_hash: computeConfirmedShotPlanHash(preimage),
  });
}

function makeTiming(
  plan = makePlan(),
  slotTimings: NarrationSlotTimingV1[] = [
    { slot_id: 'slot_1', start_ms: 0, end_ms: 1000 },
    { slot_id: 'slot_2', start_ms: 1200, end_ms: 2200 },
    { slot_id: 'slot_3', start_ms: 2300, end_ms: 2800 },
  ],
  pauses: NarrationPauseIntervalV1[] = [
    { pause_id: 'pause_1', start_ms: 1000, end_ms: 1200 },
    { pause_id: 'pause_2', start_ms: 2200, end_ms: 2300 },
  ],
): NarrationTimingSnapshotV1 {
  const preimage: Omit<NarrationTimingSnapshotV1, 'timing_snapshot_hash'> = {
    schema_version: '1.0',
    timing_snapshot_id: 'timing_1',
    timing_snapshot_version: 1,
    timing_kind: 'EXACT',
    shot_plan_id: plan.shot_plan_id,
    shot_plan_hash: plan.shot_plan_hash,
    source_document_id: plan.source_document_id,
    source_document_hash: plan.source_document_hash,
    narration_audio_id: 'audio_1',
    narration_audio_hash: narrationAudioHash,
    total_duration_ms: 3000,
    slot_timings: slotTimings,
    pause_intervals: pauses,
  };
  return narrationTimingSnapshotV1Schema.parse({
    ...preimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(preimage),
  });
}

function selectionRef(
  selectionRequestId: string,
  decisionReceiptHash: string,
  assetId: string,
  shotId: string,
): CommittedMaterialSelectionRefV1 {
  return committedMaterialSelectionRefV1Schema.parse({
    selection_request_id: selectionRequestId,
    decision_receipt_hash: decisionReceiptHash,
    asset_id: assetId,
    shot_id: shotId,
  });
}

function makeRequest(
  plan = makePlan(),
  timing = makeTiming(plan),
  references: CommittedMaterialSelectionRefV1[] = [
    selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    selectionRef('selection_2', receiptHashB, 'asset_2', 'shot_2'),
  ],
): TimelinePlanningRequestV1 {
  const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
    schema_version: '1.0',
    planning_request_id: 'timeline_request_1',
    confirmed_shot_plan: plan,
    narration_timing_snapshot: timing,
    committed_selection_refs: references,
    timeline_policy_id: 'timeline-policy-v1',
    timeline_policy_version: '1.0.0',
    timeline_policy_snapshot_hash: policyHash,
  };
  return timelinePlanningRequestV1Schema.parse({
    ...preimage,
    timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
  });
}

function selected(
  overrides: Partial<ResolvedSelectedMaterialDecisionEvidenceV1> = {},
): ResolvedSelectedMaterialDecisionEvidenceV1 {
  return {
    selection_request_id: 'selection_1',
    decision_receipt_hash: receiptHashA,
    batch_id: 'batch_1',
    video_id: 'video_1',
    slot_id: 'slot_1',
    status: 'SELECTED',
    asset_id: 'asset_1',
    shot_id: 'shot_1',
    revision: 1,
    shot_start_ms: 100,
    shot_end_ms: 1100,
    ...overrides,
  };
}

function selectedForSlot2(
  overrides: Partial<ResolvedSelectedMaterialDecisionEvidenceV1> = {},
): ResolvedSelectedMaterialDecisionEvidenceV1 {
  return selected({
    selection_request_id: 'selection_2',
    decision_receipt_hash: receiptHashB,
    slot_id: 'slot_2',
    asset_id: 'asset_2',
    shot_id: 'shot_2',
    shot_start_ms: 0,
    shot_end_ms: 1500,
    ...overrides,
  });
}

function noMatch(
  overrides: Partial<ResolvedNoMatchMaterialDecisionEvidenceV1> = {},
): ResolvedNoMatchMaterialDecisionEvidenceV1 {
  return {
    selection_request_id: 'selection_no_match',
    decision_receipt_hash: receiptHashC,
    batch_id: 'batch_1',
    video_id: 'video_1',
    slot_id: 'slot_2',
    status: 'NO_MATCH',
    ...overrides,
  };
}

function baseInput(): TimelinePlannerInputV1 {
  return {
    request: makeRequest(),
    resolved_material_decisions: [selected(), selectedForSlot2()],
  };
}

function expectFailure(input: unknown, code: string): void {
  expect(() => normalizeTimelinePlanningFactsV1(input)).toThrowError(code);
}

describe('Code E E2 pure timeline planner core', () => {
  it('produces byte-equivalent canonical output for 100 executions', () => {
    const input = baseInput();
    const outputs = Array.from({ length: 100 }, () =>
      canonicalJson(normalizeTimelinePlanningFactsV1(input)),
    );
    expect(new Set(outputs)).toEqual(new Set([outputs[0]]));
  });

  it('does not let resolved evidence row order change normalized output', () => {
    const input = baseInput();
    const reversed = {
      ...input,
      resolved_material_decisions: [...input.resolved_material_decisions].reverse(),
    };
    expect(canonicalJson(normalizeTimelinePlanningFactsV1(reversed))).toBe(
      canonicalJson(normalizeTimelinePlanningFactsV1(input)),
    );
  });

  it('fails closed when the frozen timeline_request_hash does not match', () => {
    const input = baseInput();
    expectFailure(
      {
        request: { ...input.request, timeline_request_hash: '0'.repeat(64) },
        resolved_material_decisions: input.resolved_material_decisions,
      },
      'TIMELINE_PLANNING_REQUEST_HASH_MISMATCH',
    );
  });

  it('resolves a SELECTED decision exactly by selection_request_id', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots[0]!.selected_materials[0]!.selection_request_id).toBe('selection_1');
    expect(output.slots[1]!.selected_materials[0]!.selection_request_id).toBe('selection_2');
  });

  it('fails closed when a selection reference cannot resolve', () => {
    const input = baseInput();
    expectFailure(
      { ...input, resolved_material_decisions: [selected()] },
      'SELECTION_REFERENCE_CANNOT_RESOLVE',
    );
  });

  it('fails closed on a SELECTED receipt hash mismatch', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [
          selected({ decision_receipt_hash: receiptHashC }),
          selectedForSlot2(),
        ],
      },
      'SELECTED_DECISION_RECEIPT_HASH_MISMATCH',
    );
  });

  it('fails closed on a SELECTED asset identity mismatch', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [
          selected({ asset_id: 'different_asset' }),
          selectedForSlot2(),
        ],
      },
      'SELECTED_DECISION_ASSET_ID_MISMATCH',
    );
  });

  it('fails closed on a SELECTED shot identity mismatch', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected({ shot_id: 'different_shot' }), selectedForSlot2()],
      },
      'SELECTED_DECISION_SHOT_ID_MISMATCH',
    );
  });

  it('never treats array position as slot identity', () => {
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan), [
      selectionRef('selection_2', receiptHashB, 'asset_2', 'shot_2'),
      selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    ]);
    const output = normalizeTimelinePlanningFactsV1({
      request,
      resolved_material_decisions: [selectedForSlot2(), selected()],
    });
    expect(output.slots.map((slot) => slot.slot_id)).toEqual(['slot_1', 'slot_2', 'slot_3']);
    expect(output.slots[0]!.selected_materials[0]!.asset_id).toBe('asset_1');
    expect(output.slots[1]!.selected_materials[0]!.asset_id).toBe('asset_2');
  });

  it('fails closed when resolved evidence points to an unknown slot', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected({ slot_id: 'unknown_slot' }), selectedForSlot2()],
      },
      'RESOLVED_DECISION_UNKNOWN_SLOT',
    );
  });

  it('does not repair a resolved decision bound to the wrong existing slot', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected({ slot_id: 'slot_2' }), selectedForSlot2()],
      },
      'MISSING_MATERIAL_DECISION_EVIDENCE',
    );
  });

  it('requires a valid positive revision and non-empty SELECTED shot range', () => {
    const input = baseInput();
    expectFailure(
      { ...input, resolved_material_decisions: [selected({ revision: 0 }), selectedForSlot2()] },
      'RESOLVED_REVISION_INVALID',
    );
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected({ shot_end_ms: 100 }), selectedForSlot2()],
      },
      'SELECTED_SHOT_RANGE_INVALID',
    );
  });

  it('derives available duration from the authoritative shot range', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots[0]!.selected_materials[0]!.available_duration_ms).toBe(1000);
  });

  it('derives required duration from exact narration slot timing', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots.map((slot) => slot.required_duration_ms)).toEqual([1000, 1000, 500]);
  });

  it('derives duration delta without applying a duration policy', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots[0]!.selected_materials[0]!.duration_delta_ms).toBe(0);
    expect(output.slots[1]!.selected_materials[0]!.duration_delta_ms).toBe(500);
  });

  it('classifies sufficient material as MATERIAL_AVAILABLE', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots[0]!.state).toBe('MATERIAL_AVAILABLE');
    expect(output.slots[0]!.selected_materials[0]!.duration_state).toBe('MATERIAL_AVAILABLE');
  });

  it('classifies short material as MATERIAL_INSUFFICIENT_DURATION without failing', () => {
    const input = baseInput();
    const output = normalizeTimelinePlanningFactsV1({
      ...input,
      resolved_material_decisions: [selected({ shot_end_ms: 900 }), selectedForSlot2()],
    });
    expect(output.slots[0]!.state).toBe('MATERIAL_INSUFFICIENT_DURATION');
    expect(output.slots[0]!.selected_materials[0]).toMatchObject({
      available_duration_ms: 800,
      duration_delta_ms: -200,
      duration_state: 'MATERIAL_INSUFFICIENT_DURATION',
    });
  });

  it('maps committed Code D NO_MATCH without an E1 selected-material reference to fallback', () => {
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan), [
      selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    ]);
    const output = normalizeTimelinePlanningFactsV1({
      request,
      resolved_material_decisions: [selected(), noMatch()],
    });
    expect(output.slots[1]).toMatchObject({
      state: 'FALLBACK_REQUIRED',
      fallback: {
        source: 'CODE_D_SELECTION_NO_MATCH',
        selection_request_id: 'selection_no_match',
        slot_id: 'slot_2',
      },
    });
  });

  it('keeps Shot Plan route NO_MATCH distinct from Code D NO_MATCH', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots[2]).toMatchObject({
      route: 'NO_MATCH',
      state: 'FALLBACK_REQUIRED',
      fallback: { source: 'SHOT_PLAN_ROUTE_NO_MATCH' },
    });
    expect(output.slots[2]!.fallback).not.toHaveProperty('selection_request_id');
  });

  it('fails closed when an ANIMAL or PRODUCT slot has no committed outcome', () => {
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan), [
      selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    ]);
    expectFailure(
      { request, resolved_material_decisions: [selected()] },
      'MISSING_MATERIAL_DECISION_EVIDENCE',
    );
  });

  it('fails closed on conflicting SELECTED and NO_MATCH final outcomes for one slot', () => {
    const input = baseInput();
    expectFailure(
      { ...input, resolved_material_decisions: [...input.resolved_material_decisions, noMatch()] },
      'CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT',
    );
  });

  it('preserves upstream visual continuity group identities exactly', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.slots.map((slot) => slot.visual_continuity_group_id)).toEqual([
      'visual_group_shared',
      'visual_group_shared',
      'visual_group_fallback',
    ]);
  });

  it('preserves only declared pause intervals and derives their duration', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output.pauses).toEqual([
      { pause_id: 'pause_1', start_ms: 1000, end_ms: 1200, duration_ms: 200 },
      { pause_id: 'pause_2', start_ms: 2200, end_ms: 2300, duration_ms: 100 },
    ]);
  });

  it('does not synthesize a pause from an undeclared narration gap', () => {
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan, undefined, []));
    const output = normalizeTimelinePlanningFactsV1({
      request,
      resolved_material_decisions: [selected(), selectedForSlot2()],
    });
    expect(output.pauses).toEqual([]);
  });

  it('preserves deterministic E1 reference order for multiple SELECTED decisions on one slot', () => {
    const secondRef = selectionRef('selection_1b', receiptHashC, 'asset_1b', 'shot_1b');
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan), [
      secondRef,
      selectionRef('selection_2', receiptHashB, 'asset_2', 'shot_2'),
      selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    ]);
    const output = normalizeTimelinePlanningFactsV1({
      request,
      resolved_material_decisions: [
        selected(),
        selectedForSlot2(),
        selected({
          selection_request_id: 'selection_1b',
          decision_receipt_hash: receiptHashC,
          asset_id: 'asset_1b',
          shot_id: 'shot_1b',
          shot_start_ms: 200,
          shot_end_ms: 800,
        }),
      ],
    });
    expect(
      output.slots[0]!.selected_materials.map((material) => material.selection_request_id),
    ).toEqual(['selection_1b', 'selection_1']);
  });

  it('fails closed on a duplicate resolved selection_request_id', () => {
    const input = baseInput();
    expectFailure(
      { ...input, resolved_material_decisions: [selected(), selected(), selectedForSlot2()] },
      'DUPLICATE_RESOLVED_SELECTION_REQUEST_ID',
    );
  });

  it('fails closed on conflicting batch identity', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected(), selectedForSlot2({ batch_id: 'batch_2' })],
      },
      'CONFLICTING_MATERIAL_DECISION_CONTEXT',
    );
  });

  it('fails closed on conflicting video identity', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [selected(), selectedForSlot2({ video_id: 'video_2' })],
      },
      'CONFLICTING_MATERIAL_DECISION_CONTEXT',
    );
  });

  it('fails closed when an E1 selected-material reference resolves to NO_MATCH', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [
          noMatch({
            selection_request_id: 'selection_1',
            slot_id: 'slot_1',
            decision_receipt_hash: receiptHashA,
          }),
          selectedForSlot2(),
        ],
      },
      'SELECTION_REFERENCE_REQUIRES_SELECTED_DECISION',
    );
  });

  it('fails closed on unreferenced authoritative SELECTED evidence', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [
          ...input.resolved_material_decisions,
          selected({
            selection_request_id: 'selection_extra',
            decision_receipt_hash: receiptHashC,
          }),
        ],
      },
      'UNREFERENCED_SELECTED_DECISION',
    );
  });

  it('fails closed on authoritative decision evidence for an upstream NO_MATCH slot', () => {
    const input = baseInput();
    expectFailure(
      {
        ...input,
        resolved_material_decisions: [
          ...input.resolved_material_decisions,
          noMatch({ slot_id: 'slot_3' }),
        ],
      },
      'UNEXPECTED_DECISION_FOR_UPSTREAM_NO_MATCH_SLOT',
    );
  });

  it('fails closed when multiple NO_MATCH outcomes target the same logical slot', () => {
    const plan = makePlan();
    const request = makeRequest(plan, makeTiming(plan), [
      selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    ]);
    expectFailure(
      {
        request,
        resolved_material_decisions: [
          selected(),
          noMatch(),
          noMatch({
            selection_request_id: 'selection_no_match_2',
            decision_receipt_hash: '7'.repeat(64),
          }),
        ],
      },
      'CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT',
    );
  });

  it('keeps policy identity immutable without interpreting duration parameters', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(output).toMatchObject({
      timeline_policy_id: 'timeline-policy-v1',
      timeline_policy_version: '1.0.0',
      timeline_policy_snapshot_hash: policyHash,
    });
  });

  it('computes a self-excluding deterministic planning facts hash', () => {
    const output = normalizeTimelinePlanningFactsV1(baseInput());
    expect(computeTimelinePlanningFactsHash(output)).toBe(output.planning_facts_hash);
    expect(
      computeTimelinePlanningFactsHash({ ...output, planning_facts_hash: 'f'.repeat(64) }),
    ).toBe(output.planning_facts_hash);
    expect(
      computeTimelinePlanningFactsHash({
        ...output,
        total_duration_ms: output.total_duration_ms + 1,
      }),
    ).not.toBe(output.planning_facts_hash);
  });

  it('does not invoke Code C retrieval or the Code D selector', () => {
    const plannerSource = readFileSync(
      resolve(import.meta.dirname, '../../packages/timeline/src/planner.ts'),
      'utf8',
    );
    expect(plannerSource).not.toMatch(
      /adaptCodeCCandidates|selectMaterial|MaterialSelectionService/u,
    );
    expect(plannerSource).not.toContain('@app/domain-auto-edit');
  });

  it('does not emit physical segments, trim, extension, stitch or pause coverage decisions', () => {
    const outputBytes = canonicalJson(normalizeTimelinePlanningFactsV1(baseInput()));
    for (const forbidden of [
      'physical_segments',
      'source_media_start_ms',
      'source_media_end_ms',
      'fit_strategy',
      'ACTIVE_EXTENSION',
      'ACTIVE_STITCH',
      'PASSIVE_EXTENSION',
      'PAUSE_COVERAGE',
    ]) {
      expect(outputBytes).not.toContain(forbidden);
    }
  });
});
