import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, hashFile, sha256 } from '@app/domain-media-index';
import {
  CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256,
  CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256,
  CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256,
  CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256,
  CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256,
  FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2,
  assertApprovedRuntimeV2Identity,
  renderRuntimeIdentityV1Schema,
  verifyRuntimeV2ApprovalReceipt,
  type RenderRuntimeIdentityV1,
} from '@app/render';

export interface ApprovedRuntimeV2AuthorityInput {
  runtime_root: string;
  runtime_manifest_path: string;
  approval_receipt_path: string;
}

export interface ApprovedRuntimeV2AuthorityResolution {
  identity: RenderRuntimeIdentityV1;
  runtime_root: string;
  bundle_root: string;
  manifest_path: string;
  approval_receipt_path: string;
  ffprobe_path: string;
  approval_receipt_sha256: string;
}

interface RuntimeAuthorityHashPort {
  hashFile(path: string): Promise<string>;
  hashCanonical(value: unknown): string;
}

const productionHashPort: RuntimeAuthorityHashPort = {
  hashFile,
  hashCanonical: (value) => sha256(canonicalJson(value)),
};

function objectRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function isInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function safeRuntimeRelativePath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('RENDER_RUNTIME_MANIFEST_MEMBER_SET_INVALID');
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.includes('\u0000') ||
    normalized.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('RENDER_RUNTIME_MANIFEST_MEMBER_SET_INVALID');
  }
  return normalized;
}

async function exactDirectory(path: string, code: string): Promise<string> {
  const requested = resolve(path);
  const requestedFacts = await lstat(requested);
  if (!requestedFacts.isDirectory() || requestedFacts.isSymbolicLink()) throw new Error(code);
  const resolved = await realpath(requested);
  const resolvedFacts = await lstat(resolved);
  if (!resolvedFacts.isDirectory() || resolvedFacts.isSymbolicLink()) throw new Error(code);
  return resolved;
}

async function exactRegularFile(path: string, code: string): Promise<string> {
  const requested = resolve(path);
  const requestedFacts = await lstat(requested);
  if (!requestedFacts.isFile() || requestedFacts.isSymbolicLink()) throw new Error(code);
  const resolved = await realpath(requested);
  if (!(await stat(resolved)).isFile()) throw new Error(code);
  return resolved;
}

async function runtimeFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const facts = await lstat(path);
    if (facts.isSymbolicLink()) throw new Error('RENDER_RUNTIME_MEMBER_SET_INVALID');
    if (facts.isDirectory()) {
      files.push(...(await runtimeFiles(root, path)));
    } else if (facts.isFile()) {
      files.push(relative(root, path).split(sep).join('/'));
    } else {
      throw new Error('RENDER_RUNTIME_MEMBER_SET_INVALID');
    }
  }
  return files.sort();
}

function withoutFields(value: Record<string, unknown>, fields: readonly string[]) {
  const copy = structuredClone(value);
  for (const field of fields) delete copy[field];
  return copy;
}

async function resolveWithHashPort(
  input: ApprovedRuntimeV2AuthorityInput,
  hashes: RuntimeAuthorityHashPort,
): Promise<ApprovedRuntimeV2AuthorityResolution> {
  const runtimeRoot = await exactDirectory(input.runtime_root, 'RENDER_RUNTIME_ROOT_INVALID');
  const manifestPath = await exactRegularFile(
    input.runtime_manifest_path,
    'RENDER_RUNTIME_MANIFEST_INVALID',
  );
  const expectedManifestPath = join(runtimeRoot, 'manifest.json');
  if (manifestPath !== expectedManifestPath) {
    throw new Error('RENDER_RUNTIME_MANIFEST_PATH_MISMATCH');
  }
  const approvalReceiptPath = await exactRegularFile(
    input.approval_receipt_path,
    'RENDER_RUNTIME_APPROVAL_RECEIPT_INVALID',
  );
  const approvalReceiptSha256 = await hashes.hashFile(approvalReceiptPath);
  if (approvalReceiptSha256 !== CODE_G_R1B_APPROVAL_RECEIPT_V2_SHA256) {
    throw new Error('RENDER_RUNTIME_APPROVAL_RECEIPT_HASH_MISMATCH');
  }
  const approval = verifyRuntimeV2ApprovalReceipt({
    receipt_sha256: approvalReceiptSha256,
    receipt: JSON.parse(await readFile(approvalReceiptPath, 'utf8')) as unknown,
  });

  const manifest = objectRecord(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
    'RENDER_RUNTIME_MANIFEST_INVALID',
  );
  const platform = objectRecord(manifest.platform, 'RENDER_RUNTIME_MANIFEST_INVALID');
  const provenance = objectRecord(manifest.provenance, 'RENDER_RUNTIME_MANIFEST_INVALID');
  const entrypoints = Array.isArray(manifest.entrypoints)
    ? manifest.entrypoints.map((entry) => objectRecord(entry, 'RENDER_RUNTIME_MANIFEST_INVALID'))
    : null;
  const bundleMembers = Array.isArray(manifest.bundle_members)
    ? manifest.bundle_members.map((member) =>
        objectRecord(member, 'RENDER_RUNTIME_MANIFEST_INVALID'),
      )
    : null;
  if (
    manifest.schema_version !== '1' ||
    manifest.subject_type !== 'FFMPEG_RENDER_RUNTIME_BUNDLE' ||
    manifest.role !== 'PRODUCT_RUNTIME_DEPENDENCY' ||
    manifest.runtime_id !== approval.runtime_id ||
    manifest.manifest_sha256 !== approval.runtime_manifest_sha256 ||
    manifest.runtime_identity_sha256 !== approval.runtime_identity_sha256 ||
    platform.os !== 'windows' ||
    platform.architecture !== 'x86_64' ||
    provenance.code_g_capability_profile_hash !==
      FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash ||
    provenance.build_profile_sha256 !== CODE_G_R1B_APPROVED_BUILD_PROFILE_V2_SHA256 ||
    entrypoints === null ||
    entrypoints.length !== 2 ||
    bundleMembers === null ||
    bundleMembers.length < 2
  ) {
    throw new Error('RENDER_RUNTIME_MANIFEST_APPROVAL_MISMATCH');
  }
  if (
    hashes.hashCanonical(withoutFields(manifest, ['manifest_sha256'])) !==
      CODE_G_R1B_APPROVED_RUNTIME_V2_MANIFEST_SHA256 ||
    hashes.hashCanonical(
      withoutFields(manifest, ['manifest_sha256', 'runtime_identity_sha256', 'license_evidence']),
    ) !== CODE_G_R1B_APPROVED_RUNTIME_V2_IDENTITY_SHA256
  ) {
    throw new Error('RENDER_RUNTIME_MANIFEST_HASH_MISMATCH');
  }

  const entrypointHashes = new Map<string, string>();
  for (const entrypoint of entrypoints) {
    const path = safeRuntimeRelativePath(entrypoint.path);
    const memberHash = entrypoint.sha256;
    if (
      !['ffmpeg.exe', 'ffprobe.exe'].includes(path) ||
      typeof memberHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(memberHash) ||
      entrypointHashes.has(path)
    ) {
      throw new Error('RENDER_RUNTIME_MANIFEST_ENTRYPOINT_SET_INVALID');
    }
    entrypointHashes.set(path, memberHash);
  }
  if (
    entrypointHashes.get('ffmpeg.exe') !== CODE_G_R1B_APPROVED_FFMPEG_V2_SHA256 ||
    entrypointHashes.get('ffprobe.exe') !== CODE_G_R1B_APPROVED_FFPROBE_V2_SHA256
  ) {
    throw new Error('RENDER_RUNTIME_ENTRYPOINT_HASH_MISMATCH');
  }

  const approvedMembers = new Map<string, string>();
  const caseFoldedMembers = new Set<string>();
  for (const member of bundleMembers) {
    const path = safeRuntimeRelativePath(member.path);
    const memberHash = member.sha256;
    const caseFolded = path.toLocaleLowerCase('en-US');
    if (
      typeof memberHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(memberHash) ||
      approvedMembers.has(path) ||
      caseFoldedMembers.has(caseFolded)
    ) {
      throw new Error('RENDER_RUNTIME_MANIFEST_MEMBER_SET_INVALID');
    }
    approvedMembers.set(path, memberHash);
    caseFoldedMembers.add(caseFolded);
  }
  for (const [entrypoint, expectedHash] of entrypointHashes) {
    if (approvedMembers.get(entrypoint) !== expectedHash) {
      throw new Error('RENDER_RUNTIME_MANIFEST_ENTRYPOINT_BINDING_MISMATCH');
    }
  }

  const bundleRoot = await exactDirectory(
    join(runtimeRoot, 'bundle'),
    'RENDER_RUNTIME_BUNDLE_INVALID',
  );
  const actualMembers = await runtimeFiles(bundleRoot);
  if (
    actualMembers.length !== approvedMembers.size ||
    actualMembers.some((path) => !approvedMembers.has(path))
  ) {
    throw new Error('RENDER_RUNTIME_MEMBER_SET_MISMATCH');
  }
  const resolvedMembers: Array<{ relative_path: string; sha256: string }> = [];
  for (const [relativePath, expectedHash] of approvedMembers) {
    const memberPath = await exactRegularFile(
      join(bundleRoot, ...relativePath.split('/')),
      'RENDER_RUNTIME_MEMBER_INVALID',
    );
    if (!isInside(bundleRoot, memberPath) || (await hashes.hashFile(memberPath)) !== expectedHash) {
      throw new Error('RENDER_RUNTIME_MEMBER_HASH_MISMATCH');
    }
    resolvedMembers.push({ relative_path: relativePath, sha256: expectedHash });
  }
  resolvedMembers.sort((left, right) => left.relative_path.localeCompare(right.relative_path));

  const ffmpegPath = await exactRegularFile(
    join(bundleRoot, 'ffmpeg.exe'),
    'RENDER_FFMPEG_INVALID',
  );
  const ffprobePath = await exactRegularFile(
    join(bundleRoot, 'ffprobe.exe'),
    'RENDER_FFPROBE_INVALID',
  );
  const identity = renderRuntimeIdentityV1Schema.parse({
    schema_version: '1.0',
    runtime_id: approval.runtime_id,
    platform: 'win32',
    architecture: 'x64',
    ffmpeg_executable_path: ffmpegPath,
    ffmpeg_entrypoint_sha256: entrypointHashes.get('ffmpeg.exe'),
    ffprobe_executable_path: ffprobePath,
    ffprobe_entrypoint_sha256: entrypointHashes.get('ffprobe.exe'),
    companion_manifest_sha256: approval.runtime_manifest_sha256,
    capability_profile_id: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_id,
    capability_profile_version: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_version,
    capability_profile_hash: FFMPEG_REQUIRED_CAPABILITY_PROFILE_V2.profile_hash,
    runtime_member_hashes: resolvedMembers,
    approval_status: 'APPROVED',
  });
  assertApprovedRuntimeV2Identity(identity);
  return {
    identity,
    runtime_root: runtimeRoot,
    bundle_root: bundleRoot,
    manifest_path: manifestPath,
    approval_receipt_path: approvalReceiptPath,
    ffprobe_path: ffprobePath,
    approval_receipt_sha256: approvalReceiptSha256,
  };
}

export async function resolveApprovedRuntimeV2Authority(
  input: ApprovedRuntimeV2AuthorityInput,
): Promise<ApprovedRuntimeV2AuthorityResolution> {
  try {
    return await resolveWithHashPort(input, productionHashPort);
  } catch (error) {
    if (error instanceof Error && error.message === 'RENDER_RUNTIME_V2_AUTHORITY_INVALID') {
      throw error;
    }
    throw new Error('RENDER_RUNTIME_V2_AUTHORITY_INVALID', { cause: error });
  }
}

/** Test-only port substitution; production callers use resolveApprovedRuntimeV2Authority. */
export function createApprovedRuntimeV2AuthorityResolverForTests(
  hashes: RuntimeAuthorityHashPort,
): (input: ApprovedRuntimeV2AuthorityInput) => Promise<ApprovedRuntimeV2AuthorityResolution> {
  return async (input) => {
    try {
      return await resolveWithHashPort(input, hashes);
    } catch (error) {
      throw new Error('RENDER_RUNTIME_V2_AUTHORITY_INVALID', { cause: error });
    }
  };
}
