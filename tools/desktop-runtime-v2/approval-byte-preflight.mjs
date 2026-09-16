import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const EXPECTED_SHA256 = '4f394178882d19442db7a03d9092fb2e662b449700fe516e1d3e36c9d61a2b4c';
const RECEIPT_PATH = 'compliance/approval/ffmpeg-render-v2/FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`ARGUMENT_REQUIRED:${name}`);
  return value;
}

function gitBlobBytes(path) {
  const result = spawnSync('git', ['show', `HEAD:${path}`], { encoding: 'buffer' });
  if (result.status !== 0 || !result.stdout) {
    throw new Error('APPROVAL_RECEIPT_GIT_BLOB_UNAVAILABLE');
  }
  return result.stdout;
}

const path = argument('--path', RECEIPT_PATH);
const expectedSha256 = (argument('--expected-sha256', EXPECTED_SHA256) ?? '').toLowerCase();
const evidencePath = resolve(requiredArgument('--evidence'));
const worktreeBytes = await readFile(path);
const gitBytes = gitBlobBytes(path);
const worktreeSha256 = sha256(worktreeBytes);
const gitBlobSha256 = sha256(gitBytes);
const headShaResult = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (headShaResult.status !== 0) throw new Error('APPROVAL_PREFLIGHT_HEAD_UNAVAILABLE');
const headSha = headShaResult.stdout.trim();

const record = {
  schema_version: '1',
  record_kind: 'DESKTOP_RUNTIME_V2_APPROVAL_BYTE_PREFLIGHT',
  head_sha: headSha,
  path,
  expected_sha256: expectedSha256,
  git_blob_sha256: gitBlobSha256,
  worktree_sha256: worktreeSha256,
  git_blob_matches_expected: gitBlobSha256 === expectedSha256,
  worktree_matches_expected: worktreeSha256 === expectedSha256,
  git_blob_matches_worktree: gitBlobSha256 === worktreeSha256,
  status:
    gitBlobSha256 === expectedSha256 &&
    worktreeSha256 === expectedSha256 &&
    gitBlobSha256 === worktreeSha256
      ? 'PASS'
      : 'FAIL',
};

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
if (record.status !== 'PASS') {
  throw new Error('RENDER_RUNTIME_APPROVAL_BYTE_PREFLIGHT_FAILED');
}
console.log(`APPROVAL_BYTE_PREFLIGHT_JSON:${JSON.stringify(record)}`);
