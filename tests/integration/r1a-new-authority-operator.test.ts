import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmbeddingGenerationKey,
  createIndexSignature,
  encodeNormalizedVector,
} from '../../packages/domain-media-index/src/index.js';
import {
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2,
  computeNarrationAudioArtifactHashV1,
  type NarrationAudioArtifactV1,
  type RenderRuntimeIdentityV1,
} from '../../packages/render/src/index.js';
import { parseOperatorConfig } from '../../tools/r1a-acceptance/config.mjs';
import { runControlledAuthorityOperator } from '../../tools/r1a-acceptance/operator.mjs';
import { resolveApprovedRuntimeV2 } from '../../tools/r1a-acceptance/runtime-authority.mjs';

const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');
const approvalReceipt = resolve(
  import.meta.dirname,
  '../../compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json',
);
const directories: string[] = [];

function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'r1a-new-authority-'));
  directories.push(directory);
  const acceptanceRoot = join(directory, 'attempt-1');
  const sourcePath = join(directory, 'real-controlled-media.mp4');
  const narrationPath = join(directory, 'real-controlled-narration.wav');
  writeFileSync(sourcePath, 'controlled-media-bytes');
  writeFileSync(narrationPath, 'controlled-narration-bytes');
  const config = parseOperatorConfig({
    schema_version: '1.0',
    acceptance_id: 'controlled_test_attempt',
    acceptance_data_root: acceptanceRoot,
    migrations_directory: migrationsDirectory,
    staging_root: join(acceptanceRoot, 'staging'),
    output_root: join(acceptanceRoot, 'output'),
    code_c: {
      worker: {
        executable_path: process.execPath,
        arguments: [],
        working_directory: null,
        timeout_ms: 5000,
      },
      model_root: directory,
      shot_detector_config_path: join(directory, 'detector.json'),
      embedding_model_version: 'controlled-model-v1',
      embedding_preprocess_version: 'controlled-preprocess-v1',
      embedding_dimension: 4,
      media: [{ asset_id: 'asset_real_1', revision: 1, source_path: sourcePath }],
      searches: [
        {
          selection_request_id: 'selection_real_1',
          batch_id: 'batch_real_1',
          video_id: 'video_real_1',
          slot_id: 'slot_real_1',
          material_family: 'ANIMAL',
          candidate_set_id: 'candidate_set_real_1',
          query_text: '猪场饮水',
          top_k: 5,
          filters: {},
        },
      ],
    },
    timeline: {
      timeline_id: 'timeline_real_1',
      planning_request_id: 'planning_real_1',
      shot_plan_id: 'shot_plan_real_1',
      shot_plan_version: 1,
      source_document_id: 'document_real_1',
      source_document_version: 1,
      source_document_hash: hash('controlled-document'),
      slots: [
        {
          slot_id: 'slot_real_1',
          order_index: 0,
          source_start: 0,
          source_end: 4,
          source_text: '测试文案',
          route: 'ANIMAL',
          visual_continuity_group_id: 'group_real_1',
        },
      ],
      timing_snapshot_id: 'timing_real_1',
      timing_snapshot_version: 1,
      slot_timings: [{ slot_id: 'slot_real_1', start_ms: 0, end_ms: 1000 }],
      pause_intervals: [],
      duration_policy: {
        schema_version: '1.0',
        policy_id: 'timeline-policy-v1',
        policy_version: '1.0.0',
        active_extension_mode: 'SAME_VISUAL_CONTINUITY',
        active_stitch_mode: 'WHEN_CURRENT_MATERIAL_EXHAUSTED',
        passive_extension_target_min_ms: 0,
        passive_extension_max_ms: 0,
        pause_coverage_mode: 'PREVIOUS_REAL_MATERIAL_WHEN_BOTH_SIDES_REAL',
        source_consumption_strategy: 'FORWARD_FROM_SHOT_START',
      },
    },
    narration: {
      narration_audio_id: 'narration_real_1',
      artifact_id: 'narration_artifact_real_1',
      source_path: narrationPath,
      producer_ref: 'controlled-upstream-narration',
      provenance_ref: 'controlled-test-only',
    },
    runtime: {
      root: directory,
      manifest_path: join(directory, 'manifest.json'),
      approval_receipt_path: approvalReceipt,
    },
  });
  writeFileSync(config.code_c.shot_detector_config_path, '{"parameters":{}}');
  return { directory, acceptanceRoot, sourcePath, narrationPath, config };
}

function mockRuntime(): { identity: RenderRuntimeIdentityV1; ffprobePath: string } {
  return {
    identity: {
      schema_version: '1.0',
      runtime_id: 'mock-r1a-wiring-only',
      platform: 'darwin',
      architecture: 'arm64',
      ffmpeg_executable_path: '/test-only/ffmpeg-not-executed',
      ffmpeg_entrypoint_sha256: '1'.repeat(64),
      ffprobe_executable_path: '/test-only/ffprobe-not-executed',
      ffprobe_entrypoint_sha256: '2'.repeat(64),
      companion_manifest_sha256: '3'.repeat(64),
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_version,
      capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash,
      runtime_member_hashes: [{ relative_path: 'ffmpeg', sha256: '1'.repeat(64) }],
      approval_status: 'MOCK_R1A_TEST_ONLY',
    },
    ffprobePath: '/test-only/ffprobe-not-executed',
  };
}

function narrationArtifact(path: string, durationMs = 1000): NarrationAudioArtifactV1 {
  const bytes = readFileSync(path);
  const preimage = {
    schema_version: '1.0' as const,
    narration_audio_id: 'narration_real_1',
    artifact_id: 'narration_artifact_real_1',
    artifact_sha256: hash(bytes),
    duration_ms: durationMs,
    duration_measurement: 'SAMPLE_COUNT_DERIVED' as const,
    sample_count: durationMs * 48,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: bytes.byteLength,
    producer_ref: 'controlled-upstream-narration',
    provenance_ref: 'controlled-test-only',
  };
  return { ...preimage, artifact_hash: computeNarrationAudioArtifactHashV1(preimage) };
}

function codeCStub(sourcePath: string, durationMs = 1000) {
  return vi.fn(
    async ({ repository }: { repository: { commitAssetRevision(input: unknown): void } }) => {
      const artifactRoot = join(resolve(sourcePath, '..'), `code-c-artifacts-${durationMs}`);
      mkdirSync(join(artifactRoot, 'keyframes'), { recursive: true });
      mkdirSync(join(artifactRoot, 'embeddings'), { recursive: true });
      const vector = encodeNormalizedVector([1, 0, 0, 0]);
      const keyframe = Buffer.from('controlled-keyframe');
      writeFileSync(join(artifactRoot, 'keyframes', 'frame.jpg'), keyframe);
      writeFileSync(join(artifactRoot, 'embeddings', 'shot.f16'), vector);
      const fileHash = hash(readFileSync(sourcePath));
      const signature = createIndexSignature({
        index_schema_version: '1.0',
        index_signature_version: '1.0',
        embedding_model: 'google/siglip2-base-patch32-256',
        embedding_model_version: 'controlled-model-v1',
        embedding_preprocess_version: 'controlled-preprocess-v1',
        vlm_model: null,
        vlm_model_version: null,
        vlm_prompt_version: null,
        shot_detector: 'PySceneDetect.AdaptiveDetector',
        shot_detector_version: '0.7.1',
        shot_detector_params_hash: '1'.repeat(64),
        keyframe_policy_version: 'safe-mid-best-v1',
        file_hash: fileHash,
      });
      const descriptor = {
        schema_version: '1.0' as const,
        shot_id: 'shot_real_1',
        species: ['pig'],
        scene: 'farm',
        action: ['drinking'],
        health_state: 'unknown' as const,
        people_present: false,
        product_present: false,
        shot_type: 'unknown' as const,
        description: 'controlled authorized test fixture',
        quality: { score: 0.9, blur: 0.1, dark: 0.1, overexposed: 0 },
        embedding_ref: 'embedding_real_1',
        industry_metadata: {},
        confidence: {},
        provenance: { source: 'controlled-test-only' },
        evidence: {},
      };
      repository.commitAssetRevision({
        manifest: {
          schema_version: '1.0',
          asset_id: 'asset_real_1',
          revision: 1,
          source_path: sourcePath,
          file_hash: fileHash,
          size_bytes: readFileSync(sourcePath).byteLength,
          mtime_ns: '1',
          duration_ms: durationMs,
          width: 1920,
          height: 1080,
          rotation: 0,
          fps: 30,
          index_signature: signature.input,
          index_signature_hash: signature.hash,
          generation_key_hash: createEmbeddingGenerationKey(signature.input),
          artifact_root: artifactRoot,
          shots: [
            {
              shot_id: 'shot_real_1',
              start_ms: 0,
              end_ms: durationMs,
              keyframes: [
                {
                  keyframe_id: 'keyframe_real_1',
                  role: 'MIDPOINT',
                  timestamp_ms: Math.floor(durationMs / 2),
                  relative_path: 'keyframes/frame.jpg',
                  sha256: hash(keyframe),
                  quality: descriptor.quality,
                },
              ],
              quality: descriptor.quality,
              descriptor,
              embedding: {
                embedding_id: 'embedding_real_1',
                model_id: 'google/siglip2-base-patch32-256',
                model_version: 'controlled-model-v1',
                preprocess_version: 'controlled-preprocess-v1',
                dimension: 4,
                dtype: 'float16',
                normalized: true,
                relative_path: 'embeddings/shot.f16',
                sha256: hash(vector),
              },
            },
          ],
          worker_version: 'controlled-test-only',
          created_at: '2026-09-14T00:00:00.000Z',
        },
        manifestSha256: 'c'.repeat(64),
      });
      return [
        {
          intent: {
            schema_version: '1.0',
            selection_request_id: 'selection_real_1',
            batch_id: 'batch_real_1',
            video_id: 'video_real_1',
            slot_id: 'slot_real_1',
            material_family: 'ANIMAL',
            candidate_set_id: 'candidate_set_real_1',
            candidate_set_contract_version: 'code-c-shot-search-v1',
          },
          eligibleCandidates: [
            {
              schema_version: '1.0',
              asset_id: 'asset_real_1',
              shot_id: 'shot_real_1',
              start_ms: 0,
              end_ms: durationMs,
              revision: 1,
              semantic_score: 0.9,
              descriptor,
            },
          ],
        },
      ];
    },
  );
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('R1A-N0 controlled new-authority operator', () => {
  it('rejects unknown fields and relative traversal', async () => {
    const { config } = await setup();
    expect(() => parseOperatorConfig({ ...config, surprise: true })).toThrowError(
      'R1A_OPERATOR_CONFIG_INVALID',
    );
    expect(() =>
      parseOperatorConfig({ ...config, acceptance_data_root: '../escaped-attempt' }),
    ).toThrowError('R1A_OPERATOR_PATH_INVALID');
  });

  it('rejects an existing nonempty acceptance root', async () => {
    const context = await setup();
    mkdirSync(context.acceptanceRoot);
    writeFileSync(join(context.acceptanceRoot, 'prior-evidence.json'), '{}');
    await expect(
      runControlledAuthorityOperator(context.config, {
        runtime: mockRuntime(),
        codeC: codeCStub(context.sourcePath),
        deriveNarration: () => narrationArtifact(context.narrationPath),
        allowMockRuntimeForTests: true,
      }),
    ).rejects.toThrowError('R1A_ACCEPTANCE_ROOT_NOT_EMPTY');
  });

  it('stops after the first Code C blocker and preserves the failed attempt root', async () => {
    const context = await setup();
    const narration = vi.fn(() => narrationArtifact(context.narrationPath));
    await expect(
      runControlledAuthorityOperator(context.config, {
        runtime: mockRuntime(),
        codeC: vi.fn(() => {
          throw new Error('CODE_C_INDEX_FAILED');
        }),
        deriveNarration: narration,
        allowMockRuntimeForTests: true,
      }),
    ).rejects.toThrowError('CODE_C_INDEX_FAILED');
    expect(narration).not.toHaveBeenCalled();
    expect(
      readFileSync(join(context.acceptanceRoot, 'R1A_AUTHORITY_ATTEMPT.json'), 'utf8'),
    ).toContain('STARTED');
  });

  it('stops on Code D NO_MATCH before narration and Timeline authority', async () => {
    const context = await setup();
    const narration = vi.fn(() => narrationArtifact(context.narrationPath));
    const emptyCodeC = vi.fn(async () => [
      {
        intent: {
          schema_version: '1.0',
          selection_request_id: 'selection_real_1',
          batch_id: 'batch_real_1',
          video_id: 'video_real_1',
          slot_id: 'slot_real_1',
          material_family: 'ANIMAL',
          candidate_set_id: 'candidate_set_real_1',
          candidate_set_contract_version: 'code-c-shot-search-v1',
        },
        eligibleCandidates: [],
      },
    ]);
    await expect(
      runControlledAuthorityOperator(context.config, {
        runtime: mockRuntime(),
        codeC: emptyCodeC,
        deriveNarration: narration,
        allowMockRuntimeForTests: true,
      }),
    ).rejects.toThrowError('CODE_D_NO_SELECTED_RESULT');
    expect(narration).not.toHaveBeenCalled();
  });

  it('stops on invalid narration before Code E and R1A', async () => {
    const context = await setup();
    await expect(
      runControlledAuthorityOperator(context.config, {
        runtime: mockRuntime(),
        codeC: codeCStub(context.sourcePath),
        deriveNarration: vi.fn(() => {
          throw new Error('REAL_NARRATION_INPUT_REQUIRED');
        }),
        allowMockRuntimeForTests: true,
      }),
    ).rejects.toThrowError('REAL_NARRATION_INPUT_REQUIRED');
    const db = new BetterSqlite3(join(context.acceptanceRoot, 'acceptance.sqlite'), {
      readonly: true,
    });
    expect(db.prepare('SELECT count(*) FROM timeline_plan_versions').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM render_jobs').pluck().get()).toBe(0);
    db.close();
  });

  it('stops when accepted Code E cannot produce a closed physical plan', async () => {
    const context = await setup();
    await expect(
      runControlledAuthorityOperator(context.config, {
        runtime: mockRuntime(),
        codeC: codeCStub(context.sourcePath, 500),
        deriveNarration: () => narrationArtifact(context.narrationPath),
        allowMockRuntimeForTests: true,
      }),
    ).rejects.toThrowError('CODE_E_PLANNING_FAILED');
    const db = new BetterSqlite3(join(context.acceptanceRoot, 'acceptance.sqlite'), {
      readonly: true,
    });
    expect(db.prepare('SELECT count(*) FROM render_jobs').pluck().get()).toBe(0);
    db.close();
  });

  it('creates migrations 001-008 and a test-only READY authority without executing R1B', async () => {
    const context = await setup();
    const result = await runControlledAuthorityOperator(context.config, {
      runtime: mockRuntime(),
      codeC: codeCStub(context.sourcePath),
      deriveNarration: () => narrationArtifact(context.narrationPath),
      allowMockRuntimeForTests: true,
    });
    expect(result.JOB_STATE).toBe('READY_FOR_EXECUTION');
    expect(result.RUNTIME_PROFILE_HASH).toBe(FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash);
    expect(Object.keys(result).sort()).toEqual(
      [
        'JOB_ID',
        'JOB_STATE',
        'TIMELINE_ID',
        'TIMELINE_VERSION',
        'TIMELINE_COMMIT_RECEIPT_HASH',
        'DURATION_PLAN_HASH',
        'RENDER_POLICY_ID',
        'RENDER_POLICY_VERSION',
        'RENDER_POLICY_HASH',
        'LOGICAL_RENDER_HASH',
        'EXECUTION_SNAPSHOT_HASH',
        'NARRATION_AUDIO_ID',
        'NARRATION_AUDIO_SHA256',
        'SOURCE_ARTIFACT_COUNT',
        'RUNTIME_ID',
        'RUNTIME_PROFILE_HASH',
      ].sort(),
    );
    const db = new BetterSqlite3(join(context.acceptanceRoot, 'acceptance.sqlite'), {
      readonly: true,
    });
    expect(
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all(),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(db.prepare('SELECT count(*) FROM render_execution_attempts').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM render_receipts').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM render_execution_snapshots').pluck().get()).toBe(1);
    db.close();
  });

  it('rejects Runtime v1, wrong Runtime v2 identity, and wrong receipt bytes fail closed', async () => {
    const context = await setup();
    writeFileSync(context.config.runtime.manifest_path, '{"runtime_id":"legacy-runtime-v1"}');
    await expect(resolveApprovedRuntimeV2(context.config.runtime)).rejects.toThrowError(
      'RUNTIME_V2_AUTHORITY_INVALID',
    );
    writeFileSync(
      context.config.runtime.manifest_path,
      JSON.stringify({
        runtime_id: 'wrong-runtime-v2',
        manifest_sha256: '0'.repeat(64),
        runtime_identity_sha256: '0'.repeat(64),
      }),
    );
    await expect(resolveApprovedRuntimeV2(context.config.runtime)).rejects.toThrowError(
      'RUNTIME_V2_AUTHORITY_INVALID',
    );
    const wrongReceipt = join(context.directory, 'wrong-receipt.json');
    writeFileSync(wrongReceipt, '{}');
    await expect(
      resolveApprovedRuntimeV2({
        ...context.config.runtime,
        approval_receipt_path: wrongReceipt,
      }),
    ).rejects.toThrowError('RUNTIME_V2_AUTHORITY_INVALID');
  });
});
