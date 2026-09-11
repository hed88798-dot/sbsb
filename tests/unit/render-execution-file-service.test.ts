import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashFile } from '../../packages/domain-media-index/src/index.js';
import {
  CODE_G_R1B_APPROVED_FFMPEG_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  buildExecutionSnapshotV1,
  type RenderExecutionSnapshotV1,
} from '../../packages/render/src/index.js';
import { RenderExecutionFileService } from '../../apps/desktop/src/main/render-execution-file-service.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup(): Promise<{
  service: RenderExecutionFileService;
  snapshot: RenderExecutionSnapshotV1;
  sourcePath: string;
  ffmpegPath: string;
  outputRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'r1b-files-'));
  cleanup.push(root);
  const stagingRoot = join(root, 'staging');
  const attemptRoot = join(stagingRoot, 'attempt');
  const outputRoot = join(root, 'output');
  const runtimeRoot = join(root, 'runtime');
  await Promise.all([
    mkdir(attemptRoot, { recursive: true }),
    mkdir(outputRoot, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true }),
  ]);
  const sourcePath = join(attemptRoot, 'source.mp4');
  const narrationPath = join(attemptRoot, 'narration.wav');
  const ffmpegPath = join(runtimeRoot, 'ffmpeg.exe');
  const ffprobePath = join(runtimeRoot, 'ffprobe.exe');
  const manifestPath = join(runtimeRoot, 'manifest.json');
  await writeFile(sourcePath, 'source-v1');
  await writeFile(narrationPath, 'narration-v1');
  await writeFile(ffmpegPath, 'mutated-ffmpeg');
  await writeFile(ffprobePath, 'mutated-ffprobe');
  await writeFile(manifestPath, '{}');
  const sourceHash = await hashFile(sourcePath);
  const narrationHash = await hashFile(narrationPath);
  const approvedManifestHash = 'd01be7ca70d541b5f1bee788a823634dd4c6883aa483c95b52c7bef10214cbaf';
  const approvalReceiptPath = resolve(
    import.meta.dirname,
    '../../compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_RUNTIME_APPROVAL_V1.json',
  );
  const snapshot = buildExecutionSnapshotV1({
    logical_render_hash: 'a'.repeat(64),
    platform: 'win32',
    architecture: 'x64',
    staging_root: attemptRoot,
    output_root: outputRoot,
    source_artifacts: [
      {
        authority_sha256: sourceHash,
        source_path: sourcePath,
        staged_path: sourcePath,
        staged_sha256: sourceHash,
        size_bytes: Buffer.byteLength('source-v1'),
        segment_ids: ['segment_1'],
      },
    ],
    narration_artifact: {
      authority_sha256: narrationHash,
      source_path: narrationPath,
      staged_path: narrationPath,
      staged_sha256: narrationHash,
      size_bytes: Buffer.byteLength('narration-v1'),
    },
    runtime_identity: {
      schema_version: '1.0',
      runtime_id: 'approved-runtime',
      platform: 'win32',
      architecture: 'x64',
      ffmpeg_executable_path: ffmpegPath,
      ffmpeg_entrypoint_sha256: CODE_G_R1B_APPROVED_FFMPEG_SHA256,
      ffprobe_executable_path: ffprobePath,
      ffprobe_entrypoint_sha256: CODE_G_R1B_APPROVED_FFPROBE_SHA256,
      companion_manifest_sha256: approvedManifestHash,
      capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_id,
      capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_version,
      capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash,
      runtime_member_hashes: [{ relative_path: 'manifest.json', sha256: approvedManifestHash }],
      approval_status: 'APPROVED',
    },
  });
  return {
    service: new RenderExecutionFileService({
      stagingRoot,
      outputRoot,
      runtimeRoot,
      approvalReceiptPath,
    }),
    snapshot,
    sourcePath,
    ffmpegPath,
    outputRoot,
  };
}

describe('Code G R1B filesystem fail-closed controls', () => {
  it('detects staged source mutation immediately before spawn', async () => {
    const context = await setup();
    await writeFile(context.sourcePath, 'tampered-after-ready');
    await expect(context.service.reverifyPreparedSnapshot(context.snapshot)).rejects.toThrowError(
      'RENDER_STAGED_INPUT_HASH_MISMATCH',
    );
  });

  it('detects approved runtime entrypoint mutation before spawn', async () => {
    const context = await setup();
    await expect(context.service.reverifyPreparedSnapshot(context.snapshot)).rejects.toThrowError(
      'RENDER_RUNTIME_ENTRYPOINT_HASH_MISMATCH',
    );
  });

  it('promotes verified bytes by same-volume atomic rename without modifying them', async () => {
    const context = await setup();
    const attemptRoot = join(context.outputRoot, 'job', 'attempts', 'one');
    const artifactRoot = join(context.outputRoot, 'job', 'artifacts');
    await mkdir(attemptRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    const partialPath = join(attemptRoot, 'output.partial.mp4');
    const finalPath = join(artifactRoot, 'output.mp4');
    await writeFile(partialPath, 'verified-output-bytes');
    const expectedHash = await hashFile(partialPath);
    expect(
      await context.service.promoteAtomic({
        partial_output_path: partialPath,
        final_output_path: finalPath,
        expected_sha256: expectedHash,
        expected_size_bytes: Buffer.byteLength('verified-output-bytes'),
      }),
    ).toBe('ATOMIC_SAME_VOLUME_RENAME');
    expect(await hashFile(finalPath)).toBe(expectedHash);
    expect(await readFile(finalPath, 'utf8')).toBe('verified-output-bytes');
  });

  it('refuses to overwrite an existing managed final artifact', async () => {
    const context = await setup();
    const attemptRoot = join(context.outputRoot, 'job', 'attempts', 'one');
    const artifactRoot = join(context.outputRoot, 'job', 'artifacts');
    await mkdir(attemptRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
    const partialPath = join(attemptRoot, 'output.partial.mp4');
    const finalPath = join(artifactRoot, 'output.mp4');
    await writeFile(partialPath, 'new-output');
    await writeFile(finalPath, 'historical-output');
    await expect(
      context.service.promoteAtomic({
        partial_output_path: partialPath,
        final_output_path: finalPath,
        expected_sha256: await hashFile(partialPath),
        expected_size_bytes: Buffer.byteLength('new-output'),
      }),
    ).rejects.toThrowError('RENDER_OUTPUT_FINAL_ALREADY_EXISTS');
    expect(await readFile(finalPath, 'utf8')).toBe('historical-output');
  });

  it('rejects traversal-like job and attempt identities before creating paths', async () => {
    const context = await setup();
    await expect(
      context.service.createAttemptPaths({
        job_id: '../escape',
        attempt_token: 'attempt_1',
        logical_render_hash: 'a'.repeat(64),
      }),
    ).rejects.toThrowError('RENDER_EXECUTION_PATH_ID_INVALID');
  });
});
