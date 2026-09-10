import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NarrationAudioRepository,
  RenderPolicyRepository,
  RenderPreparationRepository,
} from '../../packages/local-db/src/index.js';
import {
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  RENDER_POLICY_V1,
  buildLogicalRenderPlanV1,
  computeNarrationAudioArtifactHashV1,
  computeRenderReceiptHashV1,
  type NarrationAudioArtifactV1,
  type RenderAcceptedTimelineRequestV1,
  type RenderRuntimeIdentityV1,
  type RenderReceiptV1,
  type ResolvedRenderSourceV1,
} from '../../packages/render/src/index.js';
import { RenderPreparationService } from '../../apps/desktop/src/main/render-preparation-service.js';
import { RenderStagingService } from '../../apps/desktop/src/main/render-staging-service.js';
import { E6TimelineFixture, e6DurationPolicy, e6Sha256 } from '../helpers/e6-timeline-fixture.js';

let fixture: E6TimelineFixture;

beforeEach(async () => {
  fixture = new E6TimelineFixture();
  await fixture.open();
});

afterEach(() => fixture.close());

function mockRuntime(): RenderRuntimeIdentityV1 {
  return {
    schema_version: '1.0',
    runtime_id: 'mock_r1a_runtime',
    platform: 'darwin',
    architecture: 'arm64',
    ffmpeg_executable_path: '/mock/runtime/ffmpeg',
    ffmpeg_entrypoint_sha256: '1'.repeat(64),
    ffprobe_executable_path: '/mock/runtime/ffprobe',
    ffprobe_entrypoint_sha256: '2'.repeat(64),
    companion_manifest_sha256: '3'.repeat(64),
    capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
    capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
    capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
    runtime_member_hashes: [{ relative_path: 'ffmpeg', sha256: '1'.repeat(64) }],
    approval_status: 'MOCK_R1A_TEST_ONLY',
  };
}

async function setup(options: { overwriteSource?: boolean } = {}) {
  const candidate = fixture.seedSyntheticCandidate('asset_render', 'shot_render', 1000, 0.9);
  const decision = fixture.select('selection_render', 'slot_render', [candidate]);
  const timeline = fixture.orchestration.planAndCommitVersion({
    timeline_id: 'timeline_render',
    expected_parent_version: null,
    planning_request: fixture.planningRequest(
      'planning_render',
      [{ slotId: 'slot_render', route: 'ANIMAL', startMs: 0, endMs: 1000 }],
      [fixture.selectedRef(decision)],
    ),
    duration_policy: e6DurationPolicy(),
    committed_no_match_refs: [],
  });
  const narrationPath = join(fixture.directory, 'narration.wav');
  writeFileSync(narrationPath, 'e6-audio');
  const narrationPreimage: Omit<NarrationAudioArtifactV1, 'artifact_hash'> = {
    schema_version: '1.0',
    narration_audio_id: 'e6_audio',
    artifact_id: 'narration_artifact_1',
    artifact_sha256: e6Sha256('e6-audio'),
    duration_ms: 1000,
    duration_measurement: 'SAMPLE_COUNT_DERIVED',
    sample_count: 48000,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: Buffer.byteLength('e6-audio'),
    producer_ref: 'upstream_tts_artifact_1',
    provenance_ref: null,
  };
  const artifact: NarrationAudioArtifactV1 = {
    ...narrationPreimage,
    artifact_hash: computeNarrationAudioArtifactHashV1(narrationPreimage),
  };
  const narrationRepository = new NarrationAudioRepository(fixture.database, {
    clock: () => '2026-09-11T00:00:00.000Z',
  });
  await narrationRepository.register({ artifact, trusted_local_path: narrationPath });
  const policyRepository = new RenderPolicyRepository(fixture.database, {
    clock: () => '2026-09-11T00:00:00.000Z',
  });
  policyRepository.register(RENDER_POLICY_V1);
  const preparationRepository = new RenderPreparationRepository(fixture.database, {
    clock: () => '2026-09-11T00:00:00.000Z',
    id: () => 'fixed-preparation-id',
  });
  const stagingRoot = join(fixture.directory, 'render-staging');
  const outputRoot = join(fixture.directory, 'render-output');
  const staging = new RenderStagingService({ stagingRoot, outputRoot });
  const service = new RenderPreparationService({
    timelinePlans: fixture.timelineRepository,
    materialSelections: fixture.materialRepository,
    mediaIndex: fixture.mediaRepository,
    narrationAudio: narrationRepository,
    renderPolicies: policyRepository,
    preparations: preparationRepository,
    staging,
    runtimeIdentity: mockRuntime(),
    allowMockRuntimeForTests: true,
  });
  const request: RenderAcceptedTimelineRequestV1 = {
    schema_version: '1.0',
    timeline_id: timeline.timeline_id,
    timeline_version: timeline.version,
    expected_timeline_commit_receipt_hash: timeline.commit_receipt.commit_receipt_hash,
    render_policy_id: RENDER_POLICY_V1.policy_id,
    render_policy_version: RENDER_POLICY_V1.policy_version,
    render_policy_hash: RENDER_POLICY_V1.policy_hash,
  };
  if (options.overwriteSource) {
    writeFileSync(join(fixture.directory, 'asset_render.mp4'), 'tampered-source');
  }
  return {
    timeline,
    request,
    artifact,
    narrationPath,
    narrationRepository,
    policyRepository,
    preparationRepository,
    staging,
    stagingRoot,
    outputRoot,
    service,
  };
}

describe('Code G R1A Main-owned preparation flow', () => {
  it('pins exact authority, stages verified bytes, persists READY_FOR_EXECUTION, and is idempotent', async () => {
    const context = await setup();
    const first = await context.service.prepare(context.request);
    expect(first.job.state).toBe('READY_FOR_EXECUTION');
    expect(first.job.attempt_number).toBe(1);
    expect(first.job.logical_render_hash).toBe(first.snapshot.logical_render_hash);
    expect(first.snapshot.source_artifacts).toHaveLength(1);
    expect(first.snapshot.source_artifacts[0]!.staged_sha256).toBe(
      first.snapshot.source_artifacts[0]!.authority_sha256,
    );
    expect(first.snapshot.narration_artifact.staged_sha256).toBe(context.artifact.artifact_sha256);
    expect(existsSync(first.snapshot.source_artifacts[0]!.staged_path)).toBe(true);
    expect(existsSync(first.snapshot.narration_artifact.staged_path)).toBe(true);
    expect(
      fixture.database.prepare('SELECT count(*) FROM render_execution_snapshots').pluck().get(),
    ).toBe(1);
    expect(fixture.database.prepare('SELECT count(*) FROM render_artifacts').pluck().get()).toBe(2);
    expect(fixture.database.prepare('SELECT count(*) FROM render_receipts').pluck().get()).toBe(0);

    const replay = await context.service.prepare(context.request);
    expect(replay.job.job_id).toBe(first.job.job_id);
    expect(replay.snapshot.execution_snapshot_hash).toBe(first.snapshot.execution_snapshot_hash);
    expect(fixture.database.prepare('SELECT count(*) FROM render_jobs').pluck().get()).toBe(1);
    expect(
      fixture.database.prepare('SELECT count(*) FROM render_execution_snapshots').pluck().get(),
    ).toBe(1);
  });

  it('fails closed on an exact Timeline receipt mismatch', async () => {
    const context = await setup();
    await expect(
      context.service.prepare({
        ...context.request,
        expected_timeline_commit_receipt_hash: '9'.repeat(64),
      }),
    ).rejects.toThrowError('RENDER_TIMELINE_RECEIPT_MISMATCH');
    expect(fixture.database.prepare('SELECT state FROM render_jobs').pluck().get()).toBe('FAILED');
  });

  it('fails closed on a RenderPolicy hash pin mismatch', async () => {
    const context = await setup();
    await expect(
      context.service.prepare({ ...context.request, render_policy_hash: '7'.repeat(64) }),
    ).rejects.toThrowError('RENDER_POLICY_EXACT_PIN_MISMATCH');
    expect(fixture.database.prepare('SELECT state FROM render_jobs').pluck().get()).toBe('FAILED');
  });

  it('fails closed when source bytes change after Timeline commit', async () => {
    const context = await setup({ overwriteSource: true });
    await expect(context.service.prepare(context.request)).rejects.toThrowError(
      'EXACT_MEDIA_REVISION_NOT_EXECUTABLE',
    );
  });

  it('recovers a crash during staging by deleting the old attempt and restaging from authority', async () => {
    const context = await setup();
    let job = context.preparationRepository.begin(context.request);
    job = context.preparationRepository.markEntryValidated(job.job_id);
    const segment = context.timeline.duration_plan.segments[0]!;
    const material = context.timeline.planning_facts.slots[0]!.selected_materials[0]!;
    const executable = fixture.mediaRepository.assertExactShotExecutable({
      asset_id: segment.source_asset_id,
      revision: segment.source_revision,
      shot_id: segment.source_shot_id,
      start_ms: material.shot_start_ms,
      end_ms: material.shot_end_ms,
    });
    const resolvedSource: ResolvedRenderSourceV1 = {
      schema_version: '1.0',
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
      resolved_source_path: executable.sourcePath,
      verified_file_sha256: executable.fileHash,
    };
    const narration = await context.narrationRepository.resolveExact({
      narration_audio_id: 'e6_audio',
      expected_sha256: e6Sha256('e6-audio'),
    });
    const plan = buildLogicalRenderPlanV1({
      timeline_id: context.timeline.timeline_id,
      timeline_version: context.timeline.version,
      timeline_commit_receipt_hash: context.timeline.commit_receipt.commit_receipt_hash,
      duration_plan_hash: context.timeline.duration_plan.duration_plan_hash,
      total_timeline_duration_ms: 1000,
      policy: RENDER_POLICY_V1,
      sources: [resolvedSource],
      narration,
    });
    job = context.preparationRepository.recordLogicalPlan(job.job_id, plan);
    job = context.preparationRepository.markStaging(job.job_id);
    const oldAttemptId = `${job.job_id.replaceAll('-', '_')}_attempt_1`;
    const oldAttemptRoot = join(context.stagingRoot, oldAttemptId);
    mkdirSync(oldAttemptRoot, { recursive: true });
    writeFileSync(join(oldAttemptRoot, 'source.partial'), 'untrusted-partial');

    const recovered = await context.service.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.job.state).toBe('READY_FOR_EXECUTION');
    expect(recovered[0]!.job.attempt_number).toBe(2);
    expect(existsSync(oldAttemptRoot)).toBe(false);
    expect(existsSync(recovered[0]!.snapshot.staging_root)).toBe(true);
  });

  it('revalidates a persisted READY snapshot and restages if its bytes are no longer trusted', async () => {
    const context = await setup();
    const first = await context.service.prepare(context.request);
    writeFileSync(first.snapshot.source_artifacts[0]!.staged_path, 'corrupted-staging');

    const recovered = await context.service.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.job.state).toBe('READY_FOR_EXECUTION');
    expect(recovered[0]!.job.attempt_number).toBe(2);
    expect(recovered[0]!.snapshot.execution_snapshot_hash).not.toBe(
      first.snapshot.execution_snapshot_hash,
    );
    expect(existsSync(first.snapshot.staging_root)).toBe(false);
    expect(existsSync(recovered[0]!.snapshot.staging_root)).toBe(true);
  });

  it('persists only a self-hashed test receipt bound to the exact job and execution snapshot', async () => {
    const context = await setup();
    const ready = await context.service.prepare(context.request);
    const preimage: Omit<RenderReceiptV1, 'receipt_hash'> = {
      schema_version: '1.0',
      receipt_id: 'test_failed_receipt_1',
      job_id: ready.job.job_id,
      logical_render_hash: ready.snapshot.logical_render_hash,
      execution_snapshot_hash: ready.snapshot.execution_snapshot_hash,
      timeline_id: context.request.timeline_id,
      timeline_version: context.request.timeline_version,
      timeline_commit_receipt_hash: context.request.expected_timeline_commit_receipt_hash,
      render_policy_id: context.request.render_policy_id,
      render_policy_version: context.request.render_policy_version,
      render_policy_hash: context.request.render_policy_hash,
      runtime_id: ready.snapshot.runtime_identity.runtime_id,
      runtime_manifest_sha256: ready.snapshot.runtime_identity.companion_manifest_sha256,
      terminal_state: 'FAILED',
      output_artifact: null,
      verification_facts: null,
      error_id: 'TEST_ONLY_FAILURE',
      created_at: '2026-09-11T00:00:00.000Z',
    };
    const receipt: RenderReceiptV1 = {
      ...preimage,
      receipt_hash: computeRenderReceiptHashV1(preimage),
    };
    expect(context.preparationRepository.commitReceipt(receipt)).toEqual(receipt);
    expect(context.preparationRepository.commitReceipt(receipt)).toEqual(receipt);
    expect(fixture.database.prepare('SELECT count(*) FROM render_receipts').pluck().get()).toBe(1);

    const wrongRuntimePreimage = {
      ...preimage,
      receipt_id: 'test_failed_receipt_2',
      runtime_id: 'wrong',
    };
    expect(() =>
      context.preparationRepository.commitReceipt({
        ...wrongRuntimePreimage,
        receipt_hash: computeRenderReceiptHashV1(wrongRuntimePreimage),
      }),
    ).toThrowError('RENDER_RECEIPT_AUTHORITY_BINDING_MISMATCH');
  });
});

describe('Code G R1A narration and staging negative controls', () => {
  it('rejects narration ID/hash mismatch, missing artifact, and stale location', async () => {
    const context = await setup();
    await expect(
      context.narrationRepository.resolveExact({
        narration_audio_id: 'missing_audio',
        expected_sha256: context.artifact.artifact_sha256,
      }),
    ).rejects.toThrowError('NARRATION_AUDIO_ARTIFACT_NOT_FOUND');
    await expect(
      context.narrationRepository.resolveExact({
        narration_audio_id: 'e6_audio',
        expected_sha256: '8'.repeat(64),
      }),
    ).rejects.toThrowError('NARRATION_AUDIO_TIMELINE_HASH_MISMATCH');
    rmSync(context.narrationPath);
    await expect(
      context.narrationRepository.resolveExact({
        narration_audio_id: 'e6_audio',
        expected_sha256: context.artifact.artifact_sha256,
      }),
    ).rejects.toThrowError('NARRATION_AUDIO_ARTIFACT_NOT_EXECUTABLE');
  });

  it('deduplicates physical staging by exact hash without merging segment audit identities', async () => {
    const context = await setup();
    const sourcePath = join(fixture.directory, 'asset_render.mp4');
    const sourceHash = e6Sha256(`e6-media:asset_render:shot_render:1000`);
    const base: ResolvedRenderSourceV1 = {
      schema_version: '1.0',
      segment_id: 'segment_1',
      asset_id: 'asset_1',
      revision: 1,
      shot_id: 'shot_1',
      shot_start_ms: 0,
      shot_end_ms: 1000,
      source_start_ms: 0,
      source_end_ms: 500,
      timeline_start_ms: 0,
      timeline_end_ms: 500,
      selection_request_id: 'selection_1',
      decision_receipt_hash: '1'.repeat(64),
      selection_slot_id: 'slot_1',
      resolved_source_path: sourcePath,
      verified_file_sha256: sourceHash,
    };
    const narration = await context.narrationRepository.resolveExact({
      narration_audio_id: 'e6_audio',
      expected_sha256: context.artifact.artifact_sha256,
    });
    const staged = await context.staging.stage({
      attempt_id: 'dedup_attempt',
      sources: [
        base,
        {
          ...base,
          segment_id: 'segment_2',
          asset_id: 'asset_2',
          shot_id: 'shot_2',
          selection_request_id: 'selection_2',
          selection_slot_id: 'slot_2',
          timeline_start_ms: 500,
          timeline_end_ms: 1000,
        },
      ],
      narration,
    });
    expect(staged.source_artifacts).toHaveLength(1);
    expect(staged.source_artifacts[0]!.segment_ids).toEqual(['segment_1', 'segment_2']);
  });

  it('deletes an unverified partial and fails when staging hash differs from authority', async () => {
    const context = await setup();
    const narration = await context.narrationRepository.resolveExact({
      narration_audio_id: 'e6_audio',
      expected_sha256: context.artifact.artifact_sha256,
    });
    const sourcePath = join(fixture.directory, 'asset_render.mp4');
    await expect(
      context.staging.stage({
        attempt_id: 'bad_hash_attempt',
        sources: [
          {
            schema_version: '1.0',
            segment_id: 'segment_bad',
            asset_id: 'asset_render',
            revision: 1,
            shot_id: 'shot_render',
            shot_start_ms: 0,
            shot_end_ms: 1000,
            source_start_ms: 0,
            source_end_ms: 1000,
            timeline_start_ms: 0,
            timeline_end_ms: 1000,
            selection_request_id: 'selection_bad',
            decision_receipt_hash: '1'.repeat(64),
            selection_slot_id: 'slot_bad',
            resolved_source_path: sourcePath,
            verified_file_sha256: '0'.repeat(64),
          },
        ],
        narration,
      }),
    ).rejects.toThrowError('RENDER_SOURCE_HASH_MISMATCH_BEFORE_STAGING');
  });
});
