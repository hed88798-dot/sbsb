import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateLicenseCollection } from '../license-policy/evaluator.mjs';
import { verifySpdxQualityTooling } from '../license-policy/verify-quality-tooling.mjs';
import { canonicalJson, inspectWheel, repositoryRoot, sha256File } from './inventory.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const packagingLock = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'compliance/quality-tooling/python/packaging-25.0.lock.json'),
    'utf8',
  ),
);
const inspectorLock = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      'compliance/quality-tooling/python/pyinstaller-archive-inspector-6.22.2.lock.json',
    ),
    'utf8',
  ),
);

function currentArchitecture() {
  return process.arch === 'x64' ? 'x86_64' : process.arch;
}

function packagingComponent() {
  return {
    package_name: packagingLock.package_name,
    version: packagingLock.version,
    purl: packagingLock.purl,
    source: packagingLock.source,
    source_index: packagingLock.source_index,
    supplier: packagingLock.supplier,
    license_expression: packagingLock.license_expression,
    license_artifact_role: packagingLock.license_artifact_role,
    license_distribution_role: packagingLock.license_distribution_role,
    license_review_status: packagingLock.license_review_status,
    provenance_review_status: packagingLock.provenance_review_status,
    license_files: packagingLock.license_files,
    dependencies: [],
    platform_dependencies: {},
    artifacts: [
      {
        platform: 'any',
        architecture: 'any',
        filename: packagingLock.filename,
        sha256: packagingLock.sha256,
        download_url: packagingLock.download_url,
      },
    ],
  };
}

function artifactFor(component) {
  const platform = process.platform;
  const architecture = currentArchitecture();
  const candidates = component.artifacts.filter(
    (artifact) =>
      (artifact.platform === 'any' || artifact.platform === platform) &&
      (artifact.architecture === 'any' || artifact.architecture === architecture),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `${component.purl}: expected one quality-tool artifact for ${platform}/${architecture}, got ${candidates.length}`,
    );
  }
  return candidates[0];
}

function selectedComponents() {
  const all = [packagingComponent(), ...inspectorLock.components];
  const byPurl = new Map(all.map((component) => [component.purl, component]));
  if (byPurl.size !== all.length) throw new Error('quality tooling lock contains duplicate purls');
  const selected = new Set(['pkg:pypi/pyinstaller@6.22.2']);
  const pending = [...selected];
  while (pending.length > 0) {
    const purl = pending.shift();
    const component = byPurl.get(purl);
    if (!component) throw new Error(`quality tooling dependency is not locked: ${purl}`);
    const dependencies = [
      ...(component.dependencies ?? []),
      ...(component.platform_dependencies?.[process.platform] ?? []),
    ];
    for (const dependency of dependencies) {
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return [...selected]
    .sort()
    .map((purl) => ({ component: byPurl.get(purl), artifact: artifactFor(byPurl.get(purl)) }));
}

export function qualityToolingPaths(root = process.env.PYTHON_COMPLIANCE_TOOL_ROOT) {
  const toolingRoot = resolve(root || resolve(repositoryRoot, 'artifacts/python-compliance-tools'));
  return {
    root: toolingRoot,
    wheels: resolve(toolingRoot, 'wheels'),
    sitePackages: resolve(toolingRoot, 'site-packages'),
    report: resolve(repositoryRoot, 'artifacts/compliance/PYTHON_QUALITY_TOOLING.json'),
  };
}

function assertLocks(selected) {
  const failures = [];
  if (packagingLock.schema_version !== '1' || packagingLock.scope !== 'COMPLIANCE_TOOLING') {
    failures.push('packaging quality-tool lock identity is invalid');
  }
  if (
    inspectorLock.schema_version !== '1' ||
    inspectorLock.scope !== 'COMPLIANCE_TOOLING' ||
    inspectorLock.entrypoint !== 'PyInstaller.archive.readers.CArchiveReader' ||
    inspectorLock.version !== '6.22.2'
  ) {
    failures.push('PyInstaller archive-inspector lock identity is invalid');
  }
  for (const { component, artifact } of selected) {
    for (const field of [
      'package_name',
      'version',
      'purl',
      'source',
      'source_index',
      'supplier',
      'license_expression',
    ]) {
      if (!component[field]) failures.push(`${component.purl ?? 'component'}: missing ${field}`);
    }
    if (
      component.license_review_status !== 'APPROVED' ||
      component.provenance_review_status !== 'APPROVED'
    ) {
      failures.push(`${component.purl}: quality-tool provenance/license is not approved`);
    }
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      failures.push(`${component.purl}: artifact SHA-256 is invalid`);
    }
    if (!artifact.download_url.startsWith('https://files.pythonhosted.org/')) {
      failures.push(`${component.purl}: artifact URL is not an exact files.pythonhosted.org URL`);
    }
    if (!Array.isArray(component.license_files) || component.license_files.length === 0) {
      failures.push(`${component.purl}: reviewed license files are missing`);
    }
  }
  const pyinstaller = selected.find(({ component }) => component.package_name === 'pyinstaller');
  if (!pyinstaller?.component.redistribution_evidence) {
    failures.push('PyInstaller bootloader redistribution evidence is missing');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

async function downloadLockedWheel(artifact, path) {
  mkdirSync(dirname(path), { recursive: true });
  if (statSync(path, { throwIfNoEntry: false })?.isFile()) {
    if ((await sha256File(path)) === artifact.sha256) return;
    rmSync(path, { force: true });
  }
  const response = await fetch(artifact.download_url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`quality tooling download failed: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  const hash = await sha256File(path);
  if (hash !== artifact.sha256) {
    rmSync(path, { force: true });
    throw new Error(
      `quality tooling wheel hash mismatch: expected ${artifact.sha256}, got ${hash}`,
    );
  }
}

function exactFiles(expected, actual) {
  const expectedMap = new Map(expected.map((entry) => [entry.relative_path, entry.sha256]));
  const actualMap = new Map(actual.map((entry) => [entry.relative_path, entry.sha256]));
  return (
    expectedMap.size === actualMap.size &&
    [...expectedMap].every(([path, hash]) => actualMap.get(path) === hash)
  );
}

function installWheel(wheel, sitePackages, pythonExecutable) {
  const result = spawnSync(
    pythonExecutable,
    [resolve(toolDirectory, 'install-locked-wheel.py'), wheel, sitePackages],
    { encoding: 'utf8', shell: false },
  );
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || 'locked wheel extraction failed');
  }
}

async function queryOsv(selected) {
  const response = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      queries: selected.map(({ component }) => ({
        package: { ecosystem: 'PyPI', name: component.package_name },
        version: component.version,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`quality tooling OSV query failed: ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.results) || body.results.length !== selected.length) {
    throw new Error('quality tooling OSV batch response does not match locked graph');
  }
  body.results.forEach((result, index) => {
    if (result.next_page_token) throw new Error(`${selected[index].component.purl}: OSV paginated`);
    if ((result.vulns ?? []).length > 0) {
      throw new Error(
        `${selected[index].component.purl}: vulnerability found: ${result.vulns.map((item) => item.id).join(', ')}`,
      );
    }
  });
}

function verifyImports(sitePackages, pythonExecutable) {
  const script = [
    'import json, packaging, PyInstaller',
    'from PyInstaller.archive.readers import CArchiveReader',
    'print(json.dumps({"packaging_version": packaging.__version__, "packaging_path": packaging.__file__, "pyinstaller_version": PyInstaller.__version__, "pyinstaller_path": PyInstaller.__file__, "reader": CArchiveReader.__name__}))',
  ].join('; ');
  const result = spawnSync(pythonExecutable, ['-c', script], {
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr.trim() || 'quality tooling import failed');
  }
  const imported = JSON.parse(result.stdout);
  for (const path of [imported.packaging_path, imported.pyinstaller_path]) {
    const fromSite = relative(sitePackages, path);
    if (fromSite === '..' || fromSite.startsWith(`..${sep}`)) {
      throw new Error('quality tooling import escaped the controlled site-packages');
    }
  }
  if (
    imported.packaging_version !== '25.0' ||
    imported.pyinstaller_version !== '6.22.2' ||
    imported.reader !== 'CArchiveReader'
  ) {
    throw new Error('quality tooling import identity differs from the approved lock');
  }
  return imported;
}

function verifyDependencyGraph(selected, inspections, sitePackages, pythonExecutable) {
  const script = `
import json
import sys
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

payload = json.load(sys.stdin)
versions = {canonicalize_name(item["name"]): item["version"] for item in payload["components"]}
environment = default_environment()
environment["extra"] = ""
resolved = {}
for item in payload["components"]:
    dependencies = []
    for raw in item["requirements"]:
        requirement = Requirement(raw)
        if requirement.marker is not None and not requirement.marker.evaluate(environment):
            continue
        name = canonicalize_name(requirement.name)
        if name not in versions:
            raise SystemExit(f"unlocked runtime dependency: {item['name']} -> {name}")
        if requirement.specifier and not requirement.specifier.contains(versions[name], prereleases=True):
            raise SystemExit(f"locked version violates requirement: {item['name']} -> {raw}")
        dependencies.append(name)
    resolved[item["purl"]] = sorted(set(dependencies))
print(json.dumps(resolved, sort_keys=True))
`;
  const payload = {
    components: selected.map(({ component }) => ({
      name: component.package_name,
      version: component.version,
      purl: component.purl,
      requirements: inspections.get(component.purl).requires_dist_raw,
    })),
  };
  const result = spawnSync(pythonExecutable, ['-c', script], {
    encoding: 'utf8',
    shell: false,
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
  });
  if (result.error || result.status !== 0) {
    throw (
      result.error ??
      new Error(result.stderr.trim() || 'quality tooling dependency resolution failed')
    );
  }
  const resolved = JSON.parse(result.stdout);
  for (const { component } of selected) {
    const declaredPurls = [
      ...(component.dependencies ?? []),
      ...(component.platform_dependencies?.[process.platform] ?? []),
    ];
    const declaredNames = declaredPurls
      .map((purl) => purl.match(/^pkg:pypi\/([^@]+)@/u)?.[1])
      .filter(Boolean)
      .sort();
    if (JSON.stringify(resolved[component.purl]) !== JSON.stringify(declaredNames)) {
      throw new Error(`${component.purl}: locked dependency graph differs from evaluated METADATA`);
    }
  }
}

export async function installAndVerifyQualityTooling() {
  const spdxTooling = verifySpdxQualityTooling();
  const selected = selectedComponents();
  assertLocks(selected);
  const paths = qualityToolingPaths();
  const pythonExecutable =
    process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python.exe' : 'python3');
  rmSync(paths.sitePackages, { force: true, recursive: true });
  mkdirSync(paths.sitePackages, { recursive: true });
  const reports = [];
  const inspections = new Map();
  for (const { component, artifact } of selected) {
    const wheel = resolve(paths.wheels, artifact.filename);
    await downloadLockedWheel(artifact, wheel);
    const inspected = inspectWheel(wheel, pythonExecutable);
    if (
      inspected.package_name.toLowerCase().replaceAll(/[-_.]+/gu, '-') !== component.package_name
    ) {
      throw new Error(`${component.purl}: wheel METADATA name mismatch`);
    }
    if (inspected.version !== component.version || inspected.filename !== artifact.filename) {
      throw new Error(`${component.purl}: wheel METADATA identity mismatch`);
    }
    if (!exactFiles(component.license_files, inspected.license_files)) {
      throw new Error(`${component.purl}: wheel license files/hash mismatch`);
    }
    if (
      inspected.license_expression &&
      inspected.license_expression !== component.license_expression
    ) {
      throw new Error(
        `${component.purl}: wheel license metadata conflicts with reviewed artifact evidence`,
      );
    }
    inspections.set(component.purl, inspected);
    installWheel(wheel, paths.sitePackages, pythonExecutable);
    reports.push({
      purl: component.purl,
      artifact_filename: artifact.filename,
      artifact_sha256: artifact.sha256,
      owner_kind: 'QUALITY_TOOL',
      scope: 'COMPLIANCE_TOOLING',
      license_expression: component.license_expression,
      license_files: component.license_files,
      provenance: {
        source: component.source,
        source_index: component.source_index,
        download_url: artifact.download_url,
        review_status: component.provenance_review_status,
      },
      vulnerability_source: inspectorLock.vulnerability_source,
      vulnerabilities: [],
    });
  }
  await queryOsv(selected);
  const imported = verifyImports(paths.sitePackages, pythonExecutable);
  verifyDependencyGraph(selected, inspections, paths.sitePackages, pythonExecutable);
  const licenseEvidence = selected.map(({ component, artifact }) => {
    const inspected = inspections.get(component.purl);
    return {
      artifact_sha256: artifact.sha256,
      package: component.package_name,
      version: component.version,
      artifact_type: 'QUALITY_TOOL_WHEEL',
      artifact_role: component.license_artifact_role ?? 'PYTHON_BUILD_DEPENDENCY',
      distribution_role: component.license_distribution_role ?? 'BUILD_ONLY_USE',
      detected_license_expression: component.license_expression,
      evidence_status: 'PASS',
      source_provenance: {
        purl: component.purl,
        source: component.source,
        source_index: component.source_index,
        download_url: artifact.download_url,
        supplier: component.supplier,
        review_status: component.provenance_review_status,
      },
      evidence_sources: [
        ...(inspected.license_expression
          ? [
              {
                evidence_type: 'METADATA_LICENSE_EXPRESSION',
                value: inspected.license_expression,
              },
            ]
          : [
              ...(inspected.legacy_license
                ? [
                    {
                      evidence_type: 'METADATA_LICENSE',
                      value: inspected.legacy_license,
                    },
                  ]
                : []),
              {
                evidence_type: 'REVIEWED_BUNDLED_LICENSE_EXPRESSION',
                value: component.license_expression,
              },
            ]),
        ...component.license_files.map((entry) => ({
          evidence_type: 'LICENSE_FILE',
          relative_path: entry.relative_path,
          sha256: entry.sha256,
        })),
      ],
      exception_evidence: [
        ...component.license_files.map((entry) => ({
          evidence_type: 'LICENSE_FILE',
          relative_path: entry.relative_path,
          sha256: entry.sha256,
        })),
        ...(component.redistribution_evidence
          ? [
              {
                evidence_type: 'EXCEPTION_SOURCE',
                source: component.redistribution_evidence,
              },
            ]
          : []),
      ],
    };
  });
  const licenseEvaluation = evaluateLicenseCollection(licenseEvidence);
  const blockingLicenses = licenseEvaluation.decisions.filter(
    (entry) => entry.policy_result !== 'PASS',
  );
  if (blockingLicenses.length > 0) {
    throw new Error(
      blockingLicenses
        .map(
          (entry) => `${entry.package}@${entry.version}: ${entry.policy_result}: ${entry.reason}`,
        )
        .join('\n'),
    );
  }
  const report = {
    schema_version: '3',
    status: 'PASS',
    scope: 'COMPLIANCE_TOOLING',
    tool_name: inspectorLock.tool_name,
    entrypoint: inspectorLock.entrypoint,
    components: reports,
    imports: imported,
    spdx_quality_tooling: spdxTooling,
    license_evidence: licenseEvidence,
    license_evaluation: licenseEvaluation,
  };
  mkdirSync(dirname(paths.report), { recursive: true });
  writeFileSync(paths.report, canonicalJson(report));
  console.log(`python-quality-tooling: PASS (${reports.length} exact artifacts)`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installAndVerifyQualityTooling().catch((error) => {
    console.error(`python-quality-tooling: FAIL\n${error.message}`);
    process.exitCode = 1;
  });
}
