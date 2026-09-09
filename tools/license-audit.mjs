import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { collectArtifactNodeInventory, collectPnpmInventory } from './lib/package-inventory.mjs';

const repositoryRoot = process.cwd();
const policy = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'config/dependency-license-policy.json'), 'utf8'),
);
const releaseMode = process.argv.includes('--release');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
const artifactRootIndex = process.argv.indexOf('--artifact-root');
const artifactRoot =
  artifactRootIndex >= 0 && process.argv[artifactRootIndex + 1]
    ? resolve(repositoryRoot, process.argv[artifactRootIndex + 1])
    : null;

function matchesPattern(value, patterns) {
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(value));
}

function classify(license, internal) {
  if (internal) return 'INTERNAL';
  const normalized = /^\([^()]+\)$/.test(license) ? license.slice(1, -1).trim() : license;
  if (normalized === 'UNKNOWN') return 'REJECT';
  if (matchesPattern(normalized, policy.blocked_patterns)) return 'REJECT';
  if (policy.allowed.includes(normalized)) return 'ALLOW';
  if (policy.manual_review.includes(normalized)) return 'REVIEW';
  return 'REJECT';
}

let packages;
try {
  if (releaseMode && !artifactRoot) {
    throw new Error('--release requires --artifact-root pointing at extracted installer contents');
  }
  packages = artifactRoot
    ? collectArtifactNodeInventory(artifactRoot)
    : collectPnpmInventory(repositoryRoot);
  if (packages.length === 0) throw new Error('no npm package manifests found in inventory scope');
} catch (error) {
  console.error(`license-scan: FAIL\n${error.message}`);
  process.exit(1);
}

const auditedPythonRuntime = new Map([
  ['click==8.5.0', 'BSD-3-Clause'],
  ['flatbuffers==25.12.19', 'Apache-2.0'],
  ['numpy==2.3.5', 'BSD-3-Clause'],
  ['onnxruntime==1.29.0', 'MIT'],
  ['opencv-python-headless==4.14.0.94', 'Apache-2.0'],
  ['packaging==26.3', 'Apache-2.0 OR BSD-2-Clause'],
  ['Pillow==12.3.0', 'MIT-CMU'],
  ['platformdirs==4.11.4', 'MIT'],
  ['protobuf==7.36.0', 'BSD-3-Clause'],
  ['scenedetect-headless==0.7.1', 'BSD-3-Clause'],
  ['sentencepiece==0.2.1', 'Apache-2.0'],
  ['tqdm==4.70.0', 'MPL-2.0 AND MIT'],
]);
const pythonRuntimeLock = resolve(repositoryRoot, 'sidecars/media-worker/requirements.lock');
const pythonRuntimeEntries = readFileSync(pythonRuntimeLock, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const pythonAuditFailures = pythonRuntimeEntries
  .filter((requirement) => !auditedPythonRuntime.has(requirement))
  .map((requirement) => `Python runtime dependency not audited: ${requirement}`);
const modelSourceLock = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      'sidecars/media-worker/model-manifests/siglip2-base-patch32-256.source-lock.json',
    ),
    'utf8',
  ),
);
if (modelSourceLock.license !== 'Apache-2.0') {
  pythonAuditFailures.push(`SigLIP 2 source lock license: ${modelSourceLock.license ?? 'UNKNOWN'}`);
}
if (pythonAuditFailures.length > 0) {
  console.error(`license-scan: FAIL\n${pythonAuditFailures.join('\n')}`);
  process.exit(1);
}

const results = packages.map((entry) => ({
  name: entry.name,
  version: entry.version,
  license: entry.internal ? 'PROPRIETARY_INTERNAL' : entry.license,
  decision: classify(entry.license, entry.internal),
}));
const rejected = results.filter((entry) => entry.decision === 'REJECT');
const review = results.filter((entry) => entry.decision === 'REVIEW');

const report = {
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  inventory_scope: artifactRoot
    ? `extracted installer npm inventory: ${artifactRoot}`
    : 'installed pnpm source/build dependency inventory; not final installer contents',
  mode: releaseMode ? 'RELEASE' : 'PR_FIRST_PASS',
  summary: {
    packages: results.length,
    allowed: results.filter((entry) => entry.decision === 'ALLOW').length,
    internal: results.filter((entry) => entry.decision === 'INTERNAL').length,
    manual_review: review.length,
    rejected: rejected.length,
  },
  packages: results,
};

if (reportPath) {
  const resolvedReportPath = resolve(repositoryRoot, reportPath);
  mkdirSync(dirname(resolvedReportPath), { recursive: true });
  writeFileSync(resolvedReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (rejected.length > 0 || (releaseMode && review.length > 0)) {
  const failures = [
    ...rejected.map((entry) => `${entry.name}@${entry.version}: ${entry.license} (REJECT/UNKNOWN)`),
    ...(releaseMode
      ? review.map((entry) => `${entry.name}@${entry.version}: ${entry.license} (REVIEW REQUIRED)`)
      : []),
  ];
  console.error(
    `license-scan: FAIL (${releaseMode ? 'release' : 'first-pass'})\n${failures.join('\n')}`,
  );
  process.exit(1);
}

console.log(
  `license-scan: PASS (${releaseMode ? 'release' : 'first-pass'}; ${results.length} packages; ${review.length} manual-review licenses)`,
);
