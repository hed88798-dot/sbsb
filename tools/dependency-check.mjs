import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const sourceExtensions = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const ignored = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'dist-renderer',
  'release',
  '.git',
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : sourceExtensions.test(entry.name) ? [path] : [];
  });
}

const rules = [
  {
    within: 'apps/desktop/src/renderer',
    forbidden: [
      /@app\/local-db/,
      /better-sqlite3/,
      /(?:node:)?fs(?:\/|['"])/,
      /(?:node:)?child_process/,
    ],
    message: 'renderer 不得依赖 SQLite、Node fs 或 child_process',
  },
  {
    within: 'apps/desktop',
    forbidden: [/@app\/provider-adapters/],
    message: 'desktop 不得依赖 provider-adapters',
  },
  {
    within: 'packages/domain-copywriting',
    forbidden: [/siliconflow/i, /minimax/i, /fal-ai/i, /replicate/i, /@app\/provider-adapters/],
    message: 'domain-copywriting 不得依赖厂商 SDK/adapter',
  },
  {
    within: 'packages/domain-auto-edit',
    forbidden: [/@app\/domain-digital-human/, /domain-digital-human/],
    message: 'domain-auto-edit 不得依赖 domain-digital-human',
  },
  {
    within: 'sidecars/media-worker',
    forbidden: [/better-sqlite3/, /\bsqlite3\b/, /\bFastAPI\b/, /\bFlask\b/],
    message: 'media-worker 不得写业务 SQLite 或开放 localhost HTTP 服务',
  },
];

const failures = [];
for (const rule of rules) {
  const directory = join(root, rule.within);
  try {
    if (!statSync(directory).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const file of walk(directory)) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of rule.forbidden) {
      if (pattern.test(content)) failures.push(`${relative(root, file)}: ${rule.message}`);
    }
  }
}

const desktopManifestPath = join(root, 'apps/desktop/package.json');
try {
  const manifest = JSON.parse(readFileSync(desktopManifestPath, 'utf8'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  if ('@app/provider-adapters' in dependencies) {
    failures.push('apps/desktop/package.json: provider-adapters 不得成为 desktop dependency');
  }
} catch {
  // Desktop manifest is added by the vertical smoke implementation.
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('dependency-direction: PASS');
