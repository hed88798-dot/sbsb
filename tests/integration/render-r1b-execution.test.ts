import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../packages/domain-media-index/src/index.js';
import {
  RenderExecutionRepository,
  RenderPolicyRepository,
  RenderPreparationRepository,
} from '../../packages/local-db/src/index.js';
import {
  CODE_G_R1B_APPROVED_FFMPEG_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  RENDER_POLICY_V1,
  buildExecutionSnapshotV1,
  computeLogicalRenderHashV1,
  type LogicalRenderPlanV1,
  type RenderExecutionSnapshotV1,
} from '../../packages/render/src/index.js';
import { RenderExecutionServiceV1 } from '../../apps/desktop/src/main/render-execution-service.js';
import type {
  RenderAttemptPathsV1,
  RenderExecutionFilePortV1,
} from '../../apps/desktop/src/main/render-execution-file-service.js';
import type {
  RenderProcessAdapterV1,
  RenderProcessRequestV1,
  RenderProcessResultV1,
} from '../../apps/desktop/src/main/render-process-adapter.js';
import { E6TimelineFixture } from '../helpers/e6-timeline-fixture.js';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const outputHash = 'd'.repeat(64);

function logicalPlan(): LogicalRenderPlanV1 {
  const preimage: Omit<LogicalRenderPlanV1, 'logical_render_hash'> = {
    schema_version: '1.0',
    timeline_id: 'historical_timeline',
    timeline_version: 1,
    timeline_commit_receipt_hash: hashA,
    duration_plan_hash: hashB,
    render_policy_id: RENDER_POLICY_V1.policy_id,
    render_policy_version: RENDER_POLICY_V1.policy_version,
    render_policy_hash: RENDER_POLICY_V1.policy_hash,
    fallback_state: 'NONE',
    subtitle_mode: 'OFF',
    source_audio_mode: 'DROP',
    video_operations: [
      {
        operation: 'VIDEO_SEGMENT',
        order_index: 0,
        segment_id: 'segment_1',
        frame_start: 0,
        frame_end: 30,
        timeline_start_ms: 0,
        timeline_end_ms: 1000,
        asset_id: 'asset_1',
        revision: 1,
        shot_id: 'shot_1',
        verified_file_sha256: hashA,
        source_start_ms: 117,
        source_end_ms: 1117,
        selection_request_id: 'selection_1',
        decision_receipt_hash: hashB,
        selection_slot_id: 'slot_1',
      },
    ],
    narration_operation: {
      operation: 'NARRATION',
      narration_audio_id: 'narration_1',
      artifact_id: 'narration_artifact_1',
      artifact_sha256: hashC,
      duration_ms: 1000,
      duration_measurement: 'SAMPLE_COUNT_DERIVED',
      sample_count: 48000,
      codec: 'pcm_s16le',
      container: 'wav',
      sample_rate_hz: 48000,
      channels: 2,
      channel_layout: 'stereo',
      size_bytes: 1024,
    },
    total_timeline_duration_ms: 1000,
    total_output_frames: 30,
  };
  return { ...preimage, logical_render_hash: computeLogicalRenderHashV1(preimage) };
}

function executionSnapshot(plan: LogicalRenderPlanV1): RenderExecutionSnapshotV1 {
  return buildExecutionSnapshotV1({
    logical_render_hash: plan.logical_render_hash,
    platform: 'win32',
    architecture: 'x64',
    staging_root: 'D:\\staging\\job',
    output_root: 'D:\\output',
    source_artifacts: [
      {
        authority_sha256: hashA,
        source_path: 'C:\\source.mp4',
        staged_path: 'D:\\staging\\job\\source.mp4',
        staged_sha256: hashA,
        size_bytes: 2048,
        segment_ids: ['segment_1'],
      },
    ],
    narration_artifact: {
      authority_sha256: hashC,
      source_path: 'C:\\narration.wav',
      staged_path: 'D:\\staging\\job\\narration.wav',
      staged_sha256: hashC,
      size_bytes: 1024,
    },
    runtime_identity: {
      schema_version: '1.0',
      runtime_id: 'approved_runtime',
      platform: 'win32',
      architecture: 'x64',
      ffmpeg_executable_path: 'D:\\runtime\\ffmpeg.exe',
      ffmpeg_entrypoint_sha256: CODE_G_R1B_APPROVED_FFMPEG_SHA256,
      ffprobe_executable_path: 'D:\\runtime\\ffprobe.exe',
      ffprobe_entrypoint_sha256: CODE_G_R1B_APPROVED_FFPROBE_SHA256,
      companion_manifest_sha256: hashA,
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
      capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
      runtime_member_hashes: [{ relative_path: 'manifest.json', sha256: hashA }],
      approval_status: 'APPROVED',
    },
  });
}

function validProbe(): string {
  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        profile: 'High',
        level: 41,
        width: 1080,
        height: 1920,
        pix_fmt: 'yuv420p',
        r_frame_rate: '30/1',
        avg_frame_rate: '30/1',
        nb_read_frames: '30',
      },
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
        channel_layout: 'stereo',
      },
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '1.000000',
      size: '512',
    },
  });
}

class FakeFiles implements RenderExecutionFilePortV1 {
  reverifyCalls = 0;
  removals: string[] = [];
  failReverify = false;

  async reverifyPreparedSnapshot(): Promise<void> {
    this.reverifyCalls += 1;
    if (this.failReverify) throw new Error('RENDER_STAGED_INPUT_HASH_MISMATCH');
  }

  async createAttemptPaths(): Promise<RenderAttemptPathsV1> {
    return {
      partial_output_path: 'D:\\output\\job\\attempts\\1\\output.partial.mp4',
      final_output_path: 'D:\\output\\job\\artifacts\\output.mp4',
      managed_relative_path: 'job/artifacts/output.mp4',
    };
  }

  async assertStableFile(): Promise<{ sha256: string; size_bytes: number }> {
    return { sha256: outputHash, size_bytes: 512 };
  }

  async promoteAtomic(): Promise<'ATOMIC_SAME_VOLUME_RENAME'> {
    return 'ATOMIC_SAME_VOLUME_RENAME';
  }

  async removePartial(path: string): Promise<void> {
    this.removals.push(path);
  }

  async verifyExistingOutput(
    _path: string,
    expectedHash: string,
    expectedSize: number,
  ): Promise<void> {
    if (expectedHash !== outputHash || expectedSize !== 512) {
      throw new Error('RENDER_EXISTING_SUCCESS_OUTPUT_INVALID');
    }
  }
}

class FakeProcesses implements RenderProcessAdapterV1 {
  requests: RenderProcessRequestV1[] = [];
  ffmpegResult: RenderProcessResultV1 = {
    exit_code: 0,
    signal: null,
    stdout: 'frame=30\nprogress=end\n',
    stderr: '',
    logs_truncated: false,
    progress_end_observed: true,
    termination_reason: null,
  };
  ffprobeJson = validProbe();

  async run(request: RenderProcessRequestV1): Promise<RenderProcessResultV1> {
    this.requests.push(request);
    if (request.kind === 'FFMPEG') {
      request.on_progress?.({ frame: 30, out_time_ms: 1_000_000, progress: 'end' });
      return this.ffmpegResult;
    }
    return {
      exit_code: 0,
      signal: null,
      stdout: this.ffprobeJson,
      stderr: '',
      logs_truncated: false,
      progress_end_observed: false,
      termination_reason: null,
    };
  }

  async cancel(): Promise<boolean> {
    return true;
  }
}

async function setup() {
  const fixture = new E6TimelineFixture();
  await fixture.open();
  const policies = new RenderPolicyRepository(fixture.database, {
    clock: () => '2026-09-12T00:00:00.000Z',
  });
  policies.register(RENDER_POLICY_V1);
  const preparations = new RenderPreparationRepository(fixture.database, {
    clock: () => '2026-09-12T00:00:00.000Z',
    id: () => 'prepared',
  });
  const plan = logicalPlan();
  const snapshot = executionSnapshot(plan);
  let job = preparations.begin({
    schema_version: '1.0',
    timeline_id: plan.timeline_id,
    timeline_version: plan.timeline_version,
    expected_timeline_commit_receipt_hash: plan.timeline_commit_receipt_hash,
    render_policy_id: plan.render_policy_id,
    render_policy_version: plan.render_policy_version,
    render_policy_hash: plan.render_policy_hash,
  });
  job = preparations.markEntryValidated(job.job_id);
  job = preparations.recordLogicalPlan(job.job_id, plan);
  job = preparations.markStaging(job.job_id);
  job = preparations.recordReady({
    job_id: job.job_id,
    snapshot,
    artifacts: [
      {
        artifact_record_id: `${job.job_id}:source`,
        artifact_role: 'STAGED_SOURCE',
        authority_sha256: hashA,
        artifact_sha256: hashA,
        size_bytes: 2048,
        managed_path: snapshot.source_artifacts[0]!.staged_path,
        artifact_json: canonicalJson(snapshot.source_artifacts[0]!),
      },
      {
        artifact_record_id: `${job.job_id}:narration`,
        artifact_role: 'STAGED_NARRATION',
        authority_sha256: hashC,
        artifact_sha256: hashC,
        size_bytes: 1024,
        managed_path: snapshot.narration_artifact.staged_path,
        artifact_json: canonicalJson(snapshot.narration_artifact),
      },
    ],
  });
  const executions = new RenderExecutionRepository(fixture.database, {
    clock: () => '2026-09-12T00:00:00.000Z',
    id: (() => {
      let value = 0;
      return () => `execution_${++value}`;
    })(),
  });
  const files = new FakeFiles();
  const processes = new FakeProcesses();
  const service = new RenderExecutionServiceV1({
    preparations,
    policies,
    executions,
    files,
    processes,
    clock: () => '2026-09-12T00:00:00.000Z',
    id: (() => {
      let value = 0;
      return () => `service_${++value}`;
    })(),
  });
  return { fixture, job, plan, snapshot, preparations, executions, files, processes, service };
}

describe('Code G R1B READY_FOR_EXECUTION service integration', () => {
  it('executes, verifies, atomically promotes, persists VERIFIED_OUTPUT and commits receipt', async () => {
    const context = await setup();
    try {
      const result = await context.service.executePreparedRender(context.job.job_id);
      expect(result.recovered_existing_success).toBe(false);
      expect(result.output_sha256).toBe(outputHash);
      expect(result.receipt.terminal_state).toBe('SUCCEEDED');
      expect(result.receipt.verification_facts?.frame_count).toBe(30);
      expect(context.files.reverifyCalls).toBe(1);
      expect(context.processes.requests).toHaveLength(2);
      expect(context.processes.requests.every((request) => request.shell === false)).toBe(true);
      expect(
        context.fixture.database
          .prepare('SELECT state FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe('SUCCEEDED');
      expect(
        context.fixture.database
          .prepare("SELECT state FROM render_artifacts WHERE artifact_role = 'OUTPUT'")
          .pluck()
          .get(),
      ).toBe('VERIFIED_OUTPUT');
      expect(context.fixture.database.prepare('SELECT state FROM jobs').pluck().get()).toBe(
        'SUCCEEDED',
      );
      expect(
        context.fixture.database.prepare('SELECT count(*) FROM render_receipts').pluck().get(),
      ).toBe(1);
    } finally {
      context.fixture.close();
    }
  });

  it('recovers an existing hash-valid success without re-rendering', async () => {
    const context = await setup();
    try {
      const first = await context.service.executePreparedRender(context.job.job_id);
      const second = await context.service.executePreparedRender(context.job.job_id);
      expect(second.recovered_existing_success).toBe(true);
      expect(second.execution_attempt_id).toBe(first.execution_attempt_id);
      expect(context.processes.requests).toHaveLength(2);
      expect(
        context.fixture.database
          .prepare('SELECT count(*) FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe(1);
    } finally {
      context.fixture.close();
    }
  });

  it('fails before spawn and records a terminal attempt when staged bytes changed after READY', async () => {
    const context = await setup();
    try {
      context.files.failReverify = true;
      await expect(context.service.executePreparedRender(context.job.job_id)).rejects.toThrowError(
        'RENDER_STAGED_INPUT_HASH_MISMATCH',
      );
      expect(
        context.fixture.database
          .prepare('SELECT count(*) FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe(1);
      expect(
        context.fixture.database
          .prepare('SELECT state FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe('FAILED');
      expect(context.processes.requests).toHaveLength(0);
    } finally {
      context.fixture.close();
    }
  });

  it('prevents a concurrent second execution reservation', async () => {
    const context = await setup();
    try {
      context.executions.reserve({
        job_id: context.job.job_id,
        execution_snapshot_hash: context.snapshot.execution_snapshot_hash,
        partial_output_path: 'D:\\output\\one.partial.mp4',
        final_output_path: 'D:\\output\\one.mp4',
      });
      await expect(context.service.executePreparedRender(context.job.job_id)).rejects.toThrowError(
        'RENDER_EXECUTION_ALREADY_ACTIVE',
      );
    } finally {
      context.fixture.close();
    }
  });

  it('persists a fail-closed receipt for FFmpeg nonzero exit', async () => {
    const context = await setup();
    try {
      context.processes.ffmpegResult = {
        ...context.processes.ffmpegResult,
        exit_code: 1,
        progress_end_observed: false,
      };
      await expect(context.service.executePreparedRender(context.job.job_id)).rejects.toThrowError(
        'FFMPEG_NONZERO_EXIT',
      );
      const receipt = JSON.parse(
        context.fixture.database
          .prepare('SELECT receipt_json FROM render_receipts')
          .pluck()
          .get() as string,
      ) as { terminal_state: string; output_artifact: unknown; error_id: string };
      expect(receipt).toEqual(
        expect.objectContaining({
          terminal_state: 'FAILED',
          output_artifact: null,
          error_id: 'FFMPEG_NONZERO_EXIT',
        }),
      );
    } finally {
      context.fixture.close();
    }
  });

  it('persists CANCELLED and never verifies or promotes partial output', async () => {
    const context = await setup();
    try {
      context.processes.ffmpegResult = {
        exit_code: null,
        signal: null,
        stdout: '',
        stderr: '',
        logs_truncated: false,
        progress_end_observed: false,
        termination_reason: 'CANCELLED',
      };
      await expect(context.service.executePreparedRender(context.job.job_id)).rejects.toThrowError(
        'FFMPEG_CANCELLED',
      );
      expect(
        context.fixture.database
          .prepare('SELECT state FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe('CANCELLED');
      expect(
        context.fixture.database
          .prepare("SELECT count(*) FROM render_artifacts WHERE artifact_role = 'OUTPUT'")
          .pluck()
          .get(),
      ).toBe(0);
      expect(context.files.removals).toContain('D:\\output\\job\\attempts\\1\\output.partial.mp4');
    } finally {
      context.fixture.close();
    }
  });

  it('treats FFprobe nonzero exit as FAILED and persists no output artifact', async () => {
    const context = await setup();
    try {
      const originalRun = context.processes.run.bind(context.processes);
      context.processes.run = async (request: RenderProcessRequestV1) => {
        const result = await originalRun(request);
        return request.kind === 'FFPROBE' ? { ...result, exit_code: 2 } : result;
      };
      await expect(context.service.executePreparedRender(context.job.job_id)).rejects.toThrowError(
        'FFPROBE_NONZERO_EXIT',
      );
      expect(
        context.fixture.database
          .prepare("SELECT count(*) FROM render_artifacts WHERE artifact_role = 'OUTPUT'")
          .pluck()
          .get(),
      ).toBe(0);
      expect(
        context.fixture.database
          .prepare('SELECT state FROM render_execution_attempts')
          .pluck()
          .get(),
      ).toBe('FAILED');
    } finally {
      context.fixture.close();
    }
  });

  it('recovers nonterminal attempts as INTERRUPTED without inferring success', async () => {
    const context = await setup();
    try {
      const attempt = context.executions.reserve({
        job_id: context.job.job_id,
        execution_snapshot_hash: context.snapshot.execution_snapshot_hash,
        partial_output_path: 'D:\\output\\job\\attempts\\old\\output.partial.mp4',
        final_output_path: 'D:\\output\\job\\artifacts\\output.mp4',
      });
      if ('receipt' in attempt) throw new Error('unexpected success');
      context.executions.markRunning(attempt.execution_attempt_id);
      const recovered = await context.service.recoverInterruptedExecutions();
      expect(recovered).toHaveLength(1);
      expect(recovered[0]!.state).toBe('INTERRUPTED');
      const receipt = JSON.parse(
        context.fixture.database
          .prepare('SELECT receipt_json FROM render_receipts')
          .pluck()
          .get() as string,
      ) as { terminal_state: string; output_artifact: unknown; error_id: string };
      expect(receipt).toEqual(
        expect.objectContaining({
          terminal_state: 'INTERRUPTED',
          output_artifact: null,
          error_id: 'APP_INTERRUPTED',
        }),
      );
    } finally {
      context.fixture.close();
    }
  });
});
