import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const configuredRoots = process.argv.slice(2);
const roots =
  configuredRoots.length > 0 ? configuredRoots : ['apps', 'packages', 'tests', 'tools', '.github'];
const ignoredDirectories = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'dist-renderer',
  'release',
]);
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.py',
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
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of await collectFiles(root)) {
    const content = await readFile(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.expression.test(content)) violations.push(`${file}: ${pattern.label}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`developer-specific-path: FAIL\n${violations.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('developer-specific-path: PASS');
}
