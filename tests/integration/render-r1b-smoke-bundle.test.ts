import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, hashFile } from '../../packages/domain-media-index/src/index.js';
import {
  RenderPolicyRepository,
  RenderPreparationRepository,
  openDatabase,
} from '../../packages/local-db/src/index.js';
import {
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  RENDER_POLICY_V1,
  buildExecutionSnapshotV1,
  computeLogicalRenderHashV1,
  type LogicalRenderPlanV1,
} from '../../packages/render/src/index.js';
import {
  exportHistoricalR1BSmokeBundle,
  importHistoricalR1BSmokeBundle,
} from '../../apps/desktop/src/main/render-smoke-bundle-service.js';

const cleanup: string[] = [];
const migrationsDirectory = resolve(import.meta.dirname, '../../migrations/desktop-sqlite');

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'r1b-bundle-'));
  cleanup.push(root);
  const staging = join(root, 'source-staging');
  const sourcePath = join(staging, 'source clip.mp4');
  const narrationPath = join(staging, 'narration.wav');
  await mkdir(staging);
  await writeFile(sourcePath, 'historical-source-bytes');
  await writeFile(narrationPath, 'historical-narration-bytes');
  const sourceHash = await hashFile(sourcePath);
  const narrationHash = await hashFile(narrationPath);
  const preimage: Omit<LogicalRenderPlanV1, 'logical_render_hash'> = {
    schema_version: '1.0',
    timeline_id: 'accepted_timeline_1',
    timeline_version: 1,
    timeline_commit_receipt_hash: 'a'.repeat(64),
    duration_plan_hash: 'b'.repeat(64),
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
        verified_file_sha256: sourceHash,
        source_start_ms: 0,
        source_end_ms: 1000,
        selection_request_id: 'selection_1',
        decision_receipt_hash: 'c'.repeat(64),
        selection_slot_id: 'slot_1',
      },
    ],
    narration_operation: {
      operation: 'NARRATION',
      narration_audio_id: 'narration_1',
      artifact_id: 'narration_artifact_1',
      artifact_sha256: narrationHash,
      duration_ms: 1000,
      duration_measurement: 'SAMPLE_COUNT_DERIVED',
      sample_count: 48000,
      codec: 'pcm_s16le',
      container: 'wav',
      sample_rate_hz: 48000,
      channels: 2,
      channel_layout: 'stereo',
      size_bytes: Buffer.byteLength('historical-narration-bytes'),
    },
    total_timeline_duration_ms: 1000,
    total_output_frames: 30,
  };
  const plan = { ...preimage, logical_render_hash: computeLogicalRenderHashV1(preimage) };
  const snapshot = buildExecutionSnapshotV1({
    logical_render_hash: plan.logical_render_hash,
    platform: 'darwin',
    architecture: 'arm64',
    staging_root: staging,
    output_root: join(root, 'source-output'),
    source_artifacts: [
      {
        authority_sha256: sourceHash,
        source_path: sourcePath,
        staged_path: sourcePath,
        staged_sha256: sourceHash,
        size_bytes: Buffer.byteLength('historical-source-bytes'),
        segment_ids: ['segment_1'],
      },
    ],
    narration_artifact: {
      authority_sha256: narrationHash,
      source_path: narrationPath,
      staged_path: narrationPath,
      staged_sha256: narrationHash,
      size_bytes: Buffer.byteLength('historical-narration-bytes'),
    },
    runtime_identity: {
      schema_version: '1.0',
      runtime_id: 'r1a_mock',
      platform: 'darwin',
      architecture: 'arm64',
      ffmpeg_executable_path: '/mock/ffmpeg',
      ffmpeg_entrypoint_sha256: 'd'.repeat(64),
      ffprobe_executable_path: '/mock/ffprobe',
      ffprobe_entrypoint_sha256: 'e'.repeat(64),
      companion_manifest_sha256: 'f'.repeat(64),
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
      capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
      runtime_member_hashes: [{ relative_path: 'manifest.json', sha256: 'f'.repeat(64) }],
      approval_status: 'MOCK_R1A_TEST_ONLY',
    },
  });
  await mkdir(snapshot.output_root);
  const sourceDbPath = join(root, 'source.db');
  const { db } = await openDatabase({ dbPath: sourceDbPath, migrationsDirectory });
  const policies = new RenderPolicyRepository(db);
  policies.register(RENDER_POLICY_V1);
  const preparations = new RenderPreparationRepository(db, { id: () => 'accepted_1' });
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
  preparations.recordReady({
    job_id: job.job_id,
    snapshot,
    artifacts: [
      {
        artifact_record_id: `${job.job_id}:source`,
        artifact_role: 'STAGED_SOURCE',
        authority_sha256: sourceHash,
        artifact_sha256: sourceHash,
        size_bytes: Buffer.byteLength('historical-source-bytes'),
        managed_path: sourcePath,
        artifact_json: canonicalJson(snapshot.source_artifacts[0]!),
      },
      {
        artifact_record_id: `${job.job_id}:narration`,
        artifact_role: 'STAGED_NARRATION',
        authority_sha256: narrationHash,
        artifact_sha256: narrationHash,
        size_bytes: Buffer.byteLength('historical-narration-bytes'),
        managed_path: narrationPath,
        artifact_json: canonicalJson(snapshot.narration_artifact),
      },
    ],
  });
  return { root, db, policies, preparations, job, plan, snapshot };
}

describe('Code G R1B portable historical smoke bundle', () => {
  it('exports exact accepted authority and imports only machine-local path rebinding', async () => {
    const context = await fixture();
    try {
      const bundleRoot = join(context.root, 'bundle');
      const exported = await exportHistoricalR1BSmokeBundle({
        preparations: context.preparations,
        policies: context.policies,
        job_id: context.job.job_id,
        bundle_root: bundleRoot,
      });
      expect(exported.manifest.authority_mode).toBe('HISTORICAL_ACCEPTED_CHAIN');
      expect(exported.manifest.logical_render_hash).toBe(context.plan.logical_render_hash);
      expect(exported.manifest.original_execution_snapshot_hash).toBe(
        context.snapshot.execution_snapshot_hash,
      );
      expect(await readFile(join(bundleRoot, 'authority.json'), 'utf8')).not.toContain(
        context.root,
      );
      const runtimeRoot = join(context.root, 'runtime');
      await mkdir(runtimeRoot);
      const runtimeIdentityPath = join(runtimeRoot, 'runtime-identity.json');
      await writeFile(
        runtimeIdentityPath,
        `${canonicalJson({
          schema_version: '1.0',
          runtime_id: 'approved_runtime_v1',
          platform: 'win32',
          architecture: 'x64',
          ffmpeg_executable_path: 'D:\\runtime\\ffmpeg.exe',
          ffmpeg_entrypoint_sha256: '1'.repeat(64),
          ffprobe_executable_path: 'D:\\runtime\\ffprobe.exe',
          ffprobe_entrypoint_sha256: '2'.repeat(64),
          companion_manifest_sha256: '3'.repeat(64),
          capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
          capability_profile_version: 2,
          capability_profile_hash: '9'.repeat(64),
          runtime_member_hashes: [{ relative_path: 'manifest.json', sha256: '3'.repeat(64) }],
          approval_status: 'APPROVED',
        })}\n`,
      );
      const imported = await importHistoricalR1BSmokeBundle({
        bundle_root: bundleRoot,
        controlled_root: join(context.root, 'windows-import'),
        migrations_directory: migrationsDirectory,
        runtime_root: runtimeRoot,
        runtime_identity_path: runtimeIdentityPath,
        approval_receipt_path: join(context.root, 'approval.json'),
      });
      expect(imported.bundle_hash).toBe(exported.manifest.bundle_hash);
      expect(imported.manifest_hash).toBe(exported.manifest.manifest_hash);
      const importedDb = await openDatabase({
        dbPath: imported.db_path,
        migrationsDirectory,
      });
      try {
        const importedPreparations = new RenderPreparationRepository(importedDb.db);
        const importedJob = importedPreparations.require(context.job.job_id);
        const importedSnapshot = importedPreparations.getReadySnapshot(context.job.job_id)!;
        expect(importedJob.logical_render_hash).toBe(context.plan.logical_render_hash);
        expect(importedSnapshot.execution_snapshot_hash).not.toBe(
          context.snapshot.execution_snapshot_hash,
        );
        expect(importedSnapshot.source_artifacts[0]!.staged_path).not.toContain(
          context.snapshot.staging_root,
        );
        expect(importedSnapshot.source_artifacts[0]!.authority_sha256).toBe(
          context.snapshot.source_artifacts[0]!.authority_sha256,
        );
      } finally {
        importedDb.db.close();
      }
      const config = JSON.parse(await readFile(imported.smoke_config_path, 'utf8')) as {
        smoke_bundle_manifest_hash: string;
        smoke_bundle_hash: string;
      };
      expect(config.smoke_bundle_manifest_hash).toBe(exported.manifest.manifest_hash);
      expect(config.smoke_bundle_hash).toBe(exported.manifest.bundle_hash);
    } finally {
      context.db.close();
    }
  });

  it('rejects a transported file whose bytes no longer match the manifest', async () => {
    const context = await fixture();
    try {
      const bundleRoot = join(context.root, 'tampered-bundle');
      const exported = await exportHistoricalR1BSmokeBundle({
        preparations: context.preparations,
        policies: context.policies,
        job_id: context.job.job_id,
        bundle_root: bundleRoot,
      });
      const media = exported.manifest.files.find((file) => file.role === 'SOURCE')!;
      await writeFile(join(bundleRoot, ...media.relative_path.split('/')), 'tampered');
      await expect(
        importHistoricalR1BSmokeBundle({
          bundle_root: bundleRoot,
          controlled_root: join(context.root, 'rejected-import'),
          migrations_directory: migrationsDirectory,
          runtime_root: context.root,
          runtime_identity_path: join(context.root, 'missing-runtime.json'),
          approval_receipt_path: join(context.root, 'approval.json'),
        }),
      ).rejects.toThrowError('R1B_SMOKE_BUNDLE_FILE_HASH_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  it('rejects symlinked transported media even when target bytes have the expected hash', async () => {
    const context = await fixture();
    try {
      const bundleRoot = join(context.root, 'symlink-bundle');
      const exported = await exportHistoricalR1BSmokeBundle({
        preparations: context.preparations,
        policies: context.policies,
        job_id: context.job.job_id,
        bundle_root: bundleRoot,
      });
      const media = exported.manifest.files.find((file) => file.role === 'SOURCE')!;
      const mediaPath = join(bundleRoot, ...media.relative_path.split('/'));
      await rm(mediaPath);
      await symlink(context.snapshot.source_artifacts[0]!.staged_path, mediaPath);
      await expect(
        importHistoricalR1BSmokeBundle({
          bundle_root: bundleRoot,
          controlled_root: join(context.root, 'symlink-rejected-import'),
          migrations_directory: migrationsDirectory,
          runtime_root: context.root,
          runtime_identity_path: join(context.root, 'missing-runtime.json'),
          approval_receipt_path: join(context.root, 'approval.json'),
        }),
      ).rejects.toThrowError('R1B_SMOKE_BUNDLE_SYMLINK_FORBIDDEN');
    } finally {
      context.db.close();
    }
  });
});
