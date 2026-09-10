import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/domain-media-index/src/signature.js';
import {
  computeTimelineDurationPlanHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningFactsHash,
  parseTimelineDurationPolicyV1,
  planTimelineDurationV1,
  validateTimelineDurationPlanV1,
  type TimelineDurationPlanV1,
  type TimelineDurationPolicyV1,
  type TimelineMaterialSlotPlanningFactV1,
  type TimelinePlanningFactsV1,
  type TimelineSelectedMaterialPlanningFactV1,
  type TimelineSlotPlanningFactV1,
} from '../../packages/timeline/src/index.js';

const receiptA = 'a'.repeat(64);
const receiptB = 'b'.repeat(64);
const receiptC = 'c'.repeat(64);

function makePolicy(
  targetMinMs = 0,
  maxMs = 0,
  policyId = 'timeline-policy-v1',
  policyVersion = '1.0.0',
): TimelineDurationPolicyV1 {
  const preimage: Omit<TimelineDurationPolicyV1, 'policy_snapshot_hash'> = {
    schema_version: '1.0',
    policy_id: policyId,
    policy_version: policyVersion,
    active_extension_mode: 'SAME_VISUAL_CONTINUITY',
    active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
    passive_extension_target_min_ms: targetMinMs,
    passive_extension_max_ms: maxMs,
    pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
  };
  return {
    ...preimage,
    policy_snapshot_hash: computeTimelineDurationPolicyHash(preimage),
  };
}

function material(
  slotId: string,
  requiredDurationMs: number,
  selectionRequestId: string,
  shotStartMs: number,
  shotEndMs: number,
  overrides: Partial<TimelineSelectedMaterialPlanningFactV1> = {},
): TimelineSelectedMaterialPlanningFactV1 {
  const availableDurationMs = shotEndMs - shotStartMs;
  const durationDeltaMs = availableDurationMs - requiredDurationMs;
  return {
    selection_request_id: selectionRequestId,
    decision_receipt_hash:
      selectionRequestId === 'sel_a'
        ? receiptA
        : selectionRequestId === 'sel_b'
          ? receiptB
          : receiptC,
    batch_id: 'batch_1',
    video_id: 'video_1',
    slot_id: slotId,
    asset_id: 'asset_' + selectionRequestId,
    shot_id: 'shot_' + selectionRequestId,
    revision: 1,
    shot_start_ms: shotStartMs,
    shot_end_ms: shotEndMs,
    available_duration_ms: availableDurationMs,
    duration_delta_ms: durationDeltaMs,
    duration_state: durationDeltaMs >= 0 ? 'MATERIAL_AVAILABLE' : 'MATERIAL_INSUFFICIENT_DURATION',
    ...overrides,
  };
}

function realSlot(
  slotId: string,
  orderIndex: number,
  timelineStartMs: number,
  timelineEndMs: number,
  route: 'ANIMAL' | 'PRODUCT',
  groupId: string,
  materials: TimelineSelectedMaterialPlanningFactV1[],
  sourceStart = orderIndex * 10,
  sourceEnd = orderIndex * 10 + 5,
): TimelineMaterialSlotPlanningFactV1 {
  const requiredDurationMs = timelineEndMs - timelineStartMs;
  return {
    slot_id: slotId,
    order_index: orderIndex,
    source_start: sourceStart,
    source_end: sourceEnd,
    route,
    visual_continuity_group_id: groupId,
    timeline_start_ms: timelineStartMs,
    timeline_end_ms: timelineEndMs,
    required_duration_ms: requiredDurationMs,
    state: materials.some((entry) => entry.available_duration_ms >= requiredDurationMs)
      ? 'MATERIAL_AVAILABLE'
      : 'MATERIAL_INSUFFICIENT_DURATION',
    selected_materials: materials as [
      TimelineSelectedMaterialPlanningFactV1,
      ...TimelineSelectedMaterialPlanningFactV1[],
    ],
    fallback: null,
  };
}

function upstreamFallbackSlot(
  slotId: string,
  orderIndex: number,
  timelineStartMs: number,
  timelineEndMs: number,
): TimelineSlotPlanningFactV1 {
  return {
    slot_id: slotId,
    order_index: orderIndex,
    source_start: orderIndex * 10,
    source_end: orderIndex * 10 + 5,
    route: 'NO_MATCH',
    visual_continuity_group_id: 'fallback_group',
    timeline_start_ms: timelineStartMs,
    timeline_end_ms: timelineEndMs,
    required_duration_ms: timelineEndMs - timelineStartMs,
    state: 'FALLBACK_REQUIRED',
    selected_materials: [],
    fallback: { source: 'SHOT_PLAN_ROUTE_NO_MATCH' },
  };
}

function codeDNoMatchSlot(
  slotId: string,
  orderIndex: number,
  timelineStartMs: number,
  timelineEndMs: number,
): TimelineSlotPlanningFactV1 {
  return {
    slot_id: slotId,
    order_index: orderIndex,
    source_start: orderIndex * 10,
    source_end: orderIndex * 10 + 5,
    route: 'ANIMAL',
    visual_continuity_group_id: 'animal_group',
    timeline_start_ms: timelineStartMs,
    timeline_end_ms: timelineEndMs,
    required_duration_ms: timelineEndMs - timelineStartMs,
    state: 'FALLBACK_REQUIRED',
    selected_materials: [],
    fallback: {
      source: 'CODE_D_SELECTION_NO_MATCH',
      selection_request_id: 'no_match_1',
      decision_receipt_hash: receiptC,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: slotId,
    },
  };
}

function makeFacts(
  policy: TimelineDurationPolicyV1,
  slots: TimelineSlotPlanningFactV1[],
  pauses: TimelinePlanningFactsV1['pauses'] = [],
  totalDurationMs = Math.max(
    ...slots.map((slot) => slot.timeline_end_ms),
    ...pauses.map((pause) => pause.end_ms),
  ),
): TimelinePlanningFactsV1 {
  const preimage: Omit<TimelinePlanningFactsV1, 'planning_facts_hash'> = {
    schema_version: '1.0',
    planning_request_id: 'planning_request_1',
    timeline_request_hash: '1'.repeat(64),
    shot_plan_id: 'shot_plan_1',
    shot_plan_hash: '2'.repeat(64),
    timing_snapshot_id: 'timing_1',
    timing_snapshot_hash: '3'.repeat(64),
    source_document_id: 'document_1',
    source_document_hash: '4'.repeat(64),
    narration_audio_id: 'audio_1',
    narration_audio_hash: '5'.repeat(64),
    total_duration_ms: totalDurationMs,
    timeline_policy_id: policy.policy_id,
    timeline_policy_version: policy.policy_version,
    timeline_policy_snapshot_hash: policy.policy_snapshot_hash,
    material_context: { batch_id: 'batch_1', video_id: 'video_1' },
    slots,
    pauses,
  };
  return {
    ...preimage,
    planning_facts_hash: computeTimelinePlanningFactsHash(preimage),
  };
}

function baseScenario(policy = makePolicy()): {
  policy: TimelineDurationPolicyV1;
  facts: TimelinePlanningFactsV1;
} {
  const slot1Duration = 1000;
  const slot2Duration = 1000;
  const slot1 = realSlot(
    'slot_1',
    0,
    0,
    1000,
    'ANIMAL',
    'shared_group',
    [material('slot_1', slot1Duration, 'sel_a', 100, 4000)],
    0,
    5,
  );
  const slot2 = realSlot(
    'slot_2',
    1,
    1200,
    2200,
    'ANIMAL',
    'shared_group',
    [material('slot_2', slot2Duration, 'sel_b', 50, 1550)],
    100,
    105,
  );
  return {
    policy,
    facts: makeFacts(
      policy,
      [slot1, slot2],
      [{ pause_id: 'pause_1', start_ms: 1000, end_ms: 1200, duration_ms: 200 }],
      2400,
    ),
  };
}

function plan(
  policy: TimelineDurationPolicyV1,
  facts: TimelinePlanningFactsV1,
): TimelineDurationPlanV1 {
  return planTimelineDurationV1({ duration_policy: policy, planning_facts: facts });
}

function oneSlotScenario(
  policy: TimelineDurationPolicyV1,
  timelineEndMs: number,
  materials: TimelineSelectedMaterialPlanningFactV1[],
  totalDurationMs = timelineEndMs,
): TimelinePlanningFactsV1 {
  return makeFacts(
    policy,
    [realSlot('slot_1', 0, 0, timelineEndMs, 'ANIMAL', 'group_1', materials)],
    [],
    totalDurationMs,
  );
}

function recomputePlanHash(value: TimelineDurationPlanV1): TimelineDurationPlanV1 {
  return { ...value, duration_plan_hash: computeTimelineDurationPlanHash(value) };
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('Code E E3 duration policy', () => {
  it('keeps the frozen E1 and E2 semantic bytes unchanged', () => {
    const root = resolve(import.meta.dirname, '../..');
    const expected = new Map([
      [
        'packages/contracts/src/timeline-planning.ts',
        'd3524eee97072864bdda3e787dd2e36ffe2aed239e2d45e4fc276db5d241f938',
      ],
      [
        'schemas/timeline/v1/committed-material-selection-ref.schema.json',
        'f0db8478176534d93a9283cd0be0b8cbccdf711c8cfe4e83cd15426f1e28d8df',
      ],
      [
        'schemas/timeline/v1/confirmed-shot-plan.schema.json',
        'cc38118535eccb15d4c9c267cee538906f8344ef6977b4c47a75dcfea5d396ee',
      ],
      [
        'schemas/timeline/v1/narration-timing-snapshot.schema.json',
        '963ed402b3251e54a1e080adbeb0241868f3696664ba0209a8d76f69e8d29815',
      ],
      [
        'schemas/timeline/v1/timeline-planning-request.schema.json',
        'd1d6a95a0a022b191d5e2c236cdb41f417989955a8144ac02ab812d09a87a226',
      ],
      [
        'packages/timeline/src/hash.ts',
        '248f19595fafcc85bf0e291e6a823fc082cbf9861d569799785aed49c3e16416',
      ],
      [
        'packages/timeline/src/planner.ts',
        '7520cb2d8e4ece78dcd4d91aba0860a2f3eaf2efee33c1a16f051250192855da',
      ],
    ]);
    for (const [path, digest] of expected) {
      expect(fileSha256(resolve(root, path))).toBe(digest);
    }
  });

  it('computes canonical policy hashes independent of property insertion order', () => {
    const policy = makePolicy(500, 250);
    const reversed = Object.fromEntries(
      Object.entries(policy).reverse(),
    ) as TimelineDurationPolicyV1;
    expect(computeTimelineDurationPolicyHash(reversed)).toBe(policy.policy_snapshot_hash);
  });

  it('excludes policy_snapshot_hash from its own preimage', () => {
    const policy = makePolicy(500, 250);
    expect(
      computeTimelineDurationPolicyHash({ ...policy, policy_snapshot_hash: 'f'.repeat(64) }),
    ).toBe(policy.policy_snapshot_hash);
  });

  it('changes the policy hash when a business parameter changes', () => {
    expect(makePolicy(500, 200).policy_snapshot_hash).not.toBe(
      makePolicy(500, 201).policy_snapshot_hash,
    );
  });

  it('accepts only non-negative integer policy milliseconds', () => {
    const policy = makePolicy();
    expect(() =>
      parseTimelineDurationPolicyV1({
        ...policy,
        passive_extension_max_ms: -1,
      }),
    ).toThrowError('TIMELINE_DURATION_POLICY_INVALID');
    expect(() =>
      parseTimelineDurationPolicyV1({
        ...policy,
        passive_extension_target_min_ms: 0.5,
      }),
    ).toThrowError('TIMELINE_DURATION_POLICY_INVALID');
  });

  it('fails closed on policy id mismatch', () => {
    const scenario = baseScenario();
    const different = makePolicy(0, 0, 'different-policy');
    expect(() => plan(different, scenario.facts)).toThrowError('TIMELINE_POLICY_BINDING_MISMATCH');
  });

  it('fails closed on policy version mismatch', () => {
    const scenario = baseScenario();
    const different = makePolicy(0, 0, scenario.policy.policy_id, '2.0.0');
    expect(() => plan(different, scenario.facts)).toThrowError('TIMELINE_POLICY_BINDING_MISMATCH');
  });

  it('fails closed on policy hash mismatch', () => {
    const scenario = baseScenario();
    expect(() =>
      plan({ ...scenario.policy, policy_snapshot_hash: '0'.repeat(64) }, scenario.facts),
    ).toThrowError('TIMELINE_POLICY_BINDING_MISMATCH');
  });

  it('fails closed when the exact policy snapshot differs from the bound hash', () => {
    const scenario = baseScenario();
    const different = makePolicy(1, 0);
    expect(() => plan(different, scenario.facts)).toThrowError('TIMELINE_POLICY_BINDING_MISMATCH');
  });

  it('fails closed on a planning facts hash mismatch', () => {
    const scenario = baseScenario();
    expect(() =>
      plan(scenario.policy, { ...scenario.facts, planning_facts_hash: '0'.repeat(64) }),
    ).toThrowError('TIMELINE_PLANNING_FACTS_HASH_MISMATCH');
  });

  it('is byte deterministic across 100 executions', () => {
    const scenario = baseScenario();
    const outputs = Array.from({ length: 100 }, () =>
      canonicalJson(plan(scenario.policy, scenario.facts)),
    );
    expect(new Set(outputs)).toEqual(new Set([outputs[0]]));
  });

  it('produces distinct deterministic plans for distinct fixture policy values', () => {
    const policyA = makePolicy(500, 100);
    const factsA = oneSlotScenario(policyA, 200, [material('slot_1', 200, 'sel_a', 0, 1000)], 1000);
    const policyB = makePolicy(500, 200);
    const factsB = oneSlotScenario(policyB, 200, [material('slot_1', 200, 'sel_a', 0, 1000)], 1000);
    expect(plan(policyA, factsA).duration_plan_hash).not.toBe(
      plan(policyB, factsB).duration_plan_hash,
    );
  });
});

describe('Code E E3 real-material planning', () => {
  it('starts source consumption exactly at shot_start_ms', () => {
    const scenario = baseScenario();
    expect(plan(scenario.policy, scenario.facts).segments[0]!.source_start_ms).toBe(100);
  });

  it('never consumes past shot_end_ms', () => {
    const policy = makePolicy();
    const facts = oneSlotScenario(policy, 1000, [
      material('slot_1', 1000, 'sel_a', 100, 700),
      material('slot_1', 1000, 'sel_b', 50, 450),
    ]);
    const output = plan(policy, facts);
    expect(output.segments.map((segment) => segment.source_end_ms)).toEqual([700, 450]);
  });

  it('uses ACTIVE_EXTENSION for the same real route and continuity group', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(output.slot_transitions[0]).toMatchObject({
      decision: 'ACTIVE_EXTENSION',
      reason: 'SAME_ROUTE_AND_VISUAL_CONTINUITY',
    });
    expect(output.segments[0]!.reason_codes).toContain('ACTIVE_EXTENSION');
  });

  it('does not use source character adjacency as continuity authority', () => {
    const scenario = baseScenario();
    expect(scenario.facts.slots[0]!.source_end).not.toBe(scenario.facts.slots[1]!.source_start);
    expect(plan(scenario.policy, scenario.facts).slot_transitions[0]!.decision).toBe(
      'ACTIVE_EXTENSION',
    );
  });

  it('switches when the visual continuity group changes', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'ANIMAL', 'group_a', [
      material('slot_1', 500, 'sel_a', 0, 1500),
    ]);
    const slot2 = realSlot('slot_2', 1, 500, 1000, 'ANIMAL', 'group_b', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2]));
    expect(output.slot_transitions[0]).toMatchObject({
      decision: 'SWITCH',
      reason: 'VISUAL_CONTINUITY_CHANGE',
    });
    expect(output.segments).toHaveLength(2);
  });

  it('always switches from ANIMAL to PRODUCT even with the same group', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'ANIMAL', 'same_group', [
      material('slot_1', 500, 'sel_a', 0, 1500),
    ]);
    const slot2 = realSlot('slot_2', 1, 500, 1000, 'PRODUCT', 'same_group', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    expect(plan(policy, makeFacts(policy, [slot1, slot2])).slot_transitions[0]).toMatchObject({
      decision: 'SWITCH',
      reason: 'ROUTE_CHANGE',
    });
  });

  it('always switches from PRODUCT to ANIMAL even with the same group', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'PRODUCT', 'same_group', [
      material('slot_1', 500, 'sel_a', 0, 1500),
    ]);
    const slot2 = realSlot('slot_2', 1, 500, 1000, 'ANIMAL', 'same_group', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    expect(plan(policy, makeFacts(policy, [slot1, slot2])).slot_transitions[0]).toMatchObject({
      decision: 'SWITCH',
      reason: 'ROUTE_CHANGE',
    });
  });

  it('does not stitch when the first committed material is sufficient', () => {
    const policy = makePolicy();
    const facts = oneSlotScenario(policy, 500, [
      material('slot_1', 500, 'sel_a', 0, 1000),
      material('slot_1', 500, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, facts);
    expect(output.segments).toHaveLength(1);
    expect(output.segments[0]!.selection_request_id).toBe('sel_a');
    expect(
      output.unused_committed_selection_refs.map((entry) => entry.selection_request_id),
    ).toEqual(['sel_b']);
  });

  it('uses ACTIVE_STITCH only after the current material is exhausted', () => {
    const policy = makePolicy();
    const facts = oneSlotScenario(policy, 1000, [
      material('slot_1', 1000, 'sel_a', 0, 600),
      material('slot_1', 1000, 'sel_b', 50, 550),
    ]);
    const output = plan(policy, facts);
    expect(output.segments.map((segment) => segment.reason_codes)).toEqual([
      ['DIRECT'],
      ['ACTIVE_STITCH'],
    ]);
    expect(output.additional_selection_requirements).toEqual([]);
  });

  it('stitches the next slot committed material when same imagery must continue', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'ANIMAL', 'same_group', [
      material('slot_1', 500, 'sel_a', 0, 500),
    ]);
    const slot2 = realSlot('slot_2', 1, 500, 1000, 'ANIMAL', 'same_group', [
      material('slot_2', 500, 'sel_b', 100, 600),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2]));
    expect(output.slot_transitions[0]).toMatchObject({
      decision: 'ACTIVE_STITCH',
      reason: 'SAME_ROUTE_AND_VISUAL_CONTINUITY',
    });
    expect(output.segments[1]).toMatchObject({
      selection_request_id: 'sel_b',
      source_start_ms: 100,
      source_end_ms: 600,
      reason_codes: ['ACTIVE_STITCH'],
    });
  });

  it('preserves a separate committed D identity for every stitched segment', () => {
    const policy = makePolicy();
    const facts = oneSlotScenario(policy, 1000, [
      material('slot_1', 1000, 'sel_a', 0, 600),
      material('slot_1', 1000, 'sel_b', 50, 550),
    ]);
    const output = plan(policy, facts);
    expect(
      output.segments.map((segment) => [
        segment.selection_request_id,
        segment.decision_receipt_hash,
      ]),
    ).toEqual([
      ['sel_a', receiptA],
      ['sel_b', receiptB],
    ]);
  });

  it('keeps independent source cursors for different decisions selecting the same shot', () => {
    const policy = makePolicy();
    const shared = { asset_id: 'asset_shared', shot_id: 'shot_shared' };
    const facts = oneSlotScenario(policy, 1000, [
      material('slot_1', 1000, 'sel_a', 100, 500, shared),
      material('slot_1', 1000, 'sel_b', 100, 700, shared),
    ]);
    const output = plan(policy, facts);
    expect(output.segments.map((segment) => segment.source_start_ms)).toEqual([100, 100]);
    expect(output.segments.map((segment) => segment.selection_request_id)).toEqual([
      'sel_a',
      'sel_b',
    ]);
  });

  it('advances one continuous cursor for one decision across slot and pause coverage', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(output.segments).toHaveLength(1);
    expect(output.segments[0]).toMatchObject({
      timeline_start_ms: 0,
      timeline_end_ms: 2200,
      source_start_ms: 100,
      source_end_ms: 2300,
      slot_ids: ['slot_1', 'slot_2'],
    });
  });

  it('keeps source duration equal to timeline duration for every segment', () => {
    const scenario = baseScenario();
    for (const segment of plan(scenario.policy, scenario.facts).segments) {
      expect(segment.source_end_ms - segment.source_start_ms).toBe(segment.duration_ms);
      expect(segment.timeline_end_ms - segment.timeline_start_ms).toBe(segment.duration_ms);
    }
  });
});

describe('Code E E3 passive extension', () => {
  it('extends only when the normal visual span is below the policy target', () => {
    const policy = makePolicy(500, 500);
    const shortFacts = oneSlotScenario(
      policy,
      200,
      [material('slot_1', 200, 'sel_a', 0, 1000)],
      1000,
    );
    const exactFacts = oneSlotScenario(
      policy,
      500,
      [material('slot_1', 500, 'sel_a', 0, 1000)],
      1000,
    );
    expect(plan(policy, shortFacts).segments[0]!.reason_codes).toContain('PASSIVE_EXTENSION');
    expect(plan(policy, exactFacts).segments[0]!.reason_codes).not.toContain('PASSIVE_EXTENSION');
  });

  it('caps passive extension by policy maximum', () => {
    const policy = makePolicy(500, 150);
    const facts = oneSlotScenario(policy, 200, [material('slot_1', 200, 'sel_a', 0, 1000)], 1000);
    const output = plan(policy, facts);
    expect(output.execution_domain_intervals.at(-1)).toMatchObject({
      kind: 'PASSIVE_EXTENSION',
      timeline_start_ms: 200,
      timeline_end_ms: 350,
      duration_ms: 150,
    });
  });

  it('caps passive extension by the available downstream window', () => {
    const policy = makePolicy(500, 500);
    const slot1 = realSlot('slot_1', 0, 0, 200, 'ANIMAL', 'group_a', [
      material('slot_1', 200, 'sel_a', 0, 1000),
    ]);
    const slot2 = realSlot('slot_2', 1, 300, 600, 'ANIMAL', 'group_b', [
      material('slot_2', 300, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2], [], 1000));
    const extension = output.execution_domain_intervals.find(
      (interval) => interval.kind === 'PASSIVE_EXTENSION',
    );
    expect(extension).toMatchObject({
      timeline_start_ms: 200,
      timeline_end_ms: 300,
      duration_ms: 100,
    });
  });

  it('never crosses into the next real-material visual slot', () => {
    const policy = makePolicy(1000, 1000);
    const slot1 = realSlot('slot_1', 0, 0, 200, 'ANIMAL', 'group_a', [
      material('slot_1', 200, 'sel_a', 0, 2000),
    ]);
    const slot2 = realSlot('slot_2', 1, 250, 500, 'ANIMAL', 'group_b', [
      material('slot_2', 250, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2], [], 1000));
    const extension = output.execution_domain_intervals.find(
      (interval) => interval.kind === 'PASSIVE_EXTENSION',
    );
    expect(extension!.timeline_end_ms).toBe(250);
    expect(output.segments[0]!.timeline_end_ms).toBe(250);
  });

  it('uses zero passive extension when the same source has no remaining duration', () => {
    const policy = makePolicy(500, 500);
    const facts = oneSlotScenario(policy, 200, [material('slot_1', 200, 'sel_a', 0, 200)], 1000);
    const output = plan(policy, facts);
    expect(
      output.execution_domain_intervals.some((entry) => entry.kind === 'PASSIVE_EXTENSION'),
    ).toBe(false);
  });

  it('never introduces a second material for passive extension', () => {
    const policy = makePolicy(500, 500);
    const facts = oneSlotScenario(
      policy,
      200,
      [material('slot_1', 200, 'sel_a', 0, 250), material('slot_1', 200, 'sel_b', 0, 1000)],
      1000,
    );
    const output = plan(policy, facts);
    expect(output.segments).toHaveLength(1);
    expect(output.segments[0]).toMatchObject({
      selection_request_id: 'sel_a',
      timeline_end_ms: 250,
    });
    expect(output.unused_committed_selection_refs[0]!.selection_request_id).toBe('sel_b');
  });

  it('does not use passive extension to hide source shortage', () => {
    const policy = makePolicy(1000, 1000);
    const facts = oneSlotScenario(policy, 500, [material('slot_1', 500, 'sel_a', 0, 200)], 1200);
    const output = plan(policy, facts);
    expect(output.additional_selection_requirements).toHaveLength(1);
    expect(
      output.execution_domain_intervals.some((entry) => entry.kind === 'PASSIVE_EXTENSION'),
    ).toBe(false);
  });
});

describe('Code E E3 pause, fallback and shortage outcomes', () => {
  it('covers a declared pause between two real sides with the previous material', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(output.segments[0]!.reason_codes).toContain('PAUSE_COVERAGE');
    expect(output.fallback_requirements).toEqual([]);
  });

  it('does not synthesize pause coverage for an undeclared timing gap', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'ANIMAL', 'same_group', [
      material('slot_1', 500, 'sel_a', 0, 2000),
    ]);
    const slot2 = realSlot('slot_2', 1, 700, 1200, 'ANIMAL', 'same_group', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2], [], 1500));
    expect(output.execution_domain_intervals).toHaveLength(2);
    expect(output.segments.some((segment) => segment.reason_codes.includes('PAUSE_COVERAGE'))).toBe(
      false,
    );
    expect(
      output.segments.some(
        (segment) => segment.timeline_start_ms < 700 && segment.timeline_end_ms > 500,
      ),
    ).toBe(false);
  });

  it('consumes only legal source duration for pause coverage', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(output.segments[0]!.source_end_ms).toBeLessThanOrEqual(4000);
    expect(output.segments[0]!.source_end_ms - output.segments[0]!.source_start_ms).toBe(2200);
  });

  it('may stitch the previous slot next committed material to cover a pause shortage', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 1000, 'ANIMAL', 'same_group', [
      material('slot_1', 1000, 'sel_a', 0, 1000),
      material('slot_1', 1000, 'sel_b', 100, 500),
    ]);
    const slot2 = realSlot('slot_2', 1, 1200, 1700, 'ANIMAL', 'same_group', [
      material('slot_2', 500, 'sel_c', 0, 1000),
    ]);
    const facts = makeFacts(
      policy,
      [slot1, slot2],
      [{ pause_id: 'pause_1', start_ms: 1000, end_ms: 1200, duration_ms: 200 }],
      1800,
    );
    const output = plan(policy, facts);
    expect(output.segments[1]).toMatchObject({
      selection_request_id: 'sel_b',
      timeline_start_ms: 1000,
      source_start_ms: 100,
    });
    expect(output.segments[1]!.reason_codes).toEqual([
      'ACTIVE_EXTENSION',
      'PAUSE_COVERAGE',
      'ACTIVE_STITCH',
    ]);
  });

  it('emits an exact additional-selection gap after all committed material is exhausted', () => {
    const policy = makePolicy();
    const facts = oneSlotScenario(policy, 1000, [material('slot_1', 1000, 'sel_a', 0, 600)]);
    expect(plan(policy, facts).additional_selection_requirements[0]).toMatchObject({
      slot_id: 'slot_1',
      timeline_start_ms: 600,
      timeline_end_ms: 1000,
      duration_ms: 400,
      remaining_duration_ms: 400,
    });
  });

  it('emits an exact additional-selection gap for unresolved pause coverage', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 1000, 'ANIMAL', 'same_group', [
      material('slot_1', 1000, 'sel_a', 0, 1100),
    ]);
    const slot2 = realSlot('slot_2', 1, 1200, 1700, 'ANIMAL', 'same_group', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    const output = plan(
      policy,
      makeFacts(
        policy,
        [slot1, slot2],
        [{ pause_id: 'pause_1', start_ms: 1000, end_ms: 1200, duration_ms: 200 }],
      ),
    );
    expect(output.additional_selection_requirements[0]).toMatchObject({
      reason: 'PAUSE_COVERAGE_MATERIAL_EXHAUSTED',
      timeline_start_ms: 1100,
      timeline_end_ms: 1200,
      duration_ms: 100,
      remaining_duration_ms: 100,
    });
  });

  it('preserves upstream route NO_MATCH as an exact fallback requirement', () => {
    const policy = makePolicy();
    const output = plan(policy, makeFacts(policy, [upstreamFallbackSlot('slot_1', 0, 500, 800)]));
    expect(output.fallback_requirements[0]).toMatchObject({
      source: 'SHOT_PLAN_ROUTE_NO_MATCH',
      timeline_start_ms: 500,
      timeline_end_ms: 800,
      duration_ms: 300,
      committed_no_match: null,
    });
  });

  it('preserves Code D NO_MATCH as an exact traceable fallback requirement', () => {
    const policy = makePolicy();
    const output = plan(policy, makeFacts(policy, [codeDNoMatchSlot('slot_1', 0, 500, 800)]));
    expect(output.fallback_requirements[0]).toMatchObject({
      source: 'CODE_D_SELECTION_NO_MATCH',
      timeline_start_ms: 500,
      timeline_end_ms: 800,
      duration_ms: 300,
      committed_no_match: {
        selection_request_id: 'no_match_1',
        decision_receipt_hash: receiptC,
      },
    });
  });

  it('uses an exact fallback outcome for a declared pause without two real sides', () => {
    const policy = makePolicy();
    const left = upstreamFallbackSlot('slot_1', 0, 0, 500);
    const right = realSlot('slot_2', 1, 700, 1000, 'ANIMAL', 'group_1', [
      material('slot_2', 300, 'sel_a', 0, 1000),
    ]);
    const output = plan(
      policy,
      makeFacts(
        policy,
        [left, right],
        [{ pause_id: 'pause_1', start_ms: 500, end_ms: 700, duration_ms: 200 }],
      ),
    );
    expect(
      output.fallback_requirements.find((entry) => entry.pause_id === 'pause_1'),
    ).toMatchObject({
      source: 'DECLARED_PAUSE_WITHOUT_REAL_SIDES',
      timeline_start_ms: 500,
      timeline_end_ms: 700,
      duration_ms: 200,
    });
  });

  it('accounts explicitly for every committed selection not consumed by the plan', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(output.unused_committed_selection_refs).toEqual([
      {
        selection_request_id: 'sel_b',
        decision_receipt_hash: receiptB,
        asset_id: 'asset_sel_b',
        shot_id: 'shot_sel_b',
        slot_id: 'slot_2',
      },
    ]);
  });
});

describe('Code E E3 execution coverage and forbidden behavior', () => {
  it('covers every planned execution interval with exactly one outcome type', () => {
    const scenario = baseScenario();
    expect(() =>
      validateTimelineDurationPlanV1(plan(scenario.policy, scenario.facts)),
    ).not.toThrow();
  });

  it('fails closed on a silent execution hole', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    const invalid = recomputePlanHash({ ...output, segments: [] });
    expect(() => validateTimelineDurationPlanV1(invalid)).toThrowError(
      'EXECUTION_COVERAGE_SILENT_HOLE',
    );
  });

  it('fails closed on overlapping execution outcomes', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    const duplicate = {
      ...output.segments[0]!,
      segment_id: 'segment_duplicate',
    };
    const invalid = recomputePlanHash({
      ...output,
      segments: [...output.segments, duplicate],
    });
    expect(() => validateTimelineDurationPlanV1(invalid)).toThrowError(
      'EXECUTION_COVERAGE_OVERLAP',
    );
  });

  it('fails closed when an outcome extends outside the execution domain', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    const segment = output.segments[0]!;
    const extended = {
      ...segment,
      timeline_end_ms: segment.timeline_end_ms + 1,
      source_end_ms: segment.source_end_ms + 1,
      duration_ms: segment.duration_ms + 1,
    };
    const invalid = recomputePlanHash({ ...output, segments: [extended] });
    expect(() => validateTimelineDurationPlanV1(invalid)).toThrowError(
      'OUTCOME_OUTSIDE_EXECUTION_DOMAIN',
    );
  });

  it('does not create overlapping incompatible real-material segments', () => {
    const policy = makePolicy();
    const slot1 = realSlot('slot_1', 0, 0, 500, 'ANIMAL', 'group_a', [
      material('slot_1', 500, 'sel_a', 0, 1000),
    ]);
    const slot2 = realSlot('slot_2', 1, 500, 1000, 'PRODUCT', 'group_b', [
      material('slot_2', 500, 'sel_b', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot1, slot2]));
    expect(output.segments[0]!.timeline_end_ms).toBeLessThanOrEqual(
      output.segments[1]!.timeline_start_ms,
    );
  });

  it('binds every used physical segment to one exact D decision and receipt', () => {
    const scenario = baseScenario();
    for (const segment of plan(scenario.policy, scenario.facts).segments) {
      expect(segment.selection_request_id).toMatch(/^sel_/u);
      expect(segment.decision_receipt_hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(segment.source_asset_id).toBeTruthy();
      expect(segment.source_shot_id).toBeTruthy();
      expect(segment.source_revision).toBeGreaterThan(0);
    }
  });

  it('uses only integer milliseconds in physical timing and source geometry', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    for (const segment of output.segments) {
      expect(
        [
          segment.timeline_start_ms,
          segment.timeline_end_ms,
          segment.duration_ms,
          segment.source_start_ms,
          segment.source_end_ms,
        ].every(Number.isSafeInteger),
      ).toBe(true);
    }
  });

  it('does not emit loop, freeze-frame, speed-change, FFmpeg or render instructions', () => {
    const scenario = baseScenario();
    const bytes = canonicalJson(plan(scenario.policy, scenario.facts));
    for (const forbidden of [
      'loop',
      'freeze',
      'speed',
      'ffmpeg',
      'filtergraph',
      'render_instruction',
      'render_command',
    ]) {
      expect(bytes.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('does not invoke Code C, Code D, SQLite, Main or renderer dependencies', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../packages/timeline/src/duration-plan.ts'),
      'utf8',
    );
    for (const forbidden of [
      '@app/domain-auto-edit',
      '@app/local-db',
      'selectMaterial',
      'adaptCodeCCandidates',
      'MaterialSelectionRepository',
      'better-sqlite3',
      'electron',
      'child_process',
      'ffmpeg',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('does not turn unmodeled head or tail padding into execution coverage', () => {
    const policy = makePolicy();
    const slot = realSlot('slot_1', 0, 100, 400, 'ANIMAL', 'group_1', [
      material('slot_1', 300, 'sel_a', 0, 1000),
    ]);
    const output = plan(policy, makeFacts(policy, [slot], [], 1000));
    expect(output.execution_domain_intervals).toEqual([
      {
        execution_interval_id: 'execution_000001',
        kind: 'NARRATION_SLOT',
        slot_id: 'slot_1',
        pause_id: null,
        timeline_start_ms: 100,
        timeline_end_ms: 400,
        duration_ms: 300,
      },
    ]);
  });

  it('keeps the duration plan hash self-excluding and deterministic', () => {
    const scenario = baseScenario();
    const output = plan(scenario.policy, scenario.facts);
    expect(computeTimelineDurationPlanHash(output)).toBe(output.duration_plan_hash);
    expect(computeTimelineDurationPlanHash({ ...output, duration_plan_hash: 'f'.repeat(64) })).toBe(
      output.duration_plan_hash,
    );
  });
});
