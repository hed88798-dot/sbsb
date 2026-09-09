import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = process.cwd();
const allowlistPath = resolve(repositoryRoot, 'tools/quality/immutable-evidence-allowlist.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readImmutableEvidenceAllowlist(root = repositoryRoot) {
  const path = resolve(root, 'tools/quality/immutable-evidence-allowlist.json');
  const document = JSON.parse(await readFile(path, 'utf8'));
  if (document.schema_version !== '1' || document.allowlist_scope !== 'EXACT_PATH_AND_SHA256') {
    throw new Error(`invalid immutable evidence allowlist header: ${path}`);
  }
  if (document.classification !== 'IMMUTABLE_HISTORICAL_EVIDENCE') {
    throw new Error(`invalid immutable evidence classification: ${path}`);
  }
  if (!Array.isArray(document.entries) || document.entries.length === 0) {
    throw new Error(`immutable evidence allowlist has no entries: ${path}`);
  }

  const entries = new Map();
  for (const entry of document.entries) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      isAbsolute(entry.path) ||
      entry.path.includes('..') ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`invalid immutable evidence allowlist entry: ${JSON.stringify(entry)}`);
    }
    if (entries.has(entry.path))
      throw new Error(`duplicate immutable evidence path: ${entry.path}`);
    entries.set(entry.path, entry.sha256);
  }
  return { entries, path };
}

export async function verifyImmutableEvidence(root = repositoryRoot) {
  const { entries, path } = await readImmutableEvidenceAllowlist(root);
  const failures = [];
  for (const [relativePath, expected] of entries) {
    const absolutePath = resolve(root, relativePath);
    const actualRelative = relative(resolve(root), absolutePath).split(sep).join('/');
    if (actualRelative !== relativePath) {
      failures.push(`${relativePath}: path escapes repository root`);
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch (error) {
      failures.push(`${relativePath}: missing or unreadable (${error.code ?? error.message})`);
      continue;
    }
    const actual = sha256(bytes);
    if (actual !== expected) failures.push(`${relativePath}: expected ${expected}, got ${actual}`);
  }
  if (failures.length > 0) {
    throw new Error(`immutable-evidence-allowlist: FAIL\n${failures.join('\n')}`);
  }
  return { entries, path };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyImmutableEvidence();
    console.log(`immutable-evidence-allowlist: PASS (${result.entries.size} exact entries)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
