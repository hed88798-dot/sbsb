import { randomUUID } from 'node:crypto';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  NarrationAudioRepository,
  ShotPlanAuthorityRepository,
  TimelinePlanRepository,
} from '../../packages/local-db/dist/index.js';
import {
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningRequestHash,
} from '../../packages/timeline/dist/index.js';
import { narrationTimingSnapshotV1Schema } from '../../packages/contracts/dist/index.js';
import { MaterialSelectionService } from '../../apps/desktop/dist-electron/main/material-selection-service.js';
import { TimelineOrchestrationService } from '../../apps/desktop/dist-electron/main/timeline-orchestration-service.js';

// Only accepts references to actual persisted authorities. It cannot confirm plans,
// invent media selections, register audio or create a Render Receipt.
export async function commitDemoTimeline({
  database,
  shot_plan_id,
  shot_plan_version,
  timing_snapshot,
  selection_request_ids,
  timeline_id = `demo_timeline_${randomUUID()}`,
}) {
  const record = new ShotPlanAuthorityRepository(database).getConfirmedVersion(
    shot_plan_id,
    shot_plan_version,
  );
  if (!record) throw new Error('DEMO_CONFIRMED_PLAN_REQUIRED');
  const plan = record.plan;
  if (plan.slots.length < 2 || plan.slots.length > 3) {
    throw new Error('DEMO_REQUIRES_TWO_OR_THREE_SHOTS');
  }
  if (plan.slots.some((slot) => !['ANIMAL', 'PRODUCT'].includes(slot.route))) {
    throw new Error('DEMO_ROUTE_UNSUPPORTED');
  }
  const timing = narrationTimingSnapshotV1Schema.parse(timing_snapshot);
  if (timing.total_duration_ms < 15_000 || timing.total_duration_ms > 30_000) {
    throw new Error('DEMO_DURATION_REQUIRES_15_TO_30_SECONDS');
  }
  const narration = new NarrationAudioRepository(database);
  const audio = await narration.resolveExact({
    narration_audio_id: timing.narration_audio_id,
    expected_sha256: timing.narration_audio_hash,
  });
  if (audio.duration_ms !== timing.total_duration_ms) {
    throw new Error('DEMO_NARRATION_DURATION_MISMATCH');
  }
  const selections = new MaterialSelectionRepository(database);
  if (
    !Array.isArray(selection_request_ids) ||
    selection_request_ids.length !== plan.slots.length ||
    new Set(selection_request_ids).size !== plan.slots.length
  ) {
    throw new Error('DEMO_ONE_SELECTION_PER_SLOT_REQUIRED');
  }
  const refs = selection_request_ids.map((id) => {
    const evidence = selections.getCommittedEvidence(id);
    if (!evidence || evidence.result.status !== 'SELECTED') {
      throw new Error('DEMO_SELECTED_MATERIAL_REQUIRED');
    }
    return {
      selection_request_id: id,
      decision_receipt_hash: evidence.result.decision_receipt_hash,
      asset_id: evidence.result.selected_asset_id,
      shot_id: evidence.result.selected_shot_id,
    };
  });
  const policyPreimage = {
    schema_version: '1.0',
    policy_id: 'demo-timeline-policy-v1',
    policy_version: '1.0.0',
    active_extension_mode: 'SAME_VISUAL_CONTINUITY',
    active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
    passive_extension_target_min_ms: 0,
    passive_extension_max_ms: 0,
    pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
    source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
  };
  const policy = {
    ...policyPreimage,
    policy_snapshot_hash: computeTimelineDurationPolicyHash(policyPreimage),
  };
  const requestPreimage = {
    schema_version: '1.0',
    planning_request_id: `demo_planning_${randomUUID()}`,
    confirmed_shot_plan: plan,
    narration_timing_snapshot: timing,
    committed_selection_refs: refs,
    timeline_policy_id: policy.policy_id,
    timeline_policy_version: policy.policy_version,
    timeline_policy_snapshot_hash: policy.policy_snapshot_hash,
  };
  return new TimelineOrchestrationService({
    materialSelectionRepository: selections,
    mediaIndexRepository: new MediaIndexRepository(database),
    timelinePlanRepository: new TimelinePlanRepository(database),
    materialSelectionService: new MaterialSelectionService({ repository: selections }),
  }).planAndCommitVersion({
    timeline_id,
    expected_parent_version: null,
    planning_request: {
      ...requestPreimage,
      timeline_request_hash: computeTimelinePlanningRequestHash(requestPreimage),
    },
    duration_policy: policy,
    committed_no_match_refs: [],
  });
}
