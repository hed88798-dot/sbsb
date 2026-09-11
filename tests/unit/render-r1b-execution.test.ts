import { describe, expect, it } from 'vitest';
import {
  BoundedLogBufferV1,
  CODE_G_R1B_APPROVED_FFMPEG_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  FfmpegProgressParserV1,
  RENDER_POLICY_V1,
  buildExecutionSnapshotV1,
  buildFfmpegInvocationV1,
  buildFfprobeInvocationV1,
  buildRenderReceiptV1,
  computeLogicalRenderHashV1,
  computeRenderPolicyHashV1,
  parseRenderReceiptV1,
  verifyFfprobeOutputV1,
  type LogicalRenderPlanV1,
  type RenderExecutionSnapshotV1,
  type RenderPolicyV1,
} from '../../packages/render/src/index.js';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);

function policy(mode: 'SCALE_PAD' | 'SCALE_CROP' = 'SCALE_PAD'): RenderPolicyV1 {
  if (mode === 'SCALE_PAD') return RENDER_POLICY_V1;
  const preimage: Omit<RenderPolicyV1, 'policy_hash'> = {
    ...RENDER_POLICY_V1,
    visual_fit: {
      ...RENDER_POLICY_V1.visual_fit,
      mode,
      crop: 'POLICY_CENTER_CROP_ONLY',
    },
  };
  return { ...preimage, policy_hash: computeRenderPolicyHashV1(preimage) };
}

function plan(renderPolicy = policy()): LogicalRenderPlanV1 {
  const preimage: Omit<LogicalRenderPlanV1, 'logical_render_hash'> = {
    schema_version: '1.0',
    timeline_id: 'timeline_historical_1',
    timeline_version: 3,
    timeline_commit_receipt_hash: hashA,
    duration_plan_hash: hashB,
    render_policy_id: renderPolicy.policy_id,
    render_policy_version: renderPolicy.policy_version,
    render_policy_hash: renderPolicy.policy_hash,
    fallback_state: 'NONE',
    subtitle_mode: 'OFF',
    source_audio_mode: 'DROP',
    video_operations: [
      {
        operation: 'VIDEO_SEGMENT',
        order_index: 0,
        segment_id: 'segment_1',
        frame_start: 0,
        frame_end: 10,
        timeline_start_ms: 0,
        timeline_end_ms: 333,
        asset_id: 'asset_1',
        revision: 1,
        shot_id: 'shot_1',
        verified_file_sha256: hashA,
        source_start_ms: 117,
        source_end_ms: 450,
        selection_request_id: 'selection_1',
        decision_receipt_hash: hashB,
        selection_slot_id: 'slot_1',
      },
      {
        operation: 'VIDEO_SEGMENT',
        order_index: 1,
        segment_id: 'segment_2',
        frame_start: 10,
        frame_end: 30,
        timeline_start_ms: 333,
        timeline_end_ms: 1000,
        asset_id: 'asset_2',
        revision: 2,
        shot_id: 'shot_2',
        verified_file_sha256: hashB,
        source_start_ms: 1001,
        source_end_ms: 1668,
        selection_request_id: 'selection_2',
        decision_receipt_hash: hashC,
        selection_slot_id: 'slot_2',
      },
    ],
    narration_operation: {
      operation: 'NARRATION',
      narration_audio_id: 'narration_1',
      artifact_id: 'audio_artifact_1',
      artifact_sha256: hashC,
      duration_ms: 1000,
      duration_measurement: 'SAMPLE_COUNT_DERIVED',
      sample_count: 48000,
      codec: 'pcm_s16le',
      container: 'wav',
      sample_rate_hz: 48000,
      channels: 2,
      channel_layout: 'stereo',
      size_bytes: 4096,
    },
    total_timeline_duration_ms: 1000,
    total_output_frames: 30,
  };
  return { ...preimage, logical_render_hash: computeLogicalRenderHashV1(preimage) };
}

function snapshot(logicalPlan = plan()): RenderExecutionSnapshotV1 {
  return buildExecutionSnapshotV1({
    logical_render_hash: logicalPlan.logical_render_hash,
    platform: 'win32',
    architecture: 'x64',
    staging_root: 'D:\\controlled stage',
    output_root: 'D:\\controlled output',
    source_artifacts: [
      {
        authority_sha256: hashA,
        source_path: 'C:\\authority\\clip one.mp4',
        staged_path: 'D:\\controlled stage\\clip one & (first);$你好.mp4',
        staged_sha256: hashA,
        size_bytes: 100,
        segment_ids: ['segment_1'],
      },
      {
        authority_sha256: hashB,
        source_path: 'C:\\authority\\clip two.mp4',
        staged_path: 'D:\\controlled stage\\clip "two".mp4',
        staged_sha256: hashB,
        size_bytes: 200,
        segment_ids: ['segment_2'],
      },
    ],
    narration_artifact: {
      authority_sha256: hashC,
      source_path: 'C:\\authority\\narration.wav',
      staged_path: 'D:\\controlled stage\\narration $ final.wav',
      staged_sha256: hashC,
      size_bytes: 4096,
    },
    runtime_identity: {
      schema_version: '1.0',
      runtime_id: 'code-f-approved-windows-runtime',
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

function probe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
        duration: '1.000000',
      },
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
        channel_layout: 'stereo',
        duration: '1.000000',
      },
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '1.000000',
      size: '512',
    },
    ...overrides,
  };
}

describe('Code G R1B pure invocation planning', () => {
  it('builds a shell-free absolute invocation from staged paths only', () => {
    const logicalPlan = plan();
    const execution = snapshot(logicalPlan);
    const invocation = buildFfmpegInvocationV1({
      plan: logicalPlan,
      snapshot: execution,
      policy: policy(),
      partial_output_path: 'D:\\controlled output\\output.partial.mp4',
    });
    expect(invocation.shell).toBe(false);
    expect(invocation.executable).toBe('D:\\runtime\\ffmpeg.exe');
    expect(invocation.arguments).toContain('D:\\controlled stage\\clip one & (first);$你好.mp4');
    expect(invocation.arguments).toContain('D:\\controlled stage\\clip "two".mp4');
    expect(invocation.arguments).not.toContain('C:\\authority\\clip one.mp4');
    expect(invocation.arguments).not.toContain('-shortest');
    expect(invocation.arguments).not.toContain('-t');
    expect(invocation.arguments.filter((argument) => argument === 'file,pipe')).toHaveLength(3);
    expect(invocation.arguments).toContain('h264_mf');
    expect(invocation.arguments).not.toContain('libx264');
  });

  it('uses filter-level non-keyframe trim and exact per-segment frame counts', () => {
    const logicalPlan = plan();
    const invocation = buildFfmpegInvocationV1({
      plan: logicalPlan,
      snapshot: snapshot(logicalPlan),
      policy: policy(),
      partial_output_path: 'D:\\controlled output\\output.partial.mp4',
    });
    const graph = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('setpts=PTS-STARTPTS,trim=start=0.117:end=0.450');
    expect(graph).toContain('trim=start=0.117:end=0.450');
    expect(graph).toContain('trim=start_frame=0:end_frame=10');
    expect(graph).toContain('trim=start=1.001:end=1.668');
    expect(graph).toContain('trim=start_frame=0:end_frame=20');
    expect(graph).toContain('[vseg0][vseg1]concat=n=2:v=1:a=0[vout]');
    expect(invocation.expected_total_output_frames).toBe(30);
  });

  it('preserves the first frame and accepts an exact one-frame final segment', () => {
    const base = plan();
    const { logical_render_hash: previousHash, ...basePreimage } = base;
    expect(previousHash).toMatch(/^[a-f0-9]{64}$/u);
    const preimage: Omit<LogicalRenderPlanV1, 'logical_render_hash'> = {
      ...basePreimage,
      video_operations: [
        {
          ...base.video_operations[0]!,
          frame_start: 0,
          frame_end: 1,
          timeline_end_ms: 33,
          source_end_ms: 150,
        },
      ],
      total_timeline_duration_ms: 33,
      total_output_frames: 1,
    };
    const oneFramePlan = {
      ...preimage,
      logical_render_hash: computeLogicalRenderHashV1(preimage),
    };
    const invocation = buildFfmpegInvocationV1({
      plan: oneFramePlan,
      snapshot: snapshot(oneFramePlan),
      policy: policy(),
      partial_output_path: 'D:\\controlled output\\one-frame.partial.mp4',
    });
    const graph = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('trim=start_frame=0:end_frame=1');
    expect(invocation.expected_total_output_frames).toBe(1);
  });

  it('binds rotation, CFR, SAR, narration-only audio, and policy-owned encoding facts', () => {
    const logicalPlan = plan();
    const invocation = buildFfmpegInvocationV1({
      plan: logicalPlan,
      snapshot: snapshot(logicalPlan),
      policy: policy(),
      partial_output_path: 'D:\\controlled output\\output.partial.mp4',
    });
    expect(invocation.arguments.filter((value) => value === '-autorotate')).toHaveLength(2);
    const graph = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('fps=fps=30/1:round=near');
    expect(graph).toContain('setsar=ratio=1/1');
    expect(graph).toContain('[2:a:0]aresample=48000');
    expect(graph).not.toMatch(/\[[01]:a/u);
    expect(invocation.arguments).toEqual(expect.arrayContaining(['-g', '60', '-bf', '0']));
    expect(invocation.arguments).toEqual(expect.arrayContaining(['-map_metadata', '-1']));
    expect(invocation.arguments).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
  });

  it('supports only the policy-declared center crop transform', () => {
    const cropPolicy = policy('SCALE_CROP');
    const logicalPlan = plan(cropPolicy);
    const invocation = buildFfmpegInvocationV1({
      plan: logicalPlan,
      snapshot: snapshot(logicalPlan),
      policy: cropPolicy,
      partial_output_path: 'D:\\controlled output\\output.partial.mp4',
    });
    const graph = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('force_original_aspect_ratio=increase');
    expect(graph).toContain('crop=w=1080:h=1920:x=(iw-ow)/2:y=(ih-oh)/2');
  });

  it('builds an exact approved ffprobe JSON/frame-count invocation', () => {
    const invocation = buildFfprobeInvocationV1({
      snapshot: snapshot(),
      output_path: 'D:\\controlled output\\output.partial.mp4',
    });
    expect(invocation.shell).toBe(false);
    expect(invocation.arguments).toContain('-count_frames');
    expect(invocation.arguments).toContain('json');
  });

  it('rejects network output and PATH-based executable lookup', () => {
    expect(() =>
      buildFfmpegInvocationV1({
        plan: plan(),
        snapshot: snapshot(),
        policy: policy(),
        partial_output_path: 'https://example.invalid/output.mp4',
      }),
    ).toThrowError('RENDER_OUTPUT_PATH_INVALID');
    const current = snapshot();
    const relativeRuntime = buildExecutionSnapshotV1({
      logical_render_hash: current.logical_render_hash,
      platform: current.platform,
      architecture: current.architecture,
      staging_root: current.staging_root,
      output_root: current.output_root,
      source_artifacts: current.source_artifacts,
      narration_artifact: current.narration_artifact,
      runtime_identity: {
        ...current.runtime_identity,
        ffmpeg_executable_path: 'ffmpeg.exe',
      },
    });
    expect(() =>
      buildFfmpegInvocationV1({
        plan: plan(),
        snapshot: relativeRuntime,
        policy: policy(),
        partial_output_path: 'D:\\controlled output\\output.partial.mp4',
      }),
    ).toThrowError('RENDER_FFMPEG_PATH_INVALID');
  });
});

describe('Code G R1B progress, log, and output verification', () => {
  it('requires a structural progress=end terminal record', () => {
    const parser = new FfmpegProgressParserV1();
    expect(parser.push('frame=12\nout_time_ms=400000\nprogress=continue\n')).toEqual([
      { frame: 12, out_time_ms: 400000, progress: 'continue' },
    ]);
    expect(parser.push('frame=30\nout_time_ms=1000000\nprogress=end\n')).toEqual([
      { frame: 30, out_time_ms: 1000000, progress: 'end' },
    ]);
    expect(() => parser.finish()).not.toThrow();
    expect(() => new FfmpegProgressParserV1().finish()).toThrowError('FFMPEG_PROGRESS_END_MISSING');
  });

  it('bounds captured logs without changing process semantics', () => {
    const logs = new BoundedLogBufferV1(5);
    logs.append('1234');
    logs.append('56789');
    expect(logs.text).toBe('12345');
    expect(logs.truncated).toBe(true);
  });

  it('accepts only exact frame-count, stream, codec, and container facts', () => {
    expect(
      verifyFfprobeOutputV1({
        probe_json: probe(),
        plan: plan(),
        policy: policy(),
        observed_size_bytes: 512,
        progress_end_observed: true,
      }),
    ).toEqual(
      expect.objectContaining({
        frame_count: 30,
        width: 1080,
        height: 1920,
        sample_rate_hz: 48000,
        channels: 2,
        subtitle_streams: 0,
      }),
    );
  });

  it('rejects an off-by-one frame count with no hidden tolerance', () => {
    const bad = probe();
    (bad.streams as Array<Record<string, unknown>>)[0]!.nb_read_frames = '29';
    expect(() =>
      verifyFfprobeOutputV1({
        probe_json: bad,
        plan: plan(),
        policy: policy(),
        observed_size_bytes: 512,
        progress_end_observed: true,
      }),
    ).toThrowError('RENDER_OUTPUT_FRAME_COUNT_MISMATCH');
  });

  it.each([
    [
      'wrong video codec',
      'RENDER_OUTPUT_VIDEO_CODEC_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[0]!.codec_name = 'hevc';
      },
    ],
    [
      'source/extra audio',
      'RENDER_OUTPUT_AUDIO_STREAM_COUNT_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as unknown[]).push({ codec_type: 'audio', codec_name: 'aac' });
      },
    ],
    [
      'subtitle',
      'RENDER_OUTPUT_SUBTITLE_STREAM_FORBIDDEN',
      (value: Record<string, unknown>) => {
        (value.streams as unknown[]).push({ codec_type: 'subtitle', codec_name: 'mov_text' });
      },
    ],
    [
      'wrong sample rate',
      'RENDER_OUTPUT_SAMPLE_RATE_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[1]!.sample_rate = '44100';
      },
    ],
    [
      'wrong resolution',
      'RENDER_OUTPUT_CANVAS_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[0]!.width = 720;
      },
    ],
    [
      'wrong fps',
      'RENDER_OUTPUT_FPS_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[0]!.avg_frame_rate = '30000/1001';
      },
    ],
    [
      'wrong pixel format',
      'RENDER_OUTPUT_PIXEL_FORMAT_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[0]!.pix_fmt = 'nv12';
      },
    ],
    [
      'wrong audio codec',
      'RENDER_OUTPUT_AUDIO_CODEC_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[1]!.codec_name = 'mp3';
      },
    ],
    [
      'wrong channel count',
      'RENDER_OUTPUT_CHANNELS_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[1]!.channels = 1;
      },
    ],
    [
      'unexpected data stream',
      'RENDER_OUTPUT_UNEXPECTED_STREAM',
      (value: Record<string, unknown>) => {
        (value.streams as unknown[]).push({ codec_type: 'data', codec_name: 'bin_data' });
      },
    ],
    [
      'duration outside policy',
      'RENDER_OUTPUT_DURATION_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.format as Record<string, unknown>).duration = '1.100000';
      },
    ],
    [
      'wrong profile',
      'RENDER_OUTPUT_PROFILE_MISMATCH',
      (value: Record<string, unknown>) => {
        (value.streams as Array<Record<string, unknown>>)[0]!.profile = 'Main';
      },
    ],
  ])('rejects %s', (_name, expected, mutate) => {
    const value = probe();
    mutate(value);
    expect(() =>
      verifyFfprobeOutputV1({
        probe_json: value,
        plan: plan(),
        policy: policy(),
        observed_size_bytes: 512,
        progress_end_observed: true,
      }),
    ).toThrowError(expected);
  });

  it('rejects output verification when progress=end was not observed', () => {
    expect(() =>
      verifyFfprobeOutputV1({
        probe_json: probe(),
        plan: plan(),
        policy: policy(),
        observed_size_bytes: 512,
        progress_end_observed: false,
      }),
    ).toThrowError('FFMPEG_PROGRESS_END_MISSING');
  });

  it('builds a canonical immutable success receipt bound to the snapshot', () => {
    const logicalPlan = plan();
    const execution = snapshot(logicalPlan);
    const receipt = buildRenderReceiptV1({
      receipt_id: 'receipt_1',
      job_id: 'job_1',
      plan: logicalPlan,
      snapshot: execution,
      terminal_state: 'SUCCEEDED',
      output_artifact: {
        artifact_id: 'output_1',
        output_sha256: hashA,
        size_bytes: 512,
        managed_relative_path: 'job_1/artifacts/output.mp4',
      },
      verification_facts: verifyFfprobeOutputV1({
        probe_json: probe(),
        plan: logicalPlan,
        policy: policy(),
        observed_size_bytes: 512,
        progress_end_observed: true,
      }),
      error_id: null,
      created_at: '2026-09-12T00:00:00.000Z',
    });
    expect(parseRenderReceiptV1(receipt)).toEqual(receipt);
    expect(() => parseRenderReceiptV1({ ...receipt, terminal_state: 'FAILED' })).toThrow();
  });
});
