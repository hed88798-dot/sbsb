import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashFile } from '../../packages/domain-media-index/src/index.js';
import {
  buildExecutionSnapshotV1,
  type RenderExecutionSnapshotV1,
} from '../../packages/render/src/index.js';
import { RenderExecutionFileService } from '../../apps/desktop/src/main/render-execution-file-service.js';
import { createRuntimeV2AuthorityFixture } from '../helpers/runtime-v2-authority-fixture.js';

const cleanup: string[] = [];

function withStagingRoot(
  snapshot: RenderExecutionSnapshotV1,
  stagingRoot: string,
): RenderExecutionSnapshotV1 {
  return buildExecutionSnapshotV1({
    logical_render_hash: snapshot.logical_render_hash,
    platform: snapshot.platform,
    architecture: snapshot.architecture,
    staging_root: stagingRoot,
    output_root: snapshot.output_root,
    source_artifacts: snapshot.source_artifacts,
    narration_artifact: snapshot.narration_artifact,
    runtime_identity: snapshot.runtime_identity,
  });
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup(): Promise<{
  service: RenderExecutionFileService;
  snapshot: RenderExecutionSnapshotV1;
  sourcePath: string;
  ffmpegPath: string;
  outputRoot: string;
  stagingRoot: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'r1b-files-'));
  cleanup.push(root);
  const stagingRoot = join(root, 'staging');
  const attemptRoot = join(stagingRoot, 'attempt');
  const outputRoot = join(root, 'output');
  await Promise.all([
    mkdir(attemptRoot, { recursive: true }),
    mkdir(outputRoot, { recursive: true }),
  ]);
  const sourcePath = join(attemptRoot, 'source.mp4');
  const narrationPath = join(attemptRoot, 'narration.wav');
  await writeFile(sourcePath, 'source-v1');
  await writeFile(narrationPath, 'narration-v1');
  const runtime = await createRuntimeV2AuthorityFixture(root);
  const runtimeResolution = await runtime.resolveRuntimeAuthority(runtime.input);
  const sourceHash = await hashFile(sourcePath);
  const narrationHash = await hashFile(narrationPath);
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
    runtime_identity: runtimeResolution.identity,
  });
  return {
    service: new RenderExecutionFileService({
      stagingRoot,
      outputRoot,
      runtimeRoot: runtime.runtimeRoot,
      runtimeManifestPath: runtime.manifestPath,
      approvalReceiptPath: runtime.approvalReceiptPath,
      runtimeAuthorityResolver: runtime.resolveRuntimeAuthority,
    }),
    snapshot,
    sourcePath,
    ffmpegPath: runtime.ffmpegPath,
    outputRoot,
    stagingRoot,
    root,
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
    await writeFile(context.ffmpegPath, 'tampered-after-ready');
    await expect(context.service.reverifyPreparedSnapshot(context.snapshot)).rejects.toThrowError(
      'RENDER_RUNTIME_V2_AUTHORITY_INVALID',
    );
  });

  it('requires the snapshot staging root to remain a strict child of the configured root', async () => {
    const context = await setup();
    const equalRootSnapshot = withStagingRoot(context.snapshot, context.stagingRoot);
    await expect(context.service.reverifyPreparedSnapshot(equalRootSnapshot)).rejects.toThrowError(
      'RENDER_STAGING_PATH_ESCAPE',
    );
  });

  it('rejects a snapshot staging root whose symlink resolves outside the configured root', async () => {
    const context = await setup();
    const outsideRoot = join(context.root, 'outside-staging');
    const linkedRoot = join(context.stagingRoot, 'linked-attempt');
    await mkdir(outsideRoot);
    await symlink(outsideRoot, linkedRoot, 'dir');
    const symlinkEscapeSnapshot = withStagingRoot(context.snapshot, linkedRoot);
    await expect(
      context.service.reverifyPreparedSnapshot(symlinkEscapeSnapshot),
    ).rejects.toThrowError('RENDER_STAGING_PATH_ESCAPE');
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

  it('classifies current historical output missing, size, and hash failures explicitly', async () => {
    const context = await setup();
    const artifactRoot = join(context.outputRoot, 'job', 'artifacts');
    await mkdir(artifactRoot, { recursive: true });
    const finalPath = join(artifactRoot, 'output.mp4');
    expect(await context.service.assessExistingOutput(finalPath, 'a'.repeat(64), 4)).toEqual({
      disposition: 'MISSING',
      observed_sha256: null,
      observed_size_bytes: null,
    });
    await writeFile(finalPath, 'wrong-size');
    expect(
      (await context.service.assessExistingOutput(finalPath, 'a'.repeat(64), 4)).disposition,
    ).toBe('SIZE_INVALID');
    await writeFile(finalPath, 'same');
    expect(
      (await context.service.assessExistingOutput(finalPath, 'a'.repeat(64), 4)).disposition,
    ).toBe('HASH_INVALID');
    const actualHash = await hashFile(finalPath);
    expect(await context.service.assessExistingOutput(finalPath, actualHash, 4)).toEqual({
      disposition: 'TRUSTED',
      observed_sha256: actualHash,
      observed_size_bytes: 4,
    });
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
