import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, hashFile } from '@app/domain-media-index';
import type {
  NarrationAudioExecutionRefV1,
  RenderExecutionSnapshotV1,
  ResolvedRenderSourceV1,
} from '@app/render';

export interface VerifiedStagingResultV1 {
  staging_root: string;
  output_root: string;
  source_artifacts: RenderExecutionSnapshotV1['source_artifacts'];
  narration_artifact: RenderExecutionSnapshotV1['narration_artifact'];
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function safeAttemptId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) throw new Error('RENDER_ATTEMPT_ID_INVALID');
  return value;
}

function safeExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : '.bin';
}

async function controlledRoot(path: string): Promise<string> {
  const requested = resolve(path);
  await mkdir(requested, { recursive: true });
  const requestedStats = await lstat(requested);
  if (!requestedStats.isDirectory() || requestedStats.isSymbolicLink()) {
    throw new Error('RENDER_CONTROLLED_ROOT_INVALID');
  }
  return realpath(requested);
}

async function verifyRegularFile(path: string): Promise<string> {
  const requested = resolve(path);
  const requestedStats = await lstat(requested);
  if (!requestedStats.isFile() || requestedStats.isSymbolicLink()) {
    throw new Error('RENDER_STAGING_SOURCE_INVALID');
  }
  const resolved = await realpath(requested);
  if (!(await stat(resolved)).isFile()) throw new Error('RENDER_STAGING_SOURCE_INVALID');
  return resolved;
}

async function flushFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class RenderStagingService {
  readonly #configuredStagingRoot: string;
  readonly #configuredOutputRoot: string;

  constructor(options: { stagingRoot: string; outputRoot: string }) {
    this.#configuredStagingRoot = options.stagingRoot;
    this.#configuredOutputRoot = options.outputRoot;
  }

  async stage(input: {
    attempt_id: string;
    sources: readonly ResolvedRenderSourceV1[];
    narration: NarrationAudioExecutionRefV1;
  }): Promise<VerifiedStagingResultV1> {
    const attemptId = safeAttemptId(input.attempt_id);
    const stagingRoot = await controlledRoot(this.#configuredStagingRoot);
    const outputRoot = await controlledRoot(this.#configuredOutputRoot);
    const attemptRoot = join(stagingRoot, attemptId);
    if (!isInside(stagingRoot, attemptRoot)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
    await mkdir(attemptRoot);

    const partialPaths: string[] = [];
    try {
      const byHash = new Map<string, ResolvedRenderSourceV1[]>();
      for (const source of input.sources) {
        const entries = byHash.get(source.verified_file_sha256) ?? [];
        entries.push(source);
        byHash.set(source.verified_file_sha256, entries);
      }
      const sourceArtifacts: Array<RenderExecutionSnapshotV1['source_artifacts'][number]> = [];
      for (const [expectedHash, sources] of [...byHash].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        const source = sources[0]!;
        const staged = await this.#stageOne({
          attemptRoot,
          sourcePath: source.resolved_source_path,
          expectedHash,
          basename: `source-${expectedHash}`,
          partialPaths,
        });
        sourceArtifacts.push({
          ...staged,
          segment_ids: sources.map((entry) => entry.segment_id).sort(),
        });
      }
      const narrationArtifact = await this.#stageOne({
        attemptRoot,
        sourcePath: input.narration.resolved_source_path,
        expectedHash: input.narration.artifact_sha256,
        basename: `narration-${input.narration.artifact_sha256}`,
        partialPaths,
      });
      const result: VerifiedStagingResultV1 = {
        staging_root: attemptRoot,
        output_root: outputRoot,
        source_artifacts: sourceArtifacts,
        narration_artifact: narrationArtifact,
      };
      const manifestTemporary = join(attemptRoot, 'staging-manifest.json.partial');
      const manifestFinal = join(attemptRoot, 'staging-manifest.json');
      partialPaths.push(manifestTemporary);
      await writeFile(manifestTemporary, canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
      await flushFile(manifestTemporary);
      await rename(manifestTemporary, manifestFinal);
      partialPaths.splice(partialPaths.indexOf(manifestTemporary), 1);
      return result;
    } catch (error) {
      await Promise.all(partialPaths.map((path) => rm(path, { force: true })));
      await rm(attemptRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async verify(result: VerifiedStagingResultV1): Promise<void> {
    const configuredStagingRoot = await controlledRoot(this.#configuredStagingRoot);
    const configuredOutputRoot = await controlledRoot(this.#configuredOutputRoot);
    const root = await realpath(result.staging_root);
    const outputRoot = await realpath(result.output_root);
    if (!isInside(configuredStagingRoot, root) || outputRoot !== configuredOutputRoot) {
      throw new Error('RENDER_STAGING_PATH_ESCAPE');
    }
    try {
      for (const artifact of [...result.source_artifacts, result.narration_artifact]) {
        const path = await verifyRegularFile(artifact.staged_path);
        if (!isInside(root, path)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
        const stats = await stat(path);
        if (
          stats.size !== artifact.size_bytes ||
          artifact.staged_sha256 !== artifact.authority_sha256 ||
          (await hashFile(path)) !== artifact.authority_sha256
        ) {
          throw new Error('RENDER_STAGING_HASH_MISMATCH');
        }
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async cleanupAttempt(attemptIdValue: string): Promise<void> {
    const attemptId = safeAttemptId(attemptIdValue);
    const stagingRoot = await controlledRoot(this.#configuredStagingRoot);
    const attemptRoot = join(stagingRoot, attemptId);
    if (!isInside(stagingRoot, attemptRoot)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
    await rm(attemptRoot, { recursive: true, force: true });
  }

  async #stageOne(input: {
    attemptRoot: string;
    sourcePath: string;
    expectedHash: string;
    basename: string;
    partialPaths: string[];
  }): Promise<RenderExecutionSnapshotV1['narration_artifact']> {
    const sourcePath = await verifyRegularFile(input.sourcePath);
    if ((await hashFile(sourcePath)) !== input.expectedHash) {
      throw new Error('RENDER_SOURCE_HASH_MISMATCH_BEFORE_STAGING');
    }
    const finalPath = join(input.attemptRoot, `${input.basename}${safeExtension(sourcePath)}`);
    const partialPath = `${finalPath}.partial`;
    if (!isInside(input.attemptRoot, finalPath)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
    input.partialPaths.push(partialPath);
    await copyFile(sourcePath, partialPath, constants.COPYFILE_EXCL);
    const stagedHash = await hashFile(partialPath);
    if (stagedHash !== input.expectedHash) {
      await rm(partialPath, { force: true });
      throw new Error('RENDER_STAGING_HASH_MISMATCH');
    }
    const sizeBytes = (await stat(partialPath)).size;
    await flushFile(partialPath);
    await rename(partialPath, finalPath);
    input.partialPaths.splice(input.partialPaths.indexOf(partialPath), 1);
    return {
      authority_sha256: input.expectedHash,
      source_path: sourcePath,
      staged_path: finalPath,
      staged_sha256: stagedHash,
      size_bytes: sizeBytes,
    };
  }
}
