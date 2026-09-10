import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  RENDER_POLICY_V1,
  assertNarrationMatchesTimelineV1,
  buildExecutionSnapshotV1,
  buildLogicalRenderPlanV1,
  computeNarrationAudioArtifactHashV1,
  computeRenderReceiptHashV1,
  computeRenderPolicyHashV1,
  mapTimelineIntervalsToFramesV1,
  parseFfmpegRequiredCapabilityProfileV1,
  parseRenderReceiptV1,
  parseRenderPolicyV1,
  renderAcceptedTimelineRequestV1Schema,
  timelineMsToFrameBoundaryV1,
  validateRenderEntryV1,
  type NarrationAudioArtifactV1,
  type NarrationAudioExecutionRefV1,
  type RenderAcceptedTimelineRequestV1,
  type RenderCommittedTimelineV1,
  type RenderRuntimeIdentityV1,
  type RenderReceiptV1,
  type ResolvedRenderSourceV1,
  type VerifiedCodeDDecisionV1,
} from '../../packages/render/src/index.js';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const hashD = 'd'.repeat(64);

function request(): RenderAcceptedTimelineRequestV1 {
  return {
    schema_version: '1.0',
    timeline_id: 'timeline_1',
    timeline_version: 1,
    expected_timeline_commit_receipt_hash: hashA,
    render_policy_id: RENDER_POLICY_V1.policy_id,
    render_policy_version: RENDER_POLICY_V1.policy_version,
    render_policy_hash: RENDER_POLICY_V1.policy_hash,
  };
}

function timeline(): RenderCommittedTimelineV1 {
  return {
    timeline_id: 'timeline_1',
    version: 1,
    planning_request: {
      committed_selection_refs: [
        {
          selection_request_id: 'selection_1',
          decision_receipt_hash: hashB,
          asset_id: 'asset_1',
          shot_id: 'shot_1',
        },
      ],
    } as RenderCommittedTimelineV1['planning_request'],
    planning_facts: {
      slots: [
        {
          selected_materials: [
            {
              selection_request_id: 'selection_1',
              decision_receipt_hash: hashB,
              batch_id: 'batch_1',
              video_id: 'video_1',
              slot_id: 'slot_1',
              asset_id: 'asset_1',
              shot_id: 'shot_1',
              revision: 3,
              shot_start_ms: 100,
              shot_end_ms: 2100,
              available_duration_ms: 2000,
              duration_delta_ms: 1000,
              duration_state: 'MATERIAL_AVAILABLE',
            },
          ],
        },
      ],
    } as RenderCommittedTimelineV1['planning_facts'],
    duration_plan: {
      duration_plan_hash: hashC,
      segments: [
        {
          segment_id: 'segment_1',
          source_asset_id: 'asset_1',
          source_revision: 3,
          source_shot_id: 'shot_1',
          source_start_ms: 100,
          source_end_ms: 1100,
          timeline_start_ms: 0,
          timeline_end_ms: 1000,
          selection_request_id: 'selection_1',
          decision_receipt_hash: hashB,
          selection_slot_id: 'slot_1',
        },
      ],
      additional_selection_requirements: [],
      fallback_requirements: [],
    } as RenderCommittedTimelineV1['duration_plan'],
    commit_receipt: {
      timeline_id: 'timeline_1',
      version: 1,
      duration_plan_hash: hashC,
      commit_receipt_hash: hashA,
    },
  };
}

function decision(): VerifiedCodeDDecisionV1 {
  return {
    selection_request_id: 'selection_1',
    decision_receipt_hash: hashB,
    slot_id: 'slot_1',
    status: 'SELECTED',
    asset_id: 'asset_1',
    shot_id: 'shot_1',
    revision: 3,
    shot_start_ms: 100,
    shot_end_ms: 2100,
  };
}

function source(path: string): ResolvedRenderSourceV1 {
  return {
    schema_version: '1.0',
    segment_id: 'segment_1',
    asset_id: 'asset_1',
    revision: 3,
    shot_id: 'shot_1',
    shot_start_ms: 100,
    shot_end_ms: 2100,
    source_start_ms: 100,
    source_end_ms: 1100,
    timeline_start_ms: 0,
    timeline_end_ms: 1000,
    selection_request_id: 'selection_1',
    decision_receipt_hash: hashB,
    selection_slot_id: 'slot_1',
    resolved_source_path: path,
    verified_file_sha256: hashC,
  };
}

function narration(path: string): NarrationAudioExecutionRefV1 {
  return {
    schema_version: '1.0',
    narration_audio_id: 'audio_1',
    artifact_id: 'artifact_1',
    artifact_sha256: hashD,
    duration_ms: 1000,
    duration_measurement: 'SAMPLE_COUNT_DERIVED',
    sample_count: 48000,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: 100,
    producer_ref: null,
    provenance_ref: null,
    resolved_source_path: path,
    verified_file_sha256: hashD,
    resolved_at: '2026-09-11T00:00:00.000Z',
  };
}

function runtime(platform: 'darwin' | 'win32', executableRoot: string): RenderRuntimeIdentityV1 {
  return {
    schema_version: '1.0',
    runtime_id: `runtime_${platform}`,
    platform,
    architecture: platform === 'darwin' ? 'arm64' : 'x64',
    ffmpeg_executable_path: `${executableRoot}/ffmpeg`,
    ffmpeg_entrypoint_sha256: hashA,
    ffprobe_executable_path: `${executableRoot}/ffprobe`,
    ffprobe_entrypoint_sha256: hashB,
    companion_manifest_sha256: hashC,
    capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
    capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
    capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
    runtime_member_hashes: [{ relative_path: 'ffmpeg', sha256: hashA }],
    approval_status: 'MOCK_R1A_TEST_ONLY',
  };
}

describe('Code G RenderPolicy and frame mapping foundation', () => {
  it('accepts only an exact pinned Render request surface', () => {
    expect(renderAcceptedTimelineRequestV1Schema.parse(request())).toEqual(request());
    expect(() =>
      renderAcceptedTimelineRequestV1Schema.parse({
        ...request(),
        sourcePath: '/untrusted/override.mp4',
      }),
    ).toThrow();
  });

  it('strictly parses and self-hashes RenderPolicyV1', () => {
    expect(parseRenderPolicyV1(RENDER_POLICY_V1)).toEqual(RENDER_POLICY_V1);
    expect(() => parseRenderPolicyV1({ ...RENDER_POLICY_V1, unknown: true })).toThrow();
    expect(() =>
      parseRenderPolicyV1({
        ...RENDER_POLICY_V1,
        canvas: { ...RENDER_POLICY_V1.canvas, width: 720 },
      }),
    ).toThrowError('RENDER_POLICY_HASH_MISMATCH');
    expect(computeRenderPolicyHashV1(RENDER_POLICY_V1)).toBe(RENDER_POLICY_V1.policy_hash);
    expect(RENDER_POLICY_V1.audio.source_video_audio).toBe('DROP');
    expect(RENDER_POLICY_V1.subtitle.mode).toBe('OFF');
  });

  it('maps shared absolute millisecond boundaries once without cumulative gaps', () => {
    expect(timelineMsToFrameBoundaryV1(500, RENDER_POLICY_V1.timebase)).toBe(15);
    expect(timelineMsToFrameBoundaryV1(1000, RENDER_POLICY_V1.timebase)).toBe(30);
    expect(
      mapTimelineIntervalsToFramesV1(
        [
          { timeline_start_ms: 0, timeline_end_ms: 333 },
          { timeline_start_ms: 333, timeline_end_ms: 667 },
          { timeline_start_ms: 667, timeline_end_ms: 1000 },
        ],
        RENDER_POLICY_V1,
      ).map((interval) => [interval.frame_start, interval.frame_end]),
    ).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(() =>
      mapTimelineIntervalsToFramesV1(
        [{ timeline_start_ms: 0, timeline_end_ms: 1 }],
        RENDER_POLICY_V1,
      ),
    ).toThrowError('TIMELINE_SEGMENT_ZERO_FRAMES');
  });
});

describe('Code G structural Render entry gate', () => {
  it('binds exactly one segment material, committed reference, and verified Code D decision', () => {
    expect(
      validateRenderEntryV1({
        request: request(),
        timeline: timeline(),
        code_d_decisions: [decision()],
      }),
    ).toEqual([
      expect.objectContaining({
        segment_id: 'segment_1',
        asset_id: 'asset_1',
        revision: 3,
        shot_id: 'shot_1',
        shot_start_ms: 100,
        shot_end_ms: 2100,
      }),
    ]);
  });

  it.each([
    [
      'wrong receipt',
      (value: RenderCommittedTimelineV1) => (value.commit_receipt.commit_receipt_hash = hashD),
      'RENDER_TIMELINE_RECEIPT_MISMATCH',
    ],
    [
      'duplicate planning material',
      (value: RenderCommittedTimelineV1) =>
        value.planning_facts.slots.push(structuredClone(value.planning_facts.slots[0]!)),
      'RENDER_SEGMENT_MATERIAL_BINDING_NOT_EXACTLY_ONE',
    ],
    [
      'asset mismatch',
      (value: RenderCommittedTimelineV1) =>
        (value.duration_plan.segments[0]!.source_asset_id = 'other'),
      'RENDER_SEGMENT_ASSET_ID_MISMATCH',
    ],
    [
      'revision mismatch',
      (value: RenderCommittedTimelineV1) => (value.duration_plan.segments[0]!.source_revision = 4),
      'RENDER_SEGMENT_REVISION_MISMATCH',
    ],
    [
      'shot mismatch',
      (value: RenderCommittedTimelineV1) =>
        (value.duration_plan.segments[0]!.source_shot_id = 'other'),
      'RENDER_SEGMENT_SHOT_ID_MISMATCH',
    ],
    [
      'D receipt mismatch',
      (value: RenderCommittedTimelineV1, evidence: VerifiedCodeDDecisionV1) =>
        (evidence.decision_receipt_hash = hashD),
      'RENDER_SEGMENT_DECISION_RECEIPT_MISMATCH',
    ],
    [
      'D source identity mismatch',
      (_value: RenderCommittedTimelineV1, evidence: VerifiedCodeDDecisionV1) =>
        (evidence.revision = 4),
      'RENDER_SEGMENT_CODE_D_SOURCE_IDENTITY_MISMATCH',
    ],
    [
      'source range mismatch',
      (value: RenderCommittedTimelineV1) => (value.duration_plan.segments[0]!.source_end_ms = 2200),
      'RENDER_SEGMENT_SOURCE_RANGE_MISMATCH',
    ],
    [
      'D revision and source identity mismatch',
      (_value: RenderCommittedTimelineV1, evidence: VerifiedCodeDDecisionV1) =>
        (evidence.revision = 4),
      'RENDER_SEGMENT_CODE_D_SOURCE_IDENTITY_MISMATCH',
    ],
  ] as const)('rejects %s', (_name, mutate, expected) => {
    const value = timeline();
    const evidence = decision();
    mutate(value, evidence);
    expect(() =>
      validateRenderEntryV1({ request: request(), timeline: value, code_d_decisions: [evidence] }),
    ).toThrowError(expected);
  });

  it('rejects unresolved additional selection and fallback requirements', () => {
    const additional = timeline();
    additional.duration_plan.additional_selection_requirements.push({} as never);
    expect(() =>
      validateRenderEntryV1({
        request: request(),
        timeline: additional,
        code_d_decisions: [decision()],
      }),
    ).toThrowError('RENDER_ADDITIONAL_SELECTION_UNRESOLVED');
    const fallback = timeline();
    fallback.duration_plan.fallback_requirements.push({} as never);
    expect(() =>
      validateRenderEntryV1({
        request: request(),
        timeline: fallback,
        code_d_decisions: [decision()],
      }),
    ).toThrowError('RENDER_FALLBACK_UNRESOLVED');
  });
});

describe('Code G dual render identity', () => {
  it('excludes machine paths from logical hash and includes them in execution snapshot hash', () => {
    const makeLogical = (sourcePath: string, narrationPath: string) =>
      buildLogicalRenderPlanV1({
        timeline_id: 'timeline_1',
        timeline_version: 1,
        timeline_commit_receipt_hash: hashA,
        duration_plan_hash: hashB,
        total_timeline_duration_ms: 1000,
        policy: RENDER_POLICY_V1,
        sources: [source(sourcePath)],
        narration: narration(narrationPath),
      });
    const mac = makeLogical(
      '/Volumes/render-fixtures/media.mp4',
      '/Volumes/render-audio/narration.wav',
    );
    const windows = makeLogical('D:\\media\\media.mp4', 'C:\\audio\\narration.wav');
    expect(mac.logical_render_hash).toBe(windows.logical_render_hash);
    expect(JSON.stringify(mac)).not.toContain('/Volumes/render-fixtures');
    expect(JSON.stringify(windows)).not.toContain('D:\\media');

    const macSnapshot = buildExecutionSnapshotV1({
      logical_render_hash: mac.logical_render_hash,
      platform: 'darwin',
      architecture: 'arm64',
      staging_root: '/private/stage/attempt',
      output_root: '/private/output',
      source_artifacts: [
        {
          authority_sha256: hashC,
          source_path: '/Volumes/render-fixtures/media.mp4',
          staged_path: '/private/stage/attempt/source.mp4',
          staged_sha256: hashC,
          size_bytes: 100,
          segment_ids: ['segment_1'],
        },
      ],
      narration_artifact: {
        authority_sha256: hashD,
        source_path: '/Volumes/render-audio/narration.wav',
        staged_path: '/private/stage/attempt/narration.wav',
        staged_sha256: hashD,
        size_bytes: 100,
      },
      runtime_identity: runtime('darwin', '/Applications/App/runtime'),
    });
    const windowsSnapshot = buildExecutionSnapshotV1({
      logical_render_hash: windows.logical_render_hash,
      platform: 'win32',
      architecture: 'x64',
      staging_root: 'D:\\AppData\\stage\\attempt',
      output_root: 'D:\\AppData\\output',
      source_artifacts: [
        {
          authority_sha256: hashC,
          source_path: 'D:\\media\\media.mp4',
          staged_path: 'D:\\AppData\\stage\\attempt\\source.mp4',
          staged_sha256: hashC,
          size_bytes: 100,
          segment_ids: ['segment_1'],
        },
      ],
      narration_artifact: {
        authority_sha256: hashD,
        source_path: 'C:\\audio\\narration.wav',
        staged_path: 'D:\\AppData\\stage\\attempt\\narration.wav',
        staged_sha256: hashD,
        size_bytes: 100,
      },
      runtime_identity: runtime('win32', 'D:\\App\\runtime'),
    });
    expect(macSnapshot.execution_snapshot_hash).not.toBe(windowsSnapshot.execution_snapshot_hash);
  });
});

describe('Code G narration and FFmpeg capability contracts', () => {
  it('self-hashes sample-derived narration metadata', () => {
    const preimage: Omit<NarrationAudioArtifactV1, 'artifact_hash'> = {
      schema_version: '1.0',
      narration_audio_id: 'audio_1',
      artifact_id: 'artifact_1',
      artifact_sha256: hashA,
      duration_ms: 1000,
      duration_measurement: 'SAMPLE_COUNT_DERIVED',
      sample_count: 48000,
      codec: 'pcm_s16le',
      container: 'wav',
      sample_rate_hz: 48000,
      channels: 2,
      channel_layout: 'stereo',
      size_bytes: 100,
      producer_ref: null,
      provenance_ref: null,
    };
    expect(computeNarrationAudioArtifactHashV1(preimage)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('binds narration ID/hash and enforces the versioned duration tolerance', () => {
    expect(() =>
      assertNarrationMatchesTimelineV1({
        narration: narration('/audio.wav'),
        narration_audio_id: 'wrong_audio',
        narration_audio_hash: hashD,
        total_duration_ms: 1000,
        policy: RENDER_POLICY_V1,
      }),
    ).toThrowError('RENDER_NARRATION_AUDIO_ID_MISMATCH');
    expect(() =>
      assertNarrationMatchesTimelineV1({
        narration: narration('/audio.wav'),
        narration_audio_id: 'audio_1',
        narration_audio_hash: hashA,
        total_duration_ms: 1000,
        policy: RENDER_POLICY_V1,
      }),
    ).toThrowError('RENDER_NARRATION_AUDIO_HASH_MISMATCH');
    expect(() =>
      assertNarrationMatchesTimelineV1({
        narration: narration('/audio.wav'),
        narration_audio_id: 'audio_1',
        narration_audio_hash: hashD,
        total_duration_ms: 1000,
        policy: RENDER_POLICY_V1,
      }),
    ).not.toThrow();
    expect(() =>
      assertNarrationMatchesTimelineV1({
        narration: narration('/audio.wav'),
        narration_audio_id: 'audio_1',
        narration_audio_hash: hashD,
        total_duration_ms: 1001,
        policy: RENDER_POLICY_V1,
      }),
    ).toThrowError('RENDER_NARRATION_DURATION_MISMATCH');
  });

  it('defines a strict, self-hashed immutable receipt foundation without producing success', () => {
    const preimage: Omit<RenderReceiptV1, 'receipt_hash'> = {
      schema_version: '1.0',
      receipt_id: 'receipt_1',
      job_id: 'job_1',
      logical_render_hash: hashA,
      execution_snapshot_hash: hashB,
      timeline_id: 'timeline_1',
      timeline_version: 1,
      timeline_commit_receipt_hash: hashC,
      render_policy_id: RENDER_POLICY_V1.policy_id,
      render_policy_version: RENDER_POLICY_V1.policy_version,
      render_policy_hash: RENDER_POLICY_V1.policy_hash,
      runtime_id: 'runtime_1',
      runtime_manifest_sha256: hashD,
      terminal_state: 'FAILED',
      output_artifact: null,
      verification_facts: null,
      error_id: 'RUNTIME_FAILURE',
      created_at: '2026-09-11T00:00:00.000Z',
    };
    const receipt = parseRenderReceiptV1({
      ...preimage,
      receipt_hash: computeRenderReceiptHashV1(preimage),
    });
    expect(receipt.terminal_state).toBe('FAILED');
    expect(() => parseRenderReceiptV1({ ...receipt, error_id: null })).toThrow();
  });

  it('strictly verifies the published self-hashed capability profile', () => {
    const profilePath = resolve(
      import.meta.dirname,
      '../../docs/render/ffmpeg-required-capability-profile.v1.json',
    );
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as unknown;
    const parsed = parseFfmpegRequiredCapabilityProfileV1(profile);
    expect(parsed.profile_hash).toBe(FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash);
    expect(parsed.forbidden_capabilities.network_input_output).toBe(true);
    expect(parsed.required_capabilities.audio_output.source_video_audio).toBe('DROP');
  });
});

describe('Code G pure Render dependency direction', () => {
  it('keeps the pure Render domain free of Main/runtime dependencies', () => {
    const sourceRoot = resolve(import.meta.dirname, '../../packages/render/src');
    const source = readdirSync(sourceRoot)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(resolve(sourceRoot, name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /from\s+['"](?:node:(?:fs|child_process)|electron|better-sqlite3|python-shell)['"]/u,
    );
    const manifest = JSON.parse(readFileSync(resolve(sourceRoot, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).not.toEqual(
      expect.arrayContaining(['electron', 'better-sqlite3']),
    );
  });
});
