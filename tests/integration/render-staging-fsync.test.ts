import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashFile } from '../../packages/domain-media-index/src/index.js';
import type {
  NarrationAudioExecutionRefV1,
  ResolvedRenderSourceV1,
} from '../../packages/render/src/index.js';
import { RenderStagingService } from '../../apps/desktop/src/main/render-staging-service.js';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'render-staging-fsync-'));
  cleanupRoots.push(root);
  const stagingRoot = join(root, 'staging');
  const outputRoot = join(root, 'output');
  await Promise.all([
    rm(stagingRoot, { recursive: true, force: true }),
    rm(outputRoot, { recursive: true, force: true }),
  ]);
  const sourcePath = join(root, 'source.mp4');
  const narrationPath = join(root, 'narration.wav');
  await writeFile(sourcePath, Buffer.from('real-staging-source-bytes'));
  await writeFile(narrationPath, Buffer.from('real-staging-narration-bytes'));
  const sourceHash = await hashFile(sourcePath);
  const narrationHash = await hashFile(narrationPath);
  const source: ResolvedRenderSourceV1 = {
    schema_version: '1.0',
    segment_id: 'segment_fsync',
    asset_id: 'asset_fsync',
    revision: 1,
    shot_id: 'shot_fsync',
    shot_start_ms: 0,
    shot_end_ms: 1000,
    source_start_ms: 0,
    source_end_ms: 1000,
    timeline_start_ms: 0,
    timeline_end_ms: 1000,
    selection_request_id: 'selection_fsync',
    decision_receipt_hash: '1'.repeat(64),
    selection_slot_id: 'slot_fsync',
    resolved_source_path: sourcePath,
    verified_file_sha256: sourceHash,
  };
  const narration: NarrationAudioExecutionRefV1 = {
    schema_version: '1.0',
    narration_audio_id: 'narration_fsync',
    artifact_id: 'narration_artifact_fsync',
    source_path: narrationPath,
    producer_ref: 'tts_fsync',
    provenance_ref: null,
    artifact_sha256: narrationHash,
    duration_ms: 1000,
    duration_measurement: 'CONTAINER_REPORTED',
    sample_count: null,
    codec: 'pcm_s16le',
    container: 'wav',
    sample_rate_hz: 48000,
    channels: 2,
    channel_layout: 'stereo',
    size_bytes: Buffer.byteLength('real-staging-narration-bytes'),
    resolved_source_path: narrationPath,
    verified_file_sha256: narrationHash,
    resolved_at: '2026-09-15T00:00:00.000Z',
  };
  return {
    root,
    source,
    narration,
    sourceHash,
    narrationHash,
    staging: new RenderStagingService({ stagingRoot, outputRoot }),
  };
}

describe('RenderStagingService durability barrier', () => {
  it('flushes and atomically promotes source, narration, and manifest bytes on a real filesystem', async () => {
    const context = await setup();
    const result = await context.staging.stage({
      attempt_id: 'fsync_attempt',
      sources: [context.source],
      narration: context.narration,
    });

    expect(await hashFile(result.source_artifacts[0]!.staged_path)).toBe(context.sourceHash);
    expect(await hashFile(result.narration_artifact.staged_path)).toBe(context.narrationHash);

    const manifestPath = join(result.staging_root, 'staging-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof result;
    expect(manifest.source_artifacts[0]!.staged_sha256).toBe(context.sourceHash);
    expect(manifest.narration_artifact.staged_sha256).toBe(context.narrationHash);
    expect(await readdir(result.staging_root)).not.toContain('staging-manifest.json.partial');
  });

  it('reopens an existing file through the product staging path without mutating its bytes', async () => {
    const context = await setup();
    const result = await context.staging.stage({
      attempt_id: 'fsync_existing_file_attempt',
      sources: [context.source],
      narration: context.narration,
    });
    const stagedSource = result.source_artifacts[0]!;
    const stagedNarration = result.narration_artifact;
    expect((await readFile(stagedSource.staged_path)).toString()).toBe('real-staging-source-bytes');
    expect((await readFile(stagedNarration.staged_path)).toString()).toBe(
      'real-staging-narration-bytes',
    );
    await context.staging.verify(result);
  });
});
