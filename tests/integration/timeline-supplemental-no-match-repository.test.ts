import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  committedMaterialSelectionRefV1Schema,
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
  type ConfirmedShotPlanV1,
  type NarrationTimingSnapshotV1,
  type TimelinePlanningRequestV1,
} from '../../packages/contracts/src/index.js';
import { canonicalJson, sha256 } from '../../packages/domain-media-index/src/signature.js';
import {
  TimelinePlanRepository,
  openDatabase,
  type TimelinePlanCommitInputV1,
} from '../../packages/local-db/src/index.js';
import {
  computeTimelineDurationPolicyHash,
  planTimelineDurationV1,
  type TimelineDurationPolicyV1,
} from '../../packages/timeline/src/duration-plan.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelinePlanningRequestHash,
} from '../../packages/timeline/src/hash.js';
import {
  normalizeTimelinePlanningFactsV1,
  type ResolvedMaterialDecisionEvidenceV1,
} from '../../packages/timeline/src/planner.js';
import { resolveTimelineSupplementalNoMatchV1 } from '../../packages/timeline/src/supplemental-no-match.js';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
const initialReceiptHash = sha256('initial-receipt');
const supplementalReceiptHash = sha256('supplemental-receipt');

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

function shotPlan(): ConfirmedShotPlanV1 {
  const preimage: Omit<ConfirmedShotPlanV1, 'shot_plan_hash'> = {
    schema_version: '1.0',
    shot_plan_id: 'shot_plan_1',
    shot_plan_version: 1,
    source_document_id: 'document_1',
    source_document_version: 1,
    source_document_hash: sha256('document'),
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
        visual_continuity_group_id: 'group_1',
      },
    ],
  };
  return confirmedShotPlanV1Schema.parse({
    ...preimage,
    shot_plan_hash: computeConfirmedShotPlanHash(preimage),
  });
}

function timing(plan: ConfirmedShotPlanV1): NarrationTimingSnapshotV1 {
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
    narration_audio_hash: sha256('audio'),
    total_duration_ms: 1000,
    slot_timings: [{ slot_id: 'slot_1', start_ms: 0, end_ms: 1000 }],
    pause_intervals: [],
  };
  return narrationTimingSnapshotV1Schema.parse({
    ...preimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(preimage),
  });
}

function request(
  planningRequestId: string,
  plan: ConfirmedShotPlanV1,
  exactTiming: NarrationTimingSnapshotV1,
  durationPolicy: TimelineDurationPolicyV1,
): TimelinePlanningRequestV1 {
  const preimage: Omit<TimelinePlanningRequestV1, 'timeline_request_hash'> = {
    schema_version: '1.0',
    planning_request_id: planningRequestId,
    confirmed_shot_plan: plan,
    narration_timing_snapshot: exactTiming,
    committed_selection_refs: [
      committedMaterialSelectionRefV1Schema.parse({
        selection_request_id: 'selection_initial',
        decision_receipt_hash: initialReceiptHash,
        asset_id: 'asset_1',
        shot_id: 'shot_1',
      }),
    ],
    timeline_policy_id: durationPolicy.policy_id,
    timeline_policy_version: durationPolicy.policy_version,
    timeline_policy_snapshot_hash: durationPolicy.policy_snapshot_hash,
  };
  return timelinePlanningRequestV1Schema.parse({
    ...preimage,
    timeline_request_hash: computeTimelinePlanningRequestHash(preimage),
  });
}

function artifacts(planningRequestId: string) {
  const durationPolicy = policy();
  const plan = shotPlan();
  const exactTiming = timing(plan);
  const planningRequest = request(planningRequestId, plan, exactTiming, durationPolicy);
  const resolved: ResolvedMaterialDecisionEvidenceV1[] = [
    {
      selection_request_id: 'selection_initial',
      decision_receipt_hash: initialReceiptHash,
      batch_id: 'batch_1',
      video_id: 'video_1',
      slot_id: 'slot_1',
      status: 'SELECTED',
      asset_id: 'asset_1',
      shot_id: 'shot_1',
      revision: 1,
      shot_start_ms: 100,
      shot_end_ms: 500,
    },
  ];
  const planningFacts = normalizeTimelinePlanningFactsV1({
    request: planningRequest,
    resolved_material_decisions: resolved,
  });
  const durationPlan = planTimelineDurationV1({
    planning_facts: planningFacts,
    duration_policy: durationPolicy,
  });
  return { planningRequest, planningFacts, durationPolicy, durationPlan };
}

describe('E3.1 compatibility with frozen E4 persistence', () => {
  it('commits, reads, and recovers the resolved child through the existing repository', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'timeline-e3-1-'));
    const databasePath = join(directory, 'app.db');
    let opened = await openDatabase({ dbPath: databasePath, migrationsDirectory });
    let repository = new TimelinePlanRepository(opened.db, {
      clock: () => '2026-09-10T00:00:00.000Z',
    });
    const parent = artifacts('planning_parent');
    const child = artifacts('planning_child');
    const resolvedChild = resolveTimelineSupplementalNoMatchV1({
      parent_duration_plan: parent.durationPlan,
      child_duration_plan: child.durationPlan,
      supplemental_no_match_resolutions: [
        {
          parent_duration_plan_hash: parent.durationPlan.duration_plan_hash,
          parent_requirement_id: 'additional_000001',
          selection_request_id: 'selection_supplemental_no_match',
          decision_receipt_hash: supplementalReceiptHash,
          batch_id: 'batch_1',
          video_id: 'video_1',
          slot_id: 'slot_1',
          status: 'NO_MATCH',
        },
      ],
    });
    const parentInput: TimelinePlanCommitInputV1 = {
      timeline_id: 'timeline_1',
      expected_parent_version: null,
      planning_request: parent.planningRequest,
      planning_facts: parent.planningFacts,
      duration_policy: parent.durationPolicy,
      duration_plan: parent.durationPlan,
    };
    const childInput: TimelinePlanCommitInputV1 = {
      timeline_id: 'timeline_1',
      expected_parent_version: 1,
      planning_request: child.planningRequest,
      planning_facts: child.planningFacts,
      duration_policy: child.durationPolicy,
      duration_plan: resolvedChild,
    };

    expect(repository.commitVersion(parentInput).version).toBe(1);
    expect(repository.commitVersion(childInput).version).toBe(2);
    const committed = repository.getVersion('timeline_1', 2)!;
    expect(committed.parent_version).toBe(1);
    expect(committed.duration_plan).toEqual(resolvedChild);
    expect(committed.duration_plan.fallback_requirements[0]).toMatchObject({
      requirement_id: 'additional_000001',
      timeline_start_ms: 400,
      timeline_end_ms: 1000,
      committed_no_match: {
        selection_request_id: 'selection_supplemental_no_match',
        decision_receipt_hash: supplementalReceiptHash,
      },
    });
    expect(canonicalJson(repository.getVersion('timeline_1', 1)!.duration_plan)).toBe(
      canonicalJson(parent.durationPlan),
    );

    opened.db.close();
    opened = await openDatabase({ dbPath: databasePath, migrationsDirectory });
    repository = new TimelinePlanRepository(opened.db);
    expect(repository.getVersion('timeline_1', 2)!.duration_plan).toEqual(resolvedChild);
    opened.db.close();
  });
});
