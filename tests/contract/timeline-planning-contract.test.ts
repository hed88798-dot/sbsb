import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  committedMaterialSelectionRefV1Schema,
  confirmedShotPlanV1Schema,
  materialSelectionResultV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type CommittedMaterialSelectionRefV1,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import { canonicalJson, sha256 } from '../../packages/domain-media-index/src/signature.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelinePlanningRequestHash,
  parseConfirmedShotPlanV1,
  parseNarrationTimingSnapshotV1,
  parseTimelinePlanningRequestV1,
} from '../../packages/timeline/src/index.js';

const root = resolve(import.meta.dirname, '../..');
const schemaDirectory = resolve(root, 'schemas/timeline/v1');
const sourceDocumentHash = '1'.repeat(64);
const narrationAudioHash = '2'.repeat(64);
const policyHash = '3'.repeat(64);
const receiptHashA = '4'.repeat(64);
const receiptHashB = '5'.repeat(64);

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(resolve(schemaDirectory, name), 'utf8')) as object;
}

function makePlan(): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'shot_plan_1',
    shot_plan_version: 1,
    source_document_id: 'script_1',
    source_document_version: 1,
    source_document_hash: sourceDocumentHash,
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: [
      {
        slot_id: 'slot_1',
        order_index: 0,
        source_start: 0,
        source_end: 2,
        source_text: '牛羊',
        route: 'ANIMAL',
        visual_continuity_group_id: 'visual_group_1',
      },
      {
        slot_id: 'slot_2',
        order_index: 1,
        source_start: 2,
        source_end: 4,
        source_text: '产品',
        route: 'PRODUCT',
        visual_continuity_group_id: 'visual_group_2',
      },
    ],
  };
  return confirmedShotPlanV1Schema.parse({
    ...preimage,
    shot_plan_hash: computeConfirmedShotPlanHash(preimage),
  });
}

function makeTiming(plan = makePlan()): NarrationTimingSnapshotV1 {
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
    total_duration_ms: 2500,
    slot_timings: [
      { slot_id: 'slot_1', start_ms: 0, end_ms: 1000 },
      { slot_id: 'slot_2', start_ms: 1200, end_ms: 2200 },
    ],
    pause_intervals: [{ pause_id: 'pause_1', start_ms: 1000, end_ms: 1200 }],
  };
  return narrationTimingSnapshotV1Schema.parse({
    ...preimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(preimage),
  });
}

function selectionRef(
  selectionRequestId: string,
  receiptHash: string,
  assetId: string,
  shotId: string,
): CommittedMaterialSelectionRefV1 {
  return committedMaterialSelectionRefV1Schema.parse({
    selection_request_id: selectionRequestId,
    decision_receipt_hash: receiptHash,
    asset_id: assetId,
    shot_id: shotId,
  });
}

function makeRequest(
  plan = makePlan(),
  timing = makeTiming(plan),
  selections: CommittedMaterialSelectionRefV1[] = [
    selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
    selectionRef('selection_2', receiptHashB, 'asset_2', 'shot_2'),
  ],
): TimelinePlanningRequestV1 {
  const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
    schema_version: '1.0',
    planning_request_id: 'timeline_request_1',
    confirmed_shot_plan: plan,
    narration_timing_snapshot: timing,
    committed_selection_refs: selections,
    timeline_policy_id: 'timeline-policy-v1',
    timeline_policy_version: '1.0.0',
    timeline_policy_snapshot_hash: policyHash,
  };
  return timelinePlanningRequestV1Schema.parse({
    ...preimage,
    timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
  });
}

describe('Code E E1 timeline planning contracts', () => {
  it('ships strict JSON Schema 2020-12 companions for every E1 contract', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemas = [
      'confirmed-shot-plan.schema.json',
      'narration-timing-snapshot.schema.json',
      'committed-material-selection-ref.schema.json',
      'timeline-planning-request.schema.json',
    ].map(loadSchema);
    for (const schema of schemas.slice(0, 3)) ajv.addSchema(schema);
    expect(() => ajv.compile(schemas[3]!)).not.toThrow();
  });

  it('accepts only a CONFIRMED shot plan', () => {
    expect(confirmedShotPlanV1Schema.safeParse(makePlan()).success).toBe(true);
    expect(
      confirmedShotPlanV1Schema.safeParse({ ...makePlan(), review_state: 'DRAFT' }).success,
    ).toBe(false);
  });

  it('fixes source offsets to Unicode code points and [start, end)', () => {
    expect(makePlan().source_offset_unit).toBe('UNICODE_CODE_POINT');
    const invalid = structuredClone(makePlan());
    invalid.slots[0]!.source_end = invalid.slots[0]!.source_start;
    expect(confirmedShotPlanV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('requires unique slot identities', () => {
    const invalid = structuredClone(makePlan());
    invalid.slots[1]!.slot_id = invalid.slots[0]!.slot_id;
    expect(confirmedShotPlanV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('requires unique, strictly increasing deterministic slot order', () => {
    const duplicate = structuredClone(makePlan());
    duplicate.slots[1]!.order_index = 0;
    expect(confirmedShotPlanV1Schema.safeParse(duplicate).success).toBe(false);
    const reversed = structuredClone(makePlan());
    reversed.slots.reverse();
    expect(confirmedShotPlanV1Schema.safeParse(reversed).success).toBe(false);
  });

  it('accepts only EXACT narration timing', () => {
    expect(narrationTimingSnapshotV1Schema.safeParse(makeTiming()).success).toBe(true);
    expect(
      narrationTimingSnapshotV1Schema.safeParse({ ...makeTiming(), timing_kind: 'ESTIMATED' })
        .success,
    ).toBe(false);
  });

  it('requires pause_intervals to be explicit even when empty', () => {
    const timing = makeTiming();
    const missingPauses = Object.fromEntries(
      Object.entries(timing).filter(([field]) => field !== 'pause_intervals'),
    );
    expect(narrationTimingSnapshotV1Schema.safeParse(missingPauses).success).toBe(false);
    expect(
      narrationTimingSnapshotV1Schema.safeParse({ ...timing, pause_intervals: [] }).success,
    ).toBe(true);
  });

  it('requires integer, positive and in-bounds timing geometry', () => {
    const fractional = structuredClone(makeTiming());
    fractional.slot_timings[0]!.start_ms = 0.5;
    expect(narrationTimingSnapshotV1Schema.safeParse(fractional).success).toBe(false);
    const zero = structuredClone(makeTiming());
    zero.slot_timings[0]!.end_ms = zero.slot_timings[0]!.start_ms;
    expect(narrationTimingSnapshotV1Schema.safeParse(zero).success).toBe(false);
    const outside = structuredClone(makeTiming());
    outside.slot_timings[1]!.end_ms = outside.total_duration_ms + 1;
    expect(narrationTimingSnapshotV1Schema.safeParse(outside).success).toBe(false);
  });

  it('requires slot timings to be monotonic and non-overlapping', () => {
    const overlapping = structuredClone(makeTiming());
    overlapping.slot_timings[1]!.start_ms = 900;
    expect(narrationTimingSnapshotV1Schema.safeParse(overlapping).success).toBe(false);
    const unordered = structuredClone(makeTiming());
    unordered.slot_timings.reverse();
    expect(narrationTimingSnapshotV1Schema.safeParse(unordered).success).toBe(false);
  });

  it('requires pause intervals to be valid, monotonic and non-overlapping', () => {
    const overlapping = structuredClone(makeTiming());
    overlapping.pause_intervals = [
      { pause_id: 'pause_1', start_ms: 1000, end_ms: 1200 },
      { pause_id: 'pause_2', start_ms: 1100, end_ms: 1150 },
    ];
    expect(narrationTimingSnapshotV1Schema.safeParse(overlapping).success).toBe(false);
    const outside = structuredClone(makeTiming());
    outside.pause_intervals[0]!.end_ms = outside.total_duration_ms + 1;
    expect(narrationTimingSnapshotV1Schema.safeParse(outside).success).toBe(false);
  });

  it('forbids overlap between declared pauses and narration slots', () => {
    const invalid = structuredClone(makeTiming());
    invalid.pause_intervals[0]!.start_ms = 900;
    expect(narrationTimingSnapshotV1Schema.safeParse(invalid).success).toBe(false);
  });

  it('allows unmodeled head or tail gaps', () => {
    const timing = makeTiming();
    expect(timing.slot_timings.at(-1)!.end_ms).toBeLessThan(timing.total_duration_ms);
    expect(narrationTimingSnapshotV1Schema.safeParse(timing).success).toBe(true);
  });

  it('fails closed for unknown or missing timing slot identities', () => {
    const plan = makePlan();
    const validRequest = makeRequest(plan, makeTiming(plan));
    const unknown = structuredClone(makeTiming(plan));
    unknown.slot_timings[1]!.slot_id = 'unknown_slot';
    expect(
      timelinePlanningRequestV1Schema.safeParse({
        ...validRequest,
        narration_timing_snapshot: unknown,
      }).success,
    ).toBe(false);
    const missing = structuredClone(makeTiming(plan));
    missing.slot_timings.pop();
    expect(
      timelinePlanningRequestV1Schema.safeParse({
        ...validRequest,
        narration_timing_snapshot: missing,
      }).success,
    ).toBe(false);
  });

  it('requires exact shot-plan and source-document cross-binding', () => {
    const plan = makePlan();
    const validRequest = makeRequest(plan, makeTiming(plan));
    const wrongPlan = structuredClone(makeTiming(plan));
    wrongPlan.shot_plan_hash = '9'.repeat(64);
    expect(
      timelinePlanningRequestV1Schema.safeParse({
        ...validRequest,
        narration_timing_snapshot: wrongPlan,
      }).success,
    ).toBe(false);
    const wrongDocument = structuredClone(makeTiming(plan));
    wrongDocument.source_document_hash = '8'.repeat(64);
    expect(
      timelinePlanningRequestV1Schema.safeParse({
        ...validRequest,
        narration_timing_snapshot: wrongDocument,
      }).success,
    ).toBe(false);
  });

  it('requires a complete, strict committed selection reference identity', () => {
    expect(
      committedMaterialSelectionRefV1Schema.safeParse({
        selection_request_id: 'selection_1',
        decision_receipt_hash: receiptHashA,
        asset_id: 'asset_1',
      }).success,
    ).toBe(false);
    expect(
      committedMaterialSelectionRefV1Schema.safeParse({
        ...selectionRef('selection_1', receiptHashA, 'asset_1', 'shot_1'),
        status: 'SELECTED',
      }).success,
    ).toBe(false);
  });

  it('preserves ordered multiple committed decisions for physical stitch segments', () => {
    const selections = [
      selectionRef('selection_a', receiptHashA, 'asset_a', 'shot_a'),
      selectionRef('selection_b', receiptHashB, 'asset_b', 'shot_b'),
      selectionRef('selection_c', '6'.repeat(64), 'asset_c', 'shot_c'),
    ];
    const parsed = timelinePlanningRequestV1Schema.parse(
      makeRequest(makePlan(), makeTiming(), selections),
    );
    expect(parsed.committed_selection_refs.map((entry) => entry.selection_request_id)).toEqual([
      'selection_a',
      'selection_b',
      'selection_c',
    ]);
  });

  it('carries ANIMAL and PRODUCT slots with committed references in one envelope', () => {
    const request = makeRequest();
    expect(request.confirmed_shot_plan.slots.map((slot) => slot.route)).toEqual([
      'ANIMAL',
      'PRODUCT',
    ]);
    expect(request.committed_selection_refs).toHaveLength(2);
  });

  it('uses the confirmed slot_id unchanged across plan, timing and Code D identity', () => {
    const request = makeRequest();
    const codeDSlotId = materialSelectionResultV1Schema.parse({
      schema_version: '1.0',
      selection_request_id: 'selection_1',
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_1',
      status: 'SELECTED',
      selected_asset_id: 'asset_1',
      selected_shot_id: 'shot_1',
      selected_semantic_rank: 1,
      selected_semantic_score: 0.9,
      degradation_level: 0,
      reason_codes: ['SEMANTIC_RANK_PREFERRED'],
      candidate_set_hash: '7'.repeat(64),
      history_snapshot_hash: '8'.repeat(64),
      policy_snapshot_hash: policyHash,
      decision_receipt_hash: receiptHashA,
      committed_at: '2026-09-10T00:00:00.000Z',
    }).slot_id;
    expect(request.confirmed_shot_plan.slots[0]!.slot_id).toBe(codeDSlotId);
    expect(request.narration_timing_snapshot.slot_timings[0]!.slot_id).toBe(codeDSlotId);
  });

  it('rejects reuse of one committed decision as two physical references', () => {
    const selection = selectionRef('selection_a', receiptHashA, 'asset_a', 'shot_a');
    const validRequest = makeRequest();
    expect(
      timelinePlanningRequestV1Schema.safeParse({
        ...validRequest,
        committed_selection_refs: [selection, selection],
      }).success,
    ).toBe(false);
  });

  it('keeps SHOT_PLAN_ROUTE_NO_MATCH distinct from CODE_D_SELECTION_NO_MATCH', () => {
    const plan = structuredClone(makePlan());
    plan.slots[0]!.route = 'NO_MATCH';
    expect(confirmedShotPlanV1Schema.parse(plan).slots[0]!.route).toBe('NO_MATCH');
    const codeDNoMatch = materialSelectionResultV1Schema.parse({
      schema_version: '1.0',
      selection_request_id: 'selection_no_match',
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_2',
      status: 'NO_MATCH',
      selected_asset_id: null,
      selected_shot_id: null,
      selected_semantic_rank: null,
      selected_semantic_score: null,
      degradation_level: 0,
      reason_codes: ['NO_UPSTREAM_CANDIDATES'],
      candidate_set_hash: '7'.repeat(64),
      history_snapshot_hash: '8'.repeat(64),
      policy_snapshot_hash: policyHash,
      decision_receipt_hash: receiptHashA,
      committed_at: '2026-09-10T00:00:00.000Z',
    });
    expect(codeDNoMatch.status).toBe('NO_MATCH');
    expect({ route: plan.slots[0]!.route }).not.toEqual({ status: codeDNoMatch.status });
  });

  it('hashes equal semantic objects identically regardless of property insertion order', () => {
    const plan = makePlan();
    const reordered = Object.fromEntries(
      Object.entries(plan).reverse(),
    ) as unknown as ConfirmedShotPlanV1;
    reordered.slots = reordered.slots.map(
      (slot) => Object.fromEntries(Object.entries(slot).reverse()) as typeof slot,
    );
    expect(computeConfirmedShotPlanHash(reordered)).toBe(plan.shot_plan_hash);

    const timing = makeTiming(plan);
    const reorderedTiming = Object.fromEntries(
      Object.entries(timing).reverse(),
    ) as unknown as NarrationTimingSnapshotV1;
    expect(computeNarrationTimingSnapshotHash(reorderedTiming)).toBe(timing.timing_snapshot_hash);
  });

  it('excludes each self-hash field from its own preimage', () => {
    const plan = makePlan();
    expect(computeConfirmedShotPlanHash({ ...plan, shot_plan_hash: 'f'.repeat(64) })).toBe(
      plan.shot_plan_hash,
    );
    const timing = makeTiming(plan);
    expect(
      computeNarrationTimingSnapshotHash({ ...timing, timing_snapshot_hash: 'f'.repeat(64) }),
    ).toBe(timing.timing_snapshot_hash);
    const request = makeRequest(plan, timing);
    expect(
      computeTimelinePlanningRequestHash({ ...request, timeline_request_hash: 'f'.repeat(64) }),
    ).toBe(request.timeline_request_hash);
  });

  it('changes hashes when a bound business field changes', () => {
    const plan = makePlan();
    expect(computeConfirmedShotPlanHash({ ...plan, source_document_version: 2 })).not.toBe(
      plan.shot_plan_hash,
    );
    const timing = makeTiming(plan);
    expect(computeNarrationTimingSnapshotHash({ ...timing, total_duration_ms: 2501 })).not.toBe(
      timing.timing_snapshot_hash,
    );
    const request = makeRequest(plan, timing);
    expect(
      computeTimelinePlanningRequestHash({ ...request, timeline_policy_version: '1.0.1' }),
    ).not.toBe(request.timeline_request_hash);
  });

  it('pins a platform-independent canonical UTF-8 JSON representation', () => {
    const value = { b: 2, a: 1 };
    expect(canonicalJson(value)).toBe('{"a":1,"b":2}');
    expect(sha256(canonicalJson(value))).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });

  it('fails closed when any self-hash does not match committed content', () => {
    const plan = makePlan();
    expect(() => parseConfirmedShotPlanV1({ ...plan, shot_plan_hash: '0'.repeat(64) })).toThrow(
      'CONFIRMED_SHOT_PLAN_HASH_MISMATCH',
    );
    const timing = makeTiming(plan);
    expect(() =>
      parseNarrationTimingSnapshotV1({ ...timing, timing_snapshot_hash: '0'.repeat(64) }),
    ).toThrow('NARRATION_TIMING_SNAPSHOT_HASH_MISMATCH');
    const request = makeRequest(plan, timing);
    expect(() =>
      parseTimelinePlanningRequestV1({ ...request, timeline_request_hash: '0'.repeat(64) }),
    ).toThrow('TIMELINE_PLANNING_REQUEST_HASH_MISMATCH');
  });

  it('accepts the fully cross-bound, hash-verified planning envelope', () => {
    expect(parseTimelinePlanningRequestV1(makeRequest())).toEqual(makeRequest());
  });
});
