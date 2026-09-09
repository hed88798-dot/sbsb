import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

const repositoryRoot = process.cwd();
const immutableAllowlistPath = resolve(
  repositoryRoot,
  'tools/quality/immutable-evidence-allowlist.json',
);

async function loadImmutableAllowlist() {
  try {
    const document = JSON.parse(await readFile(immutableAllowlistPath, 'utf8'));
    if (
      document.schema_version !== '1' ||
      document.allowlist_scope !== 'EXACT_PATH_AND_SHA256' ||
      document.classification !== 'IMMUTABLE_HISTORICAL_EVIDENCE' ||
      !Array.isArray(document.entries)
    ) {
      throw new Error('invalid immutable evidence allowlist header');
    }
    const entries = new Map(document.entries.map((entry) => [entry.path, entry.sha256]));
    for (const [path, sha256] of entries) {
      if (!path || path.startsWith('/') || path.includes('..') || !/^[0-9a-f]{64}$/u.test(sha256)) {
        throw new Error(`invalid immutable evidence allowlist entry: ${path}`);
      }
    }
    return entries;
  } catch (error) {
    throw new Error(`immutable-evidence-allowlist: FAIL (${error.message})`);
  }
}

const immutableAllowlist = await loadImmutableAllowlist();

const configuredRoots = process.argv.slice(2);
const roots = configuredRoots.length > 0 ? configuredRoots : ['.'];
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'dist-renderer',
  'artifacts',
  'coverage',
]);
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.lock',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const slash = '/';
const backslash = '\\';
const cacheDirectory = ['.', 'cache'].join('');
const runtimeDirectory = ['codex', 'runtimes'].join('-');
const patterns = [
  {
    label: 'developer macOS home',
    expression: new RegExp(`${slash}Users${slash}[^${slash}\\s]+${slash}`),
  },
  {
    label: 'developer Linux home',
    expression: new RegExp(`${slash}home${slash}[^${slash}\\s]+${slash}`),
  },
  {
    label: 'developer Windows home',
    expression: new RegExp(
      `[A-Za-z]:${backslash.repeat(2)}Users${backslash.repeat(2)}[^${backslash.repeat(2)}\\s]+${backslash.repeat(2)}`,
    ),
  },
  {
    label: 'Codex runtime cache',
    expression: new RegExp(`\\${cacheDirectory}[\\\\${slash}]${runtimeDirectory}`),
  },
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (path.endsWith(join('apps', 'desktop', 'release'))) continue;
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
const allowlistMismatches = [];
for (const root of roots) {
  for (const file of await collectFiles(root)) {
    const content = await readFile(file, 'utf8');
    const relativePath = relative(repositoryRoot, resolve(file)).split(sep).join('/');
    const expectedHash = immutableAllowlist.get(relativePath);
    const actualHash = expectedHash
      ? createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      : undefined;
    if (expectedHash && actualHash !== expectedHash) {
      allowlistMismatches.push(`${relativePath}: expected ${expectedHash}, got ${actualHash}`);
    }
    for (const pattern of patterns) {
      if (pattern.expression.test(content) && !(expectedHash && actualHash === expectedHash)) {
        violations.push(`${file}: ${pattern.label}`);
      }
    }
  }
}

if (allowlistMismatches.length > 0 || violations.length > 0) {
  const details = [];
  if (allowlistMismatches.length > 0) details.push(...allowlistMismatches);
  if (violations.length > 0) details.push(...violations);
  console.error(`developer-specific-path: FAIL\n${details.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('developer-specific-path: PASS');
}
