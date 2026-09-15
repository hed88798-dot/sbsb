import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, hashFile, sha256 } from '@app/domain-media-index';
import type { ApprovedRuntimeV2AuthorityResolution } from './render-runtime-authority-service.js';

export interface RuntimeTreeMember {
  relative_path: string;
  size_bytes: number;
  sha256: string;
}

export interface RuntimeTreeEvidence {
  schema_version: '1';
  record_kind: 'FFMPEG_RENDER_RUNTIME_DISTRIBUTION_TREE';
  runtime_id: string;
  members: RuntimeTreeMember[];
  runtime_tree_hash: string;
}

const supportingFiles = ['SBOM.cdx.json', 'THIRD_PARTY_NOTICES.md'] as const;
const approvalRelativePath = 'approval/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json';

async function regularFile(path: string): Promise<string> {
  const requested = resolve(path);
  const facts = await lstat(requested);
  if (!facts.isFile() || facts.isSymbolicLink()) throw new Error('RUNTIME_TREE_MEMBER_INVALID');
  const actual = await realpath(requested);
  if (!(await stat(actual)).isFile()) throw new Error('RUNTIME_TREE_MEMBER_INVALID');
  return actual;
}

async function filesUnder(root: string, current = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const facts = await lstat(path);
    if (facts.isSymbolicLink()) throw new Error('RUNTIME_TREE_MEMBER_SET_INVALID');
    if (facts.isDirectory()) found.push(...(await filesUnder(root, path)));
    else if (facts.isFile()) found.push(relative(root, path).split(sep).join('/'));
    else throw new Error('RUNTIME_TREE_MEMBER_SET_INVALID');
  }
  return found.sort((left, right) => left.localeCompare(right));
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export async function createRuntimeTreeEvidence(input: {
  authority: ApprovedRuntimeV2AuthorityResolution;
  runtime_root: string;
  exact_member_set: boolean;
}): Promise<RuntimeTreeEvidence> {
  const runtimeRoot = await realpath(resolve(input.runtime_root));
  const expected = new Map<string, string>();
  expected.set('manifest.json', input.authority.manifest_path);
  expected.set(approvalRelativePath, input.authority.approval_receipt_path);
  for (const supportingFile of supportingFiles) {
    expected.set(supportingFile, join(runtimeRoot, supportingFile));
  }
  for (const member of input.authority.identity.runtime_member_hashes) {
    expected.set(
      `bundle/${member.relative_path}`,
      join(input.authority.bundle_root, member.relative_path),
    );
  }

  const members: RuntimeTreeMember[] = [];
  for (const [relativePath, sourcePath] of [...expected].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const actual = await regularFile(sourcePath);
    if (sourcePath !== input.authority.approval_receipt_path && !inside(runtimeRoot, actual)) {
      throw new Error('RUNTIME_TREE_MEMBER_PATH_ESCAPE');
    }
    members.push({
      relative_path: relativePath,
      size_bytes: (await stat(actual)).size,
      sha256: await hashFile(actual),
    });
  }

  if (input.exact_member_set) {
    const actualFiles = await filesUnder(runtimeRoot);
    const expectedFiles = members.map((member) => member.relative_path);
    if (
      actualFiles.length !== expectedFiles.length ||
      actualFiles.some((path, index) => path !== expectedFiles[index])
    ) {
      throw new Error('RUNTIME_TREE_MEMBER_SET_INVALID');
    }
  }

  const subject = {
    schema_version: '1' as const,
    record_kind: 'FFMPEG_RENDER_RUNTIME_DISTRIBUTION_TREE' as const,
    runtime_id: input.authority.identity.runtime_id,
    members,
  };
  return { ...subject, runtime_tree_hash: sha256(canonicalJson(subject)) };
}

export function assertRuntimeTreesEqual(
  left: RuntimeTreeEvidence,
  right: RuntimeTreeEvidence,
): void {
  if (
    left.runtime_id !== right.runtime_id ||
    left.runtime_tree_hash !== right.runtime_tree_hash ||
    canonicalJson(left.members) !== canonicalJson(right.members)
  ) {
    throw new Error('RUNTIME_TREE_IDENTITY_MISMATCH');
  }
}
