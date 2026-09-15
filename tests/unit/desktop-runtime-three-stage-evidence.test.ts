import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const transport = 'a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01';
const ffmpeg = '7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933';
const ffprobe = '641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e';

async function runVerifier(installedMemberSha256 = 'member-sha') {
  const root = await mkdtemp(join(tmpdir(), 'runtime-v2-three-stage-'));
  const stagingPath = join(root, 'staging.json');
  const packagingPath = join(root, 'packaging.json');
  const installedPath = join(root, 'installed.json');
  const outputPath = join(root, 'result.json');
  const stagedMember = {
    relative_path: 'bundle/ffmpeg.exe',
    sha256: 'member-sha',
    size_bytes: 42,
  };
  const observedMember = {
    relative_path: 'bundle/ffmpeg.exe',
    size_bytes: 42,
    sha256: 'member-sha',
  };
  await writeFile(
    stagingPath,
    JSON.stringify({
      status: 'PASS',
      transport_sha256: transport,
      source_extracted_tree_hash: 'tree-hash',
      build_staged_tree_hash: 'tree-hash',
      staged_tree: { members: [stagedMember] },
    }),
  );
  const smoke = (mode: string, memberSha256: string) => ({
    mode,
    status: 'PASS',
    observed: {
      runtime_tree_hash: 'tree-hash',
      runtime_tree: { members: [{ ...observedMember, sha256: memberSha256 }] },
      ffmpeg_sha256: ffmpeg,
      ffprobe_sha256: ffprobe,
      path_fallback_used: false,
    },
  });
  await writeFile(packagingPath, JSON.stringify(smoke('PACKAGING_ARTIFACT', 'member-sha')));
  await writeFile(
    installedPath,
    JSON.stringify(smoke('REAL_INSTALLED_APP', installedMemberSha256)),
  );
  await executeFile(process.execPath, [
    resolve('tools/desktop-runtime-v2/verify-three-stage-evidence.mjs'),
    '--staging',
    stagingPath,
    '--packaging',
    packagingPath,
    '--installed',
    installedPath,
    '--output',
    outputPath,
  ]);
  return JSON.parse(await readFile(outputPath, 'utf8')) as { status: string };
}

describe('Runtime v2 three-stage evidence verifier', () => {
  it('treats JSON object key order as non-semantic', async () => {
    await expect(runVerifier()).resolves.toMatchObject({ status: 'PASS' });
  });

  it('still rejects an installed member identity mismatch', async () => {
    await expect(runVerifier('mutated-member-sha')).rejects.toThrow(
      'THREE_STAGE_RUNTIME_BYTES_INVALID',
    );
  });
});
