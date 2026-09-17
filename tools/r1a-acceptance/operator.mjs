import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  MaterialSelectionRepository,
  MediaIndexRepository,
  NarrationAudioRepository,
  RenderPolicyRepository,
  RenderPreparationRepository,
  TimelinePlanRepository,
  openDatabase,
} from '../../packages/local-db/dist/index.js';
import {
  RENDER_POLICY_V1,
  computeNarrationAudioArtifactHashV1,
} from '../../packages/render/dist/index.js';
import {
  computeConfirmedShotPlanHash,
  computeNarrationTimingSnapshotHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningRequestHash,
  parseTimelineDurationPolicyV1,
} from '../../packages/timeline/dist/index.js';
import {
  confirmedShotPlanV1Schema,
  narrationTimingSnapshotV1Schema,
  timelinePlanningRequestV1Schema,
} from '../../packages/contracts/dist/index.js';
import { MaterialSelectionService } from '../../apps/desktop/dist-electron/main/material-selection-service.js';
import { RenderPreparationService } from '../../apps/desktop/dist-electron/main/render-preparation-service.js';
import { RenderStagingService } from '../../apps/desktop/dist-electron/main/render-staging-service.js';
import { TimelineOrchestrationService } from '../../apps/desktop/dist-electron/main/timeline-orchestration-service.js';
import { runCodeCStage } from './code-c-stage.mjs';
import { deriveNarrationArtifact } from './narration.mjs';
import { resolveApprovedRuntimeV2 } from './runtime-authority.mjs';

async function reserveAcceptanceRoot(path, acceptanceId) {
  const root = resolve(path);
  try {
    const entries = await readdir(root);
    if (entries.length !== 0) throw new Error('R1A_ACCEPTANCE_ROOT_NOT_EMPTY');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(root, { recursive: false });
  }
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('R1A_ACCEPTANCE_ROOT_NOT_EMPTY');
  }
  await writeFile(
    join(root, 'R1A_AUTHORITY_ATTEMPT.json'),
    `${JSON.stringify({ schema_version: '1.0', acceptance_id: acceptanceId, state: 'STARTED' })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return root;
}

function buildPlanningRequest(config, narrationArtifact, decisions) {
  const planPreimage = {
    schema_version: '1.0',
    shot_plan_id: config.shot_plan_id,
    shot_plan_version: config.shot_plan_version,
    source_document_id: config.source_document_id,
    source_document_version: config.source_document_version,
    source_document_hash: config.source_document_hash,
    review_state: 'CONFIRMED',
    source_offset_unit: 'UNICODE_CODE_POINT',
    slots: config.slots,
  };
  const confirmedShotPlan = confirmedShotPlanV1Schema.parse({
    ...planPreimage,
    shot_plan_hash: computeConfirmedShotPlanHash(planPreimage),
  });
  const totalDurationMs = Math.max(...config.slot_timings.map((timing) => timing.end_ms));
  if (narrationArtifact.duration_ms !== totalDurationMs) {
    throw new Error('REAL_NARRATION_INPUT_REQUIRED');
  }
  const timingPreimage = {
    schema_version: '1.0',
    timing_snapshot_id: config.timing_snapshot_id,
    timing_snapshot_version: config.timing_snapshot_version,
    timing_kind: 'EXACT',
    shot_plan_id: confirmedShotPlan.shot_plan_id,
    shot_plan_hash: confirmedShotPlan.shot_plan_hash,
    source_document_id: confirmedShotPlan.source_document_id,
    source_document_hash: confirmedShotPlan.source_document_hash,
    narration_audio_id: narrationArtifact.narration_audio_id,
    narration_audio_hash: narrationArtifact.artifact_sha256,
    total_duration_ms: totalDurationMs,
    slot_timings: config.slot_timings,
    pause_intervals: config.pause_intervals,
  };
  const narrationTiming = narrationTimingSnapshotV1Schema.parse({
    ...timingPreimage,
    timing_snapshot_hash: computeNarrationTimingSnapshotHash(timingPreimage),
  });
  const durationPolicy = parseTimelineDurationPolicyV1({
    ...config.duration_policy,
    policy_snapshot_hash: computeTimelineDurationPolicyHash(config.duration_policy),
  });
  const refs = decisions.map((decision) => ({
    selection_request_id: decision.selection_request_id,
    decision_receipt_hash: decision.decision_receipt_hash,
    asset_id: decision.selected_asset_id,
    shot_id: decision.selected_shot_id,
  }));
  const requestPreimage = {
    schema_version: '1.0',
    planning_request_id: config.planning_request_id,
    confirmed_shot_plan: confirmedShotPlan,
    narration_timing_snapshot: narrationTiming,
    committed_selection_refs: refs,
    timeline_policy_id: durationPolicy.policy_id,
    timeline_policy_version: durationPolicy.policy_version,
    timeline_policy_snapshot_hash: durationPolicy.policy_snapshot_hash,
  };
  return {
    durationPolicy,
    request: timelinePlanningRequestV1Schema.parse({
      ...requestPreimage,
      timeline_request_hash: computeTimelinePlanningRequestHash(requestPreimage),
    }),
  };
}

function successResult(ready, timeline, narrationArtifact) {
  return {
    JOB_ID: ready.job.job_id,
    JOB_STATE: ready.job.state,
    TIMELINE_ID: timeline.timeline_id,
    TIMELINE_VERSION: timeline.version,
    TIMELINE_COMMIT_RECEIPT_HASH: timeline.commit_receipt.commit_receipt_hash,
    DURATION_PLAN_HASH: timeline.duration_plan.duration_plan_hash,
    RENDER_POLICY_ID: RENDER_POLICY_V1.policy_id,
    RENDER_POLICY_VERSION: RENDER_POLICY_V1.policy_version,
    RENDER_POLICY_HASH: RENDER_POLICY_V1.policy_hash,
    LOGICAL_RENDER_HASH: ready.snapshot.logical_render_hash,
    EXECUTION_SNAPSHOT_HASH: ready.snapshot.execution_snapshot_hash,
    NARRATION_AUDIO_ID: narrationArtifact.narration_audio_id,
    NARRATION_AUDIO_SHA256: narrationArtifact.artifact_sha256,
    SOURCE_ARTIFACT_COUNT: ready.snapshot.source_artifacts.length,
    RUNTIME_ID: ready.snapshot.runtime_identity.runtime_id,
    RUNTIME_PROFILE_HASH: ready.snapshot.runtime_identity.capability_profile_hash,
  };
}

export async function runControlledAuthorityOperator(config, overrides = {}) {
  const acceptanceRoot = await reserveAcceptanceRoot(
    config.acceptance_data_root,
    config.acceptance_id,
  );
  let opened;
  try {
    opened = await openDatabase({
      dbPath: join(acceptanceRoot, 'acceptance.sqlite'),
      migrationsDirectory: config.migrations_directory,
    });
    if (opened.migration.currentVersion !== 9) throw new Error('R1A_MIGRATION_SET_INVALID');
    const db = opened.db;
    const mediaIndex = new MediaIndexRepository(db);
    const materialSelections = new MaterialSelectionRepository(db);
    const timelinePlans = new TimelinePlanRepository(db);
    const narrationAudio = new NarrationAudioRepository(db);
    const renderPolicies = new RenderPolicyRepository(db);
    const preparations = new RenderPreparationRepository(db);
    const materialSelection = new MaterialSelectionService({ repository: materialSelections });
    const timelineOrchestration = new TimelineOrchestrationService({
      materialSelectionRepository: materialSelections,
      mediaIndexRepository: mediaIndex,
      timelinePlanRepository: timelinePlans,
      materialSelectionService: materialSelection,
    });

    const runtime = overrides.runtime ?? (await resolveApprovedRuntimeV2(config.runtime));
    const codeC = overrides.codeC ?? runCodeCStage;
    const eligibleSelections = await codeC({
      config: { ...config.code_c, acceptance_id: config.acceptance_id },
      acceptanceRoot,
      repository: mediaIndex,
      ffprobePath: runtime.ffprobePath,
    });
    let decisions;
    try {
      decisions = eligibleSelections.map((selection) => materialSelection.select(selection));
    } catch (error) {
      throw new Error('CODE_D_SELECTION_FAILED', { cause: error });
    }
    if (decisions.some((decision) => decision.status !== 'SELECTED')) {
      throw new Error('CODE_D_NO_SELECTED_RESULT');
    }

    const deriveNarration = overrides.deriveNarration ?? deriveNarrationArtifact;
    const narrationArtifact = await deriveNarration(config.narration, runtime.ffprobePath);
    if (
      narrationArtifact.artifact_hash !== computeNarrationAudioArtifactHashV1(narrationArtifact)
    ) {
      throw new Error('REAL_NARRATION_INPUT_REQUIRED');
    }
    await narrationAudio.register({
      artifact: narrationArtifact,
      trusted_local_path: config.narration.source_path,
    });
    const planning = buildPlanningRequest(config.timeline, narrationArtifact, decisions);
    let timeline;
    try {
      timeline = timelineOrchestration.planAndCommitVersion({
        timeline_id: config.timeline.timeline_id,
        expected_parent_version: null,
        planning_request: planning.request,
        duration_policy: planning.durationPolicy,
        committed_no_match_refs: [],
      });
    } catch (error) {
      throw new Error('CODE_E_PLANNING_FAILED', { cause: error });
    }
    if (timeline.duration_plan.additional_selection_requirements.length !== 0) {
      throw new Error('CODE_E_PLANNING_FAILED');
    }
    renderPolicies.register(RENDER_POLICY_V1);
    const staging = new RenderStagingService({
      stagingRoot: config.staging_root,
      outputRoot: config.output_root,
    });
    const preparation = new RenderPreparationService({
      timelinePlans,
      materialSelections,
      mediaIndex,
      narrationAudio,
      renderPolicies,
      preparations,
      staging,
      runtimeIdentity: runtime.identity,
      ...(overrides.allowMockRuntimeForTests ? { allowMockRuntimeForTests: true } : {}),
    });
    let ready;
    try {
      ready = await preparation.prepare({
        schema_version: '1.0',
        timeline_id: timeline.timeline_id,
        timeline_version: timeline.version,
        expected_timeline_commit_receipt_hash: timeline.commit_receipt.commit_receipt_hash,
        render_policy_id: RENDER_POLICY_V1.policy_id,
        render_policy_version: RENDER_POLICY_V1.policy_version,
        render_policy_hash: RENDER_POLICY_V1.policy_hash,
      });
    } catch (error) {
      throw new Error('R1A_PREPARATION_FAILED', { cause: error });
    }
    if (ready.job.state !== 'READY_FOR_EXECUTION') throw new Error('R1A_PREPARATION_FAILED');
    const result = successResult(ready, timeline, narrationArtifact);
    await writeFile(
      join(acceptanceRoot, 'R1A_AUTHORITY_RESULT.json'),
      `${JSON.stringify(result)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return result;
  } finally {
    opened?.db.close();
  }
}
