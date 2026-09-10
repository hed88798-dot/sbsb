import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/domain-media-index/src/signature.js';
import {
  computeTimelineDurationPlanHash,
  computeTimelineDurationPolicyHash,
  planTimelineDurationV1,
  validateTimelineDurationPlanV1,
  type TimelineDurationPlanV1,
  type TimelineDurationPolicyV1,
} from '../../packages/timeline/src/duration-plan.js';
import {
  computeTimelinePlanningFactsHash,
  type TimelinePlanningFactsV1,
} from '../../packages/timeline/src/planner.js';
import {
  resolveTimelineSupplementalNoMatchV1,
  type TimelineSupplementalNoMatchResolutionV1,
} from '../../packages/timeline/src/supplemental-no-match.js';

const oldReceiptHash = 'a'.repeat(64);
const supplementalReceiptHash = 'b'.repeat(64);
const factsHashParent = 'c'.repeat(64);
const factsHashChild = 'd'.repeat(64);

function durationPlan(
  planningRequestId: string,
  planningFactsHash: string,
  overrides: Partial<TimelineDurationPlanV1> = {},
): TimelineDurationPlanV1 {
  const preimage: Omit<TimelineDurationPlanV1, 'duration_plan_hash'> = {
    schema_version: '1.0',
    planning_request_id: planningRequestId,
    planning_facts_hash: planningFactsHash,
    policy_id: 'timeline-policy-v1',
    policy_version: '1.0.0',
    policy_snapshot_hash: 'e'.repeat(64),
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
    segments: [
      {
        segment_id: 'segment_000001',
        kind: 'REAL_MATERIAL',
        slot_ids: ['slot_1'],
        visual_continuity_group_id: 'group_1',
        timeline_start_ms: 0,
        timeline_end_ms: 400,
        duration_ms: 400,
        source_asset_id: 'asset_1',
        source_shot_id: 'shot_1',
        source_revision: 1,
        source_start_ms: 100,
        source_end_ms: 500,
        selection_request_id: 'selection_initial',
        decision_receipt_hash: oldReceiptHash,
        selection_slot_id: 'slot_1',
        reason_codes: ['DIRECT'],
      },
    ],
    fallback_requirements: [],
    additional_selection_requirements: [
      {
        requirement_id: 'additional_000001',
        kind: 'ADDITIONAL_SELECTION_REQUIRED',
        reason: 'MATERIAL_EXHAUSTED',
        slot_id: 'slot_1',
        route: 'ANIMAL',
        visual_continuity_group_id: 'group_1',
        timeline_start_ms: 400,
        timeline_end_ms: 1000,
        duration_ms: 600,
        remaining_duration_ms: 600,
      },
    ],
    unused_committed_selection_refs: [],
    execution_domain_intervals: [
      {
        execution_interval_id: 'execution_000001',
        kind: 'NARRATION_SLOT',
        slot_id: 'slot_1',
        pause_id: null,
        timeline_start_ms: 0,
        timeline_end_ms: 1000,
        duration_ms: 1000,
      },
    ],
    slot_transitions: [],
    ...overrides,
  };
  return {
    ...preimage,
    duration_plan_hash: computeTimelineDurationPlanHash(preimage),
  };
}

function resolution(
  parent: TimelineDurationPlanV1,
  overrides: Partial<TimelineSupplementalNoMatchResolutionV1> = {},
): TimelineSupplementalNoMatchResolutionV1 {
  return {
    parent_duration_plan_hash: parent.duration_plan_hash,
    parent_requirement_id: 'additional_000001',
    selection_request_id: 'selection_supplemental_no_match',
    decision_receipt_hash: supplementalReceiptHash,
    batch_id: 'batch_1',
    video_id: 'video_1',
    slot_id: 'slot_1',
    status: 'NO_MATCH',
    ...overrides,
  };
}

function baseInput() {
  const parent = durationPlan('planning_parent', factsHashParent);
  const child = durationPlan('planning_child', factsHashChild);
  return {
    parent,
    child,
    input: {
      parent_duration_plan: parent,
      child_duration_plan: child,
      supplemental_no_match_resolutions: [resolution(parent)],
    },
  };
}

function withPlanHash(plan: TimelineDurationPlanV1): TimelineDurationPlanV1 {
  return { ...plan, duration_plan_hash: computeTimelineDurationPlanHash(plan) };
}

function expectFailure(value: unknown, code: string): void {
  expect(() => resolveTimelineSupplementalNoMatchV1(value)).toThrowError(code);
}

function policy(): TimelineDurationPolicyV1 {
  const preimage: Omit<TimelineDurationPolicyV1, 'policy_snapshot_hash'> = {
    schema_version: '1.0',
    policy_id: 'timeline-policy-v1',
    policy_version: '1.0.0',
    active_extension_mode: 'SAME_VISUAL_CONTINUITY',
    active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
    passive_extension_target_min_ms: 0,
    passive_extension_max_ms: 0,
    pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
  };
  return { ...preimage, policy_snapshot_hash: computeTimelineDurationPolicyHash(preimage) };
}

function ordinaryFacts(
  planningRequestId: string,
  durationPolicy: TimelineDurationPolicyV1,
): TimelinePlanningFactsV1 {
  const requiredDurationMs = 1000;
  const availableDurationMs = 400;
  const preimage: Omit<TimelinePlanningFactsV1, 'planning_facts_hash'> = {
    schema_version: '1.0',
    planning_request_id: planningRequestId,
    timeline_request_hash:
      planningRequestId === 'planning_parent' ? '1'.repeat(64) : '2'.repeat(64),
    shot_plan_id: 'shot_plan_1',
    shot_plan_hash: '3'.repeat(64),
    timing_snapshot_id: 'timing_1',
    timing_snapshot_hash: '4'.repeat(64),
    source_document_id: 'document_1',
    source_document_hash: '5'.repeat(64),
    narration_audio_id: 'audio_1',
    narration_audio_hash: '6'.repeat(64),
    total_duration_ms: 1000,
    timeline_policy_id: durationPolicy.policy_id,
    timeline_policy_version: durationPolicy.policy_version,
    timeline_policy_snapshot_hash: durationPolicy.policy_snapshot_hash,
    material_context: { batch_id: 'batch_1', video_id: 'video_1' },
    slots: [
      {
        slot_id: 'slot_1',
        order_index: 0,
        source_start: 0,
        source_end: 2,
        route: 'ANIMAL',
        visual_continuity_group_id: 'group_1',
        timeline_start_ms: 0,
        timeline_end_ms: 1000,
        required_duration_ms: requiredDurationMs,
        state: 'MATERIAL_INSUFFICIENT_DURATION',
        selected_materials: [
          {
            selection_request_id: 'selection_initial',
            decision_receipt_hash: oldReceiptHash,
            batch_id: 'batch_1',
            video_id: 'video_1',
            slot_id: 'slot_1',
            asset_id: 'asset_1',
            shot_id: 'shot_1',
            revision: 1,
            shot_start_ms: 100,
            shot_end_ms: 500,
            available_duration_ms: availableDurationMs,
            duration_delta_ms: availableDurationMs - requiredDurationMs,
            duration_state: 'MATERIAL_INSUFFICIENT_DURATION',
          },
        ],
        fallback: null,
      },
    ],
    pauses: [],
  };
  return { ...preimage, planning_facts_hash: computeTimelinePlanningFactsHash(preimage) };
}

describe('Code E E3.1 supplemental NO_MATCH requirement resolution', () => {
  it('keeps requirement identity stable across an ordinary child replan', () => {
    const durationPolicy = policy();
    const parent = planTimelineDurationV1({
      planning_facts: ordinaryFacts('planning_parent', durationPolicy),
      duration_policy: durationPolicy,
    });
    const child = planTimelineDurationV1({
      planning_facts: ordinaryFacts('planning_child', durationPolicy),
      duration_policy: durationPolicy,
    });
    expect(parent.additional_selection_requirements[0]!.requirement_id).toBe('additional_000001');
    expect(child.additional_selection_requirements[0]!.requirement_id).toBe(
      parent.additional_selection_requirements[0]!.requirement_id,
    );
  });

  it('converts only the exact child shortage to a traceable fallback', () => {
    const { input } = baseInput();
    const output = resolveTimelineSupplementalNoMatchV1(input);
    expect(output.additional_selection_requirements).toEqual([]);
    expect(output.fallback_requirements).toEqual([
      {
        requirement_id: 'additional_000001',
        kind: 'FALLBACK_REQUIRED',
        source: 'CODE_D_SELECTION_NO_MATCH',
        slot_id: 'slot_1',
        pause_id: null,
        route: 'ANIMAL',
        visual_continuity_group_id: 'group_1',
        timeline_start_ms: 400,
        timeline_end_ms: 1000,
        duration_ms: 600,
        committed_no_match: {
          selection_request_id: 'selection_supplemental_no_match',
          decision_receipt_hash: supplementalReceiptHash,
          batch_id: 'batch_1',
          video_id: 'video_1',
        },
      },
    ]);
  });

  it('preserves the already consumed real-material segment and parent bytes', () => {
    const { parent, child, input } = baseInput();
    const parentBytes = canonicalJson(parent);
    const output = resolveTimelineSupplementalNoMatchV1(input);
    expect(output.segments).toEqual(child.segments);
    expect(output.segments[0]!.timeline_end_ms).toBe(400);
    expect(output.fallback_requirements[0]!.timeline_start_ms).toBe(400);
    expect(canonicalJson(parent)).toBe(parentBytes);
  });

  it('returns a child accepted directly by the existing E3 validator with exactly-one coverage', () => {
    const output = resolveTimelineSupplementalNoMatchV1(baseInput().input);
    expect(validateTimelineDurationPlanV1(output)).toEqual(output);
    expect(output.duration_plan_hash).toBe(computeTimelineDurationPlanHash(output));
  });

  it('fails closed when the embedded parent plan hash is invalid', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        parent_duration_plan: { ...parent, duration_plan_hash: '0'.repeat(64) },
      },
      'TIMELINE_DURATION_PLAN_HASH_MISMATCH',
    );
  });

  it('fails closed when the resolution binds a different parent plan hash', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [
          resolution(parent, { parent_duration_plan_hash: '0'.repeat(64) }),
        ],
      },
      'SUPPLEMENTAL_PARENT_PLAN_HASH_MISMATCH',
    );
  });

  it('fails closed when the child plan hash is invalid', () => {
    const { input, child } = baseInput();
    expectFailure(
      { ...input, child_duration_plan: { ...child, duration_plan_hash: '0'.repeat(64) } },
      'TIMELINE_DURATION_PLAN_HASH_MISMATCH',
    );
  });

  it('fails closed when the parent requirement does not exist', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [
          resolution(parent, { parent_requirement_id: 'additional_missing' }),
        ],
      },
      'SUPPLEMENTAL_PARENT_REQUIREMENT_NOT_FOUND',
    );
  });

  it('fails closed on duplicate parent requirement identity', () => {
    const { input, parent } = baseInput();
    const duplicateParent = withPlanHash({
      ...parent,
      additional_selection_requirements: [
        ...parent.additional_selection_requirements,
        parent.additional_selection_requirements[0]!,
      ],
    });
    expectFailure(
      { ...input, parent_duration_plan: duplicateParent },
      'EXECUTION_COVERAGE_OVERLAP',
    );
  });

  it('rejects any supplemental status other than NO_MATCH', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [{ ...resolution(parent), status: 'SELECTED' }],
      },
      'SUPPLEMENTAL_NO_MATCH_STATUS_REQUIRED',
    );
  });

  it('fails closed on supplemental slot mismatch', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [resolution(parent, { slot_id: 'slot_other' })],
      },
      'SUPPLEMENTAL_NO_MATCH_SLOT_ID_MISMATCH',
    );
  });

  it('forbids reuse of a parent-consumed D decision identity', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [
          resolution(parent, { selection_request_id: 'selection_initial' }),
        ],
      },
      'SUPPLEMENTAL_D_DECISION_REUSES_PARENT_SELECTION',
    );
  });

  it('requires a new child planning request identity', () => {
    const { input, child } = baseInput();
    const sameRequestChild = withPlanHash({
      ...child,
      planning_request_id: 'planning_parent',
    });
    expectFailure(
      { ...input, child_duration_plan: sameRequestChild },
      'SUPPLEMENTAL_RESOLUTION_REQUIRES_NEW_PLANNING_REQUEST',
    );
  });

  it('fails closed when child shortage geometry differs from the parent', () => {
    const { input, child } = baseInput();
    const changed = {
      ...child.additional_selection_requirements[0]!,
      timeline_start_ms: 500,
      duration_ms: 500,
      remaining_duration_ms: 500,
    };
    const changedSegment = {
      ...child.segments[0]!,
      timeline_end_ms: 500,
      duration_ms: 500,
      source_end_ms: 600,
    };
    const changedChild = withPlanHash({
      ...child,
      segments: [changedSegment],
      additional_selection_requirements: [changed],
    });
    expectFailure(
      { ...input, child_duration_plan: changedChild },
      'SUPPLEMENTAL_REQUIREMENT_GEOMETRY_MISMATCH',
    );
  });

  it('leaves unrelated additional requirements unchanged', () => {
    const { parent, child } = baseInput();
    const secondSegment = {
      ...child.segments[0]!,
      segment_id: 'segment_000002',
      slot_ids: ['slot_2'],
      visual_continuity_group_id: 'group_2',
      timeline_start_ms: 1000,
      timeline_end_ms: 1200,
      duration_ms: 200,
      source_start_ms: 100,
      source_end_ms: 300,
      selection_request_id: 'selection_initial_2',
      selection_slot_id: 'slot_2',
    };
    const secondRequirement = {
      ...child.additional_selection_requirements[0]!,
      requirement_id: 'additional_000002',
      slot_id: 'slot_2',
      visual_continuity_group_id: 'group_2',
      timeline_start_ms: 1200,
      timeline_end_ms: 1500,
      duration_ms: 300,
      remaining_duration_ms: 300,
    };
    const secondInterval = {
      ...child.execution_domain_intervals[0]!,
      execution_interval_id: 'execution_000002',
      slot_id: 'slot_2',
      timeline_start_ms: 1000,
      timeline_end_ms: 1500,
      duration_ms: 500,
    };
    const parentWithTwo = withPlanHash({
      ...parent,
      segments: [...parent.segments, secondSegment],
      additional_selection_requirements: [
        ...parent.additional_selection_requirements,
        secondRequirement,
      ],
      execution_domain_intervals: [...parent.execution_domain_intervals, secondInterval],
    });
    const childWithTwo = withPlanHash({
      ...child,
      segments: [...child.segments, secondSegment],
      additional_selection_requirements: [
        ...child.additional_selection_requirements,
        secondRequirement,
      ],
      execution_domain_intervals: [...child.execution_domain_intervals, secondInterval],
    });
    const output = resolveTimelineSupplementalNoMatchV1({
      parent_duration_plan: parentWithTwo,
      child_duration_plan: childWithTwo,
      supplemental_no_match_resolutions: [resolution(parentWithTwo)],
    });
    expect(output.additional_selection_requirements).toEqual([secondRequirement]);
  });

  it('applies multiple independent resolutions deterministically', () => {
    const { parent, child } = baseInput();
    const secondSegment = {
      ...child.segments[0]!,
      segment_id: 'segment_000002',
      slot_ids: ['slot_2'],
      visual_continuity_group_id: 'group_2',
      timeline_start_ms: 1000,
      timeline_end_ms: 1200,
      duration_ms: 200,
      source_start_ms: 100,
      source_end_ms: 300,
      selection_request_id: 'selection_initial_2',
      selection_slot_id: 'slot_2',
    };
    const secondRequirement = {
      ...child.additional_selection_requirements[0]!,
      requirement_id: 'additional_000002',
      slot_id: 'slot_2',
      visual_continuity_group_id: 'group_2',
      timeline_start_ms: 1200,
      timeline_end_ms: 1500,
      duration_ms: 300,
      remaining_duration_ms: 300,
    };
    const secondInterval = {
      ...child.execution_domain_intervals[0]!,
      execution_interval_id: 'execution_000002',
      slot_id: 'slot_2',
      timeline_start_ms: 1000,
      timeline_end_ms: 1500,
      duration_ms: 500,
    };
    const parentWithTwo = withPlanHash({
      ...parent,
      segments: [...parent.segments, secondSegment],
      additional_selection_requirements: [
        ...parent.additional_selection_requirements,
        secondRequirement,
      ],
      execution_domain_intervals: [...parent.execution_domain_intervals, secondInterval],
    });
    const childWithTwo = withPlanHash({
      ...child,
      segments: [...child.segments, secondSegment],
      additional_selection_requirements: [
        ...child.additional_selection_requirements,
        secondRequirement,
      ],
      execution_domain_intervals: [...child.execution_domain_intervals, secondInterval],
    });
    const first = resolution(parentWithTwo);
    const second = resolution(parentWithTwo, {
      parent_requirement_id: 'additional_000002',
      selection_request_id: 'selection_supplemental_no_match_2',
      decision_receipt_hash: 'f'.repeat(64),
      slot_id: 'slot_2',
    });
    const output = resolveTimelineSupplementalNoMatchV1({
      parent_duration_plan: parentWithTwo,
      child_duration_plan: childWithTwo,
      supplemental_no_match_resolutions: [second, first],
    });
    expect(output.fallback_requirements.map((entry) => entry.requirement_id)).toEqual([
      'additional_000001',
      'additional_000002',
    ]);
    expect(output.additional_selection_requirements).toEqual([]);
  });

  it('forbids one supplemental D decision from resolving two requirements', () => {
    const { input, parent } = baseInput();
    expectFailure(
      {
        ...input,
        supplemental_no_match_resolutions: [
          resolution(parent),
          resolution(parent, { parent_requirement_id: 'additional_other' }),
        ],
      },
      'SUPPLEMENTAL_D_DECISION_REUSED_FOR_MULTIPLE_REQUIREMENTS',
    );
  });

  it('forbids reuse of a supplemental decision already bound to another fallback requirement', () => {
    const { input, parent, child } = baseInput();
    const existingFallback = {
      requirement_id: 'fallback_existing',
      kind: 'FALLBACK_REQUIRED' as const,
      source: 'CODE_D_SELECTION_NO_MATCH' as const,
      slot_id: null,
      pause_id: 'pause_existing',
      route: null,
      visual_continuity_group_id: null,
      timeline_start_ms: 1000,
      timeline_end_ms: 1100,
      duration_ms: 100,
      committed_no_match: {
        selection_request_id: 'selection_supplemental_no_match',
        decision_receipt_hash: supplementalReceiptHash,
        batch_id: 'batch_1',
        video_id: 'video_1',
      },
    };
    const extraDomain = {
      execution_interval_id: 'execution_existing_pause',
      kind: 'DECLARED_PAUSE' as const,
      slot_id: null,
      pause_id: 'pause_existing',
      timeline_start_ms: 1000,
      timeline_end_ms: 1100,
      duration_ms: 100,
    };
    const parentWithFallback = withPlanHash({
      ...parent,
      fallback_requirements: [existingFallback],
      execution_domain_intervals: [...parent.execution_domain_intervals, extraDomain],
    });
    const childWithFallback = withPlanHash({
      ...child,
      fallback_requirements: [existingFallback],
      execution_domain_intervals: [...child.execution_domain_intervals, extraDomain],
    });
    expectFailure(
      {
        ...input,
        parent_duration_plan: parentWithFallback,
        child_duration_plan: childWithFallback,
        supplemental_no_match_resolutions: [resolution(parentWithFallback)],
      },
      'SUPPLEMENTAL_D_DECISION_REUSED_FOR_MULTIPLE_REQUIREMENTS',
    );
  });

  it('allows deterministic replay of the same already committed supplemental decision', () => {
    const { input } = baseInput();
    const expected = canonicalJson(resolveTimelineSupplementalNoMatchV1(input));
    for (let index = 0; index < 100; index += 1) {
      expect(canonicalJson(resolveTimelineSupplementalNoMatchV1(input))).toBe(expected);
    }
  });

  it('does not relax the frozen E2 SELECTED plus NO_MATCH conflict rule', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../packages/timeline/src/planner.ts'),
      'utf8',
    );
    expect(source).toContain("fail('CONFLICTING_FINAL_OUTCOME_FOR_SAME_SLOT')");
  });

  it('has no SQLite, Main, Code D selector, renderer, or sidecar dependency', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../packages/timeline/src/supplemental-no-match.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@app\/local-db|better-sqlite3|apps\/desktop|selectMaterial/u);
    expect(source).not.toMatch(/ffmpeg|renderer|sidecar|digital.human/iu);
  });
});
