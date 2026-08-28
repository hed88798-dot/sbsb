import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, inspectWheel, repositoryRoot, sha256File } from './inventory.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const lockPath = resolve(
  repositoryRoot,
  'compliance/quality-tooling/python/packaging-25.0.lock.json',
);
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

export function qualityToolingPaths(root = process.env.PYTHON_COMPLIANCE_TOOL_ROOT) {
  const toolingRoot = resolve(root || resolve(repositoryRoot, 'artifacts/python-compliance-tools'));
  return {
    root: toolingRoot,
    wheel: resolve(toolingRoot, 'wheels', lock.filename),
    sitePackages: resolve(toolingRoot, 'site-packages'),
    report: resolve(repositoryRoot, 'artifacts/compliance/PYTHON_QUALITY_TOOLING.json'),
  };
}

function assertBootstrapLock() {
  const failures = [];
  const exact = {
    schema_version: '1',
    scope: 'COMPLIANCE_TOOLING',
    package_name: 'packaging',
    version: '25.0',
    purl: 'pkg:pypi/packaging@25.0',
    artifact_type: 'wheel',
    filename: 'packaging-25.0-py3-none-any.whl',
    sha256: '29572ef2b1f17581046b3a2227d5c611fb25ec70ca1ba8554b24b0e69331a484',
    license_expression: 'Apache-2.0 OR BSD-2-Clause',
    license_review_status: 'APPROVED',
    provenance_review_status: 'APPROVED',
    vulnerability_source: 'OSV.DEV',
  };
  for (const [key, value] of Object.entries(exact)) {
    if (lock[key] !== value) failures.push(`quality tooling lock ${key} must be ${value}`);
  }
  for (const key of ['download_url', 'source', 'source_index', 'supplier', 'reviewed_at']) {
    if (!lock[key]) failures.push(`quality tooling lock is missing ${key}`);
  }
  if (!lock.download_url?.startsWith('https://files.pythonhosted.org/')) {
    failures.push('quality tooling wheel must use the exact approved files.pythonhosted.org URL');
  }
  if (!Array.isArray(lock.license_files) || lock.license_files.length !== 3) {
    failures.push('quality tooling lock must contain all three reviewed license files');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

async function downloadLockedWheel(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (statSync(path, { throwIfNoEntry: false })?.isFile()) {
    if ((await sha256File(path)) === lock.sha256) return;
    rmSync(path, { force: true });
  }
  const response = await fetch(lock.download_url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`quality tooling download failed: ${response.status} ${response.statusText}`);
  }
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  const actualHash = await sha256File(path);
  if (actualHash !== lock.sha256) {
    rmSync(path, { force: true });
    throw new Error(
      `quality tooling wheel hash mismatch: expected ${lock.sha256}, got ${actualHash}`,
    );
  }
}

function compareFiles(expected, actual) {
  const actualMap = new Map(actual.map((entry) => [entry.relative_path, entry.sha256]));
  const expectedMap = new Map(expected.map((entry) => [entry.relative_path, entry.sha256]));
  return (
    expectedMap.size === actualMap.size &&
    [...expectedMap].every(([path, hash]) => actualMap.get(path) === hash)
  );
}

async function queryOsv() {
  const response = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      package: { ecosystem: 'PyPI', name: lock.package_name },
      version: lock.version,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`quality tooling OSV query failed: ${response.status}`);
  return await response.json();
}

function installWheel(wheel, sitePackages, pythonExecutable) {
  rmSync(sitePackages, { force: true, recursive: true });
  mkdirSync(sitePackages, { recursive: true });
  const result = spawnSync(
    pythonExecutable,
    [resolve(toolDirectory, 'install-locked-wheel.py'), wheel, sitePackages],
    { encoding: 'utf8', shell: false },
  );
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || 'locked wheel extraction failed');
  }
}

function verifyImport(sitePackages, pythonExecutable) {
  const result = spawnSync(
    pythonExecutable,
    [
      '-c',
      'import json, packaging; print(json.dumps({"version": packaging.__version__, "path": packaging.__file__}))',
    ],
    {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      },
    },
  );
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || 'packaging import failed');
  }
  const imported = JSON.parse(result.stdout);
  const fromSite = relative(sitePackages, imported.path);
  if (imported.version !== lock.version || fromSite === '..' || fromSite.startsWith(`..${sep}`)) {
    throw new Error(`quality tooling import is not bound to locked packaging ${lock.version}`);
  }
  return imported;
}

export async function installAndVerifyQualityTooling() {
  assertBootstrapLock();
  const paths = qualityToolingPaths();
  const pythonExecutable =
    process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python.exe' : 'python3');
  await downloadLockedWheel(paths.wheel);
  const inspected = inspectWheel(paths.wheel, pythonExecutable);
  if (inspected.package_name !== lock.package_name || inspected.version !== lock.version) {
    throw new Error('quality tooling wheel METADATA identity mismatch');
  }
  if (!compareFiles(lock.license_files, inspected.license_files)) {
    throw new Error('quality tooling wheel license files/hash mismatch');
  }
  if (inspected.native_artifacts.length > 0 || inspected.requires_dist.length > 0) {
    throw new Error('packaging bootstrap wheel unexpectedly contains native/transitive artifacts');
  }
  const osv = await queryOsv();
  if (osv.next_page_token) throw new Error('quality tooling OSV response is paginated');
  if ((osv.vulns ?? []).length > 0) {
    throw new Error(
      `quality tooling vulnerability found: ${(osv.vulns ?? []).map((item) => item.id).join(', ')}`,
    );
  }
  installWheel(paths.wheel, paths.sitePackages, pythonExecutable);
  const imported = verifyImport(paths.sitePackages, pythonExecutable);
  const report = {
    schema_version: '1',
    status: 'PASS',
    scope: lock.scope,
    purl: lock.purl,
    artifact_filename: lock.filename,
    artifact_sha256: lock.sha256,
    license_expression: lock.license_expression,
    license_files: lock.license_files,
    provenance: {
      supplier: lock.supplier,
      download_url: lock.download_url,
      source: lock.source,
      source_index: lock.source_index,
      review_status: lock.provenance_review_status,
    },
    vulnerability_source: lock.vulnerability_source,
    vulnerabilities: [],
    installed_version: imported.version,
  };
  mkdirSync(dirname(paths.report), { recursive: true });
  writeFileSync(paths.report, canonicalJson(report));
  console.log(`python-quality-tooling: PASS (${lock.filename}; ${lock.sha256})`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installAndVerifyQualityTooling().catch((error) => {
    console.error(`python-quality-tooling: FAIL\n${error.message}`);
    process.exitCode = 1;
  });
}
