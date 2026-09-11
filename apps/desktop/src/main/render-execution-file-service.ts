import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  readFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hashFile } from '@app/domain-media-index';
import {
  CODE_G_R1B_APPROVAL_RECEIPT_SHA256,
  CODE_G_R1B_APPROVED_FFMPEG_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_ZIP_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1,
  parseRenderExecutionSnapshotV1,
  type RenderExecutionSnapshotV1,
} from '@app/render';

export interface RenderAttemptPathsV1 {
  partial_output_path: string;
  final_output_path: string;
  managed_relative_path: string;
}

export interface ExistingOutputAssessmentV1 {
  disposition: 'TRUSTED' | 'MISSING' | 'HASH_INVALID' | 'SIZE_INVALID' | 'OTHER_INTEGRITY_FAILURE';
  observed_sha256: string | null;
  observed_size_bytes: number | null;
}

export interface RenderExecutionFilePortV1 {
  reverifyPreparedSnapshot(snapshot: RenderExecutionSnapshotV1): Promise<void>;
  createAttemptPaths(input: {
    job_id: string;
    attempt_token: string;
    logical_render_hash: string;
  }): Promise<RenderAttemptPathsV1>;
  assertStableFile(
    path: string,
    expectedHash?: string,
  ): Promise<{
    sha256: string;
    size_bytes: number;
  }>;
  promoteAtomic(input: {
    partial_output_path: string;
    final_output_path: string;
    expected_sha256: string;
    expected_size_bytes: number;
  }): Promise<'ATOMIC_SAME_VOLUME_RENAME'>;
  removePartial(path: string): Promise<void>;
  assessExistingOutput(
    path: string,
    expectedHash: string,
    expectedSize: number,
  ): Promise<ExistingOutputAssessmentV1>;
  verifyExistingOutput(path: string, expectedHash: string, expectedSize: number): Promise<void>;
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function isInside(root: string, candidate: string): boolean {
  return candidate !== root && isInsideOrEqual(root, candidate);
}

function safeIdentity(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) throw new Error('RENDER_EXECUTION_PATH_ID_INVALID');
  return value;
}

async function controlledDirectory(path: string): Promise<string> {
  const requested = resolve(path);
  await mkdir(requested, { recursive: true });
  const facts = await lstat(requested);
  if (!facts.isDirectory() || facts.isSymbolicLink()) {
    throw new Error('RENDER_EXECUTION_CONTROLLED_ROOT_INVALID');
  }
  return realpath(requested);
}

async function exactRegularFile(path: string, code: string): Promise<string> {
  const requested = resolve(path);
  const facts = await lstat(requested);
  if (!facts.isFile() || facts.isSymbolicLink()) throw new Error(code);
  const resolved = await realpath(requested);
  if (!(await stat(resolved)).isFile()) throw new Error(code);
  return resolved;
}

async function absent(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return false;
  } catch {
    return true;
  }
}

export class RenderExecutionFileService implements RenderExecutionFilePortV1 {
  readonly #configuredStagingRoot: string;
  readonly #configuredOutputRoot: string;
  readonly #configuredRuntimeRoot: string;
  readonly #approvalReceiptPath: string;

  constructor(options: {
    stagingRoot: string;
    outputRoot: string;
    runtimeRoot: string;
    approvalReceiptPath: string;
  }) {
    this.#configuredStagingRoot = options.stagingRoot;
    this.#configuredOutputRoot = options.outputRoot;
    this.#configuredRuntimeRoot = options.runtimeRoot;
    this.#approvalReceiptPath = options.approvalReceiptPath;
  }

  async reverifyPreparedSnapshot(snapshotValue: RenderExecutionSnapshotV1): Promise<void> {
    const snapshot = parseRenderExecutionSnapshotV1(snapshotValue);
    const stagingRoot = await controlledDirectory(this.#configuredStagingRoot);
    const snapshotStagingRoot = await realpath(snapshot.staging_root);
    if (!isInside(stagingRoot, snapshotStagingRoot)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    if ((await realpath(snapshot.output_root)) !== outputRoot) {
      throw new Error('RENDER_OUTPUT_ROOT_MISMATCH');
    }
    for (const artifact of [...snapshot.source_artifacts, snapshot.narration_artifact]) {
      const path = await exactRegularFile(artifact.staged_path, 'RENDER_STAGED_INPUT_INVALID');
      if (!isInside(snapshotStagingRoot, path)) throw new Error('RENDER_STAGING_PATH_ESCAPE');
      const facts = await stat(path);
      if (
        artifact.staged_sha256 !== artifact.authority_sha256 ||
        facts.size !== artifact.size_bytes ||
        (await hashFile(path)) !== artifact.staged_sha256
      ) {
        throw new Error('RENDER_STAGED_INPUT_HASH_MISMATCH');
      }
    }
    const approvedManifestSha256 = await this.#verifyApprovalReceipt();
    await this.#verifyRuntime(snapshot, approvedManifestSha256);
    throw new Error('RENDER_ROTATION_RUNTIME_CAPABILITY_V2_REQUIRED');
  }

  async createAttemptPaths(input: {
    job_id: string;
    attempt_token: string;
    logical_render_hash: string;
  }): Promise<RenderAttemptPathsV1> {
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    const jobRoot = join(outputRoot, safeIdentity(input.job_id));
    const attemptsRoot = join(jobRoot, 'attempts');
    const artifactsRoot = join(jobRoot, 'artifacts');
    await mkdir(attemptsRoot, { recursive: true });
    await mkdir(artifactsRoot, { recursive: true });
    for (const path of [jobRoot, attemptsRoot, artifactsRoot]) {
      const facts = await lstat(path);
      if (
        !facts.isDirectory() ||
        facts.isSymbolicLink() ||
        !isInside(outputRoot, await realpath(path))
      ) {
        throw new Error('RENDER_OUTPUT_PATH_ESCAPE');
      }
    }
    const attemptRoot = join(attemptsRoot, safeIdentity(input.attempt_token));
    await mkdir(attemptRoot);
    const partial = join(attemptRoot, 'output.partial.mp4');
    const final = join(artifactsRoot, `${input.logical_render_hash}.mp4`);
    if (!isInside(outputRoot, partial) || !isInside(outputRoot, final)) {
      throw new Error('RENDER_OUTPUT_PATH_ESCAPE');
    }
    if (!(await absent(final))) throw new Error('RENDER_OUTPUT_FINAL_ALREADY_EXISTS');
    return {
      partial_output_path: partial,
      final_output_path: final,
      managed_relative_path: relative(outputRoot, final).split(sep).join('/'),
    };
  }

  async assertStableFile(
    path: string,
    expectedHash?: string,
  ): Promise<{
    sha256: string;
    size_bytes: number;
  }> {
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    const resolved = await exactRegularFile(path, 'RENDER_OUTPUT_INVALID');
    if (!isInside(outputRoot, resolved)) throw new Error('RENDER_OUTPUT_PATH_ESCAPE');
    const before = await stat(resolved);
    if (before.size < 1) throw new Error('RENDER_OUTPUT_EMPTY');
    const sha256 = await hashFile(resolved);
    const after = await stat(resolved);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino ||
      (expectedHash !== undefined && sha256 !== expectedHash)
    ) {
      throw new Error('RENDER_OUTPUT_CHANGED_DURING_VERIFICATION');
    }
    return { sha256, size_bytes: after.size };
  }

  async promoteAtomic(input: {
    partial_output_path: string;
    final_output_path: string;
    expected_sha256: string;
    expected_size_bytes: number;
  }): Promise<'ATOMIC_SAME_VOLUME_RENAME'> {
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    const partial = await exactRegularFile(input.partial_output_path, 'RENDER_OUTPUT_INVALID');
    const requestedFinal = resolve(input.final_output_path);
    const finalParent = await realpath(dirname(requestedFinal));
    const final = join(finalParent, basename(requestedFinal));
    if (
      !isInside(outputRoot, partial) ||
      !isInside(outputRoot, final) ||
      !isInside(outputRoot, finalParent)
    ) {
      throw new Error('RENDER_OUTPUT_PATH_ESCAPE');
    }
    if (!(await absent(final))) throw new Error('RENDER_OUTPUT_FINAL_ALREADY_EXISTS');
    const partialFacts = await stat(partial);
    const parentFacts = await stat(finalParent);
    if (partialFacts.dev !== parentFacts.dev) {
      throw new Error('RENDER_OUTPUT_ATOMIC_RENAME_NOT_GUARANTEED');
    }
    if (
      partialFacts.size !== input.expected_size_bytes ||
      (await hashFile(partial)) !== input.expected_sha256
    ) {
      throw new Error('RENDER_OUTPUT_CHANGED_DURING_VERIFICATION');
    }
    await rename(partial, final);
    const promoted = await this.assertStableFile(final, input.expected_sha256);
    if (promoted.size_bytes !== input.expected_size_bytes) {
      throw new Error('RENDER_OUTPUT_CHANGED_DURING_PROMOTION');
    }
    return 'ATOMIC_SAME_VOLUME_RENAME';
  }

  async removePartial(path: string): Promise<void> {
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    const requested = resolve(path);
    if (!isInside(outputRoot, requested)) throw new Error('RENDER_OUTPUT_PATH_ESCAPE');
    await rm(requested, { force: true });
  }

  async verifyExistingOutput(
    path: string,
    expectedHash: string,
    expectedSize: number,
  ): Promise<void> {
    const assessment = await this.assessExistingOutput(path, expectedHash, expectedSize);
    if (assessment.disposition !== 'TRUSTED') {
      throw new Error(`RENDER_HISTORICAL_OUTPUT_${assessment.disposition}`);
    }
  }

  async assessExistingOutput(
    path: string,
    expectedHash: string,
    expectedSize: number,
  ): Promise<ExistingOutputAssessmentV1> {
    const outputRoot = await controlledDirectory(this.#configuredOutputRoot);
    const requested = resolve(path);
    let resolvedCandidate: string;
    try {
      resolvedCandidate = join(await realpath(dirname(requested)), basename(requested));
    } catch {
      return {
        disposition: 'OTHER_INTEGRITY_FAILURE',
        observed_sha256: null,
        observed_size_bytes: null,
      };
    }
    if (!isInside(outputRoot, resolvedCandidate)) {
      return {
        disposition: 'OTHER_INTEGRITY_FAILURE',
        observed_sha256: null,
        observed_size_bytes: null,
      };
    }
    try {
      const facts = await lstat(resolvedCandidate);
      if (!facts.isFile() || facts.isSymbolicLink()) {
        return {
          disposition: 'OTHER_INTEGRITY_FAILURE',
          observed_sha256: null,
          observed_size_bytes: facts.size,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { disposition: 'MISSING', observed_sha256: null, observed_size_bytes: null };
      }
      return {
        disposition: 'OTHER_INTEGRITY_FAILURE',
        observed_sha256: null,
        observed_size_bytes: null,
      };
    }
    try {
      const observed = await this.assertStableFile(resolvedCandidate);
      if (observed.size_bytes !== expectedSize) {
        return {
          disposition: 'SIZE_INVALID',
          observed_sha256: observed.sha256,
          observed_size_bytes: observed.size_bytes,
        };
      }
      if (observed.sha256 !== expectedHash) {
        return {
          disposition: 'HASH_INVALID',
          observed_sha256: observed.sha256,
          observed_size_bytes: observed.size_bytes,
        };
      }
      return {
        disposition: 'TRUSTED',
        observed_sha256: observed.sha256,
        observed_size_bytes: observed.size_bytes,
      };
    } catch {
      return {
        disposition: 'OTHER_INTEGRITY_FAILURE',
        observed_sha256: null,
        observed_size_bytes: null,
      };
    }
  }

  async #verifyApprovalReceipt(): Promise<string> {
    const receiptPath = await exactRegularFile(
      this.#approvalReceiptPath,
      'RENDER_RUNTIME_APPROVAL_RECEIPT_INVALID',
    );
    if ((await hashFile(receiptPath)) !== CODE_G_R1B_APPROVAL_RECEIPT_SHA256) {
      throw new Error('RENDER_RUNTIME_APPROVAL_RECEIPT_HASH_MISMATCH');
    }
    const value = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>;
    const candidate = value.candidate as Record<string, unknown> | undefined;
    const entrypoints = candidate?.entrypoints as Record<string, unknown> | undefined;
    const authority = value.authority as Record<string, unknown> | undefined;
    const durableArtifact = value.durable_artifact as Record<string, unknown> | undefined;
    if (
      value.approval_status !== 'APPROVED' ||
      authority?.code_g_profile_hash !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash ||
      entrypoints?.['ffmpeg.exe'] !== CODE_G_R1B_APPROVED_FFMPEG_SHA256 ||
      entrypoints?.['ffprobe.exe'] !== CODE_G_R1B_APPROVED_FFPROBE_SHA256 ||
      durableArtifact?.artifact_sha256 !== CODE_G_R1B_APPROVED_RUNTIME_ZIP_SHA256
    ) {
      throw new Error('RENDER_RUNTIME_APPROVAL_RECEIPT_INVALID');
    }
    const manifestSha256 = candidate?.manifest_sha256;
    if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifestSha256)) {
      throw new Error('RENDER_RUNTIME_APPROVAL_RECEIPT_INVALID');
    }
    return manifestSha256;
  }

  async #verifyRuntime(
    snapshot: RenderExecutionSnapshotV1,
    approvedManifestSha256: string,
  ): Promise<void> {
    const identity = snapshot.runtime_identity;
    if (
      identity.approval_status !== 'APPROVED' ||
      identity.platform !== 'win32' ||
      identity.architecture !== 'x64' ||
      identity.capability_profile_hash !== FFMPEG_REQUIRED_CAPABILITY_PROFILE_V1.profile_hash ||
      identity.ffmpeg_entrypoint_sha256 !== CODE_G_R1B_APPROVED_FFMPEG_SHA256 ||
      identity.ffprobe_entrypoint_sha256 !== CODE_G_R1B_APPROVED_FFPROBE_SHA256
    ) {
      throw new Error('RENDER_RUNTIME_NOT_APPROVED');
    }
    if (identity.companion_manifest_sha256 !== approvedManifestSha256) {
      throw new Error('RENDER_RUNTIME_MANIFEST_APPROVAL_MISMATCH');
    }
    const runtimeRoot = await controlledDirectory(this.#configuredRuntimeRoot);
    const ffmpeg = await exactRegularFile(identity.ffmpeg_executable_path, 'RENDER_FFMPEG_INVALID');
    const ffprobe = await exactRegularFile(
      identity.ffprobe_executable_path,
      'RENDER_FFPROBE_INVALID',
    );
    if (!isInside(runtimeRoot, ffmpeg) || !isInside(runtimeRoot, ffprobe)) {
      throw new Error('RENDER_RUNTIME_PATH_ESCAPE');
    }
    if (
      (await hashFile(ffmpeg)) !== CODE_G_R1B_APPROVED_FFMPEG_SHA256 ||
      (await hashFile(ffprobe)) !== CODE_G_R1B_APPROVED_FFPROBE_SHA256
    ) {
      throw new Error('RENDER_RUNTIME_ENTRYPOINT_HASH_MISMATCH');
    }
    const members = new Set<string>();
    let manifestBound = false;
    for (const member of identity.runtime_member_hashes) {
      if (
        isAbsolute(member.relative_path) ||
        member.relative_path.split(/[\\/]/u).some((part) => part === '..' || part.length === 0) ||
        members.has(member.relative_path)
      ) {
        throw new Error('RENDER_RUNTIME_MEMBER_SET_INVALID');
      }
      members.add(member.relative_path);
      const path = await exactRegularFile(
        join(runtimeRoot, member.relative_path),
        'RENDER_RUNTIME_MEMBER_INVALID',
      );
      if (!isInside(runtimeRoot, path) || (await hashFile(path)) !== member.sha256) {
        throw new Error('RENDER_RUNTIME_MEMBER_HASH_MISMATCH');
      }
      if (
        member.relative_path.replaceAll('\\', '/').endsWith('/manifest.json') ||
        member.relative_path === 'manifest.json'
      ) {
        if (member.sha256 !== identity.companion_manifest_sha256) {
          throw new Error('RENDER_RUNTIME_MANIFEST_HASH_MISMATCH');
        }
        manifestBound = true;
      }
    }
    if (!manifestBound) throw new Error('RENDER_RUNTIME_MANIFEST_MEMBER_MISSING');
    const actualMembers = new Set(await this.#runtimeFiles(runtimeRoot));
    if (
      actualMembers.size !== members.size ||
      [...members].some((member) => !actualMembers.has(member.replaceAll('\\', '/')))
    ) {
      throw new Error('RENDER_RUNTIME_MEMBER_SET_MISMATCH');
    }
  }

  async #runtimeFiles(root: string, directory = root): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('RENDER_RUNTIME_MEMBER_SET_INVALID');
      if (entry.isDirectory()) {
        files.push(...(await this.#runtimeFiles(root, path)));
      } else if (entry.isFile()) {
        files.push(relative(root, path).split(sep).join('/'));
      } else {
        throw new Error('RENDER_RUNTIME_MEMBER_SET_INVALID');
      }
    }
    return files.sort();
  }
}
