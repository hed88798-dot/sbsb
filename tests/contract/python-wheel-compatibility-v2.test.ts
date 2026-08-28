import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePythonExecutable } from '../helpers/python-runtime.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const python = resolvePythonExecutable();
const cli = join(repositoryRoot, 'tools/python-supply-chain/cli.mjs');
const engine = join(repositoryRoot, 'tools/python-supply-chain/compatibility-engine.py');
const fixtureBuilder = join(repositoryRoot, 'tests/fixtures/python-supply-chain/build_fixture.py');
const candidateTool = join(repositoryRoot, 'tools/python-supply-chain/create-candidate.mjs');
const migrationTool = join(repositoryRoot, 'tools/python-supply-chain/migrate-v1-to-v2.mjs');
const requireHashesTool = join(
  repositoryRoot,
  'tools/python-supply-chain/generate-require-hashes.mjs',
);
const sbomTool = join(repositoryRoot, 'tools/compliance/generate-sbom.mjs');
const complianceSite = join(repositoryRoot, 'artifacts/python-compliance-tools/site-packages');

interface FixtureMetadata {
  filename: string;
  package_name: string;
  wheel_sha256: string;
  license_path: string;
  license_sha256: string;
  native_path: string | null;
  native_sha256: string | null;
}

interface TargetDescriptor {
  target_descriptor_version: string;
  implementation: string;
  python_version: string;
  os: string;
  architecture: string;
  compatibility: {
    compatibility_engine: string;
    compatibility_engine_version: string;
    packaging_version: string;
    wheel_tag_parser: string;
    wheel_tag_parser_version: string;
    tag_source: string;
    compatible_tags: string[];
    compatible_tags_sha256: string;
  };
}

function pythonEnvironment() {
  return {
    ...process.env,
    PYTHON_EXECUTABLE: python,
    PYTHONPATH: [complianceSite, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
}

function runNode(script: string, argumentsValue: string[]) {
  return spawnSync(process.execPath, [script, ...argumentsValue], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: pythonEnvironment(),
  });
}

function runEngine(request: Record<string, unknown>) {
  const result = spawnSync(python, [engine], {
    input: JSON.stringify(request),
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: pythonEnvironment(),
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function target(os: 'windows' | 'linux', architecture: 'x86_64' | 'arm64', platforms: string[]) {
  return runEngine({
    action: 'synthetic_target',
    python_version: '3.12',
    python_full_version: '3.12.0',
    os,
    architecture,
    abis: ['cp312'],
    platforms,
  }) as unknown as TargetDescriptor;
}

function buildWheel(
  root: string,
  name: string,
  tag: string,
  options: { requires?: string[]; nativeName?: string; noNative?: boolean } = {},
) {
  const argumentsValue = [fixtureBuilder, root, '--name', name, '--wheel-tag', tag];
  if (options.noNative) argumentsValue.push('--no-native');
  if (options.nativeName) argumentsValue.push('--native-name', options.nativeName);
  for (const requirement of options.requires ?? []) {
    argumentsValue.push('--requires', requirement);
  }
  const result = spawnSync(python, argumentsValue, { encoding: 'utf8', shell: false });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as FixtureMetadata;
}

function purl(name: string) {
  return `pkg:pypi/${name.toLowerCase().replaceAll(/[-_.]+/gu, '-')}@1.0.0`;
}

function artifact(
  metadata: FixtureMetadata,
  targetDescriptor: TargetDescriptor,
  options: { direct: boolean; dependencies?: string[]; requirements?: string[] },
) {
  const evaluated = runEngine({
    action: 'evaluate',
    filename: metadata.filename,
    compatible_tags: targetDescriptor.compatibility.compatible_tags,
  }) as {
    status: string;
    matched_tags: string[];
    wheel_tags: string[];
  };
  return {
    package_name: metadata.package_name,
    version: '1.0.0',
    artifact_type: 'wheel',
    filename: metadata.filename,
    artifact_path: metadata.filename,
    sha256: metadata.wheel_sha256,
    source: `https://example.invalid/${metadata.package_name}`,
    source_index: 'https://pypi.org/simple',
    purl: purl(metadata.package_name),
    wheel_tags: evaluated.wheel_tags,
    compatibility: {
      status: evaluated.status,
      matched_tags: evaluated.matched_tags,
    },
    license_expression: 'MIT',
    license_files: [{ relative_path: metadata.license_path, sha256: metadata.license_sha256 }],
    native_artifacts:
      metadata.native_path && metadata.native_sha256
        ? [
            {
              filename: basename(metadata.native_path),
              relative_path: metadata.native_path,
              packaged_relative_path: `runtime/${basename(metadata.native_path)}`,
              sha256: metadata.native_sha256,
              type: metadata.native_path.endsWith('.pyd') ? 'pyd' : 'so',
              source_package: metadata.package_name,
            },
          ]
        : [],
    provenance: {
      supplier: 'Synthetic Code F fixture',
      download_url: `https://example.invalid/artifacts/${metadata.filename}`,
      review_status: 'APPROVED',
      reviewed_at: '2026-08-28T00:00:00Z',
      upstream_signature: null,
      notes: 'Synthetic fixture only',
    },
    direct: options.direct,
    dependencies: options.dependencies ?? [],
    dependency_declarations: (options.requirements ?? []).map((requirement, index) => {
      const packageName = requirement.match(/^([A-Za-z0-9._-]+)/u)?.[1] ?? 'invalid';
      return {
        requirement,
        package_name: packageName,
        disposition: 'INCLUDED',
        purl: options.dependencies?.[index],
        reason: '',
      };
    }),
  };
}

function inventory(targetDescriptor: TargetDescriptor, packages: Array<Record<string, unknown>>) {
  return {
    schema_version: '2',
    inventory_id: `code-f-v2-${targetDescriptor.os}-${targetDescriptor.architecture}`,
    scope: 'PRODUCTION_WORKER_RUNTIME',
    target: targetDescriptor,
    graph_complete: true,
    packages,
  };
}

function verify(inventoryPath: string, artifactRoot: string) {
  return runNode(cli, ['verify', '--inventory', inventoryPath, '--artifact-root', artifactRoot]);
}

describe('Python Artifact Inventory v2 wheel compatibility', () => {
  let directory: string;
  let artifactRoot: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'python-wheel-v2-'));
    artifactRoot = join(directory, 'wheels');
    mkdirSync(artifactRoot);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('keeps committed old-v1 and new-v2 contract fixtures readable', () => {
    for (const name of ['v1-legacy.fixture.json', 'v2-mixed-tags.fixture.json']) {
      const result = runNode(cli, [
        'validate',
        '--inventory',
        join(repositoryRoot, 'tests/fixtures/python-supply-chain/inventories', name),
      ]);
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it('accepts one complete Windows graph mixing universal and CPython platform wheels', () => {
    const targetDescriptor = target('windows', 'x86_64', ['win_amd64']);
    const universal = buildWheel(artifactRoot, 'quality-root', 'py3-none-any', {
      requires: ['quality-native==1.0.0'],
      noNative: true,
    });
    const native = buildWheel(artifactRoot, 'quality-native', 'cp312-cp312-win_amd64');
    const document = inventory(targetDescriptor, [
      artifact(universal, targetDescriptor, {
        direct: true,
        dependencies: [purl('quality-native')],
        requirements: ['quality-native==1.0.0'],
      }),
      artifact(native, targetDescriptor, { direct: false }),
    ]);
    const path = join(directory, 'windows.json');
    writeFileSync(path, JSON.stringify(document));
    const result = verify(path, artifactRoot);
    expect(result.status, result.stderr).toBe(0);
    expect(document.packages).toHaveLength(2);
  });

  it('accepts one Linux graph with universal and compressed manylinux platform tags', () => {
    const targetDescriptor = target('linux', 'x86_64', [
      'manylinux_2_17_x86_64',
      'manylinux2014_x86_64',
      'linux_x86_64',
    ]);
    const universal = buildWheel(artifactRoot, 'quality-root', 'py3-none-any', {
      requires: ['quality-native==1.0.0'],
      noNative: true,
    });
    const native = buildWheel(
      artifactRoot,
      'quality-native',
      'cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64',
      { nativeName: 'libnative.so' },
    );
    const nativeArtifact = artifact(native, targetDescriptor, { direct: false });
    expect(nativeArtifact.wheel_tags).toHaveLength(2);
    expect(nativeArtifact.compatibility.matched_tags).toHaveLength(2);
    const document = inventory(targetDescriptor, [
      artifact(universal, targetDescriptor, {
        direct: true,
        dependencies: [purl('quality-native')],
        requirements: ['quality-native==1.0.0'],
      }),
      nativeArtifact,
    ]);
    const path = join(directory, 'linux.json');
    writeFileSync(path, JSON.stringify(document));
    const result = verify(path, artifactRoot);
    expect(result.status, result.stderr).toBe(0);
  });

  it('accepts CPython 3.9 abi3 and compressed py2.py3 wheels on CPython 3.12', () => {
    const targetDescriptor = target('windows', 'x86_64', ['win_amd64']);
    const universal = buildWheel(artifactRoot, 'quality-root', 'py2.py3-none-any', {
      requires: ['quality-abi3==1.0.0'],
      noNative: true,
    });
    const abi3 = buildWheel(artifactRoot, 'quality-abi3', 'cp39-abi3-win_amd64');
    const rootArtifact = artifact(universal, targetDescriptor, {
      direct: true,
      dependencies: [purl('quality-abi3')],
      requirements: ['quality-abi3==1.0.0'],
    });
    const abi3Artifact = artifact(abi3, targetDescriptor, { direct: false });
    expect(rootArtifact.wheel_tags).toEqual(['py2-none-any', 'py3-none-any']);
    expect(rootArtifact.compatibility.matched_tags).toEqual(['py3-none-any']);
    expect(abi3Artifact.compatibility.matched_tags).toContain('cp39-abi3-win_amd64');
    const path = join(directory, 'abi3.json');
    writeFileSync(path, JSON.stringify(inventory(targetDescriptor, [rootArtifact, abi3Artifact])));
    const result = verify(path, artifactRoot);
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    ['wrong OS', 'cp312-cp312-manylinux_2_17_x86_64'],
    ['wrong CPU', 'cp312-cp312-win_arm64'],
    ['wrong Python', 'cp313-cp313-win_amd64'],
    ['wrong ABI', 'cp312-cp311-win_amd64'],
  ])('fails closed for %s wheel compatibility', (_label, wheelTag) => {
    const targetDescriptor = target('windows', 'x86_64', ['win_amd64']);
    const metadata = buildWheel(artifactRoot, 'quality-incompatible', wheelTag);
    const incompatible = artifact(metadata, targetDescriptor, { direct: true });
    incompatible.compatibility = { status: 'COMPATIBLE', matched_tags: ['py3-none-any'] };
    const path = join(directory, 'incompatible.json');
    writeFileSync(path, JSON.stringify(inventory(targetDescriptor, [incompatible])));
    const result = verify(path, artifactRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/incompatible|compatibility evidence/u);
  });

  it('keeps v1 readable and migrates it explicitly to a verified v2 target', () => {
    const metadata = buildWheel(artifactRoot, 'quality-legacy', 'cp312-cp312-win_amd64');
    const legacy = {
      schema_version: '1',
      inventory_id: 'code-f-legacy-v1',
      scope: 'PRODUCTION_WORKER_RUNTIME',
      target: {
        python_version: '3.12',
        python_tag: 'cp312',
        abi_tag: 'cp312',
        platform_tag: 'win_amd64',
      },
      graph_complete: true,
      packages: [
        {
          ...artifact(metadata, target('windows', 'x86_64', ['win_amd64']), { direct: true }),
          python_version: '3.12',
          python_tag: 'cp312',
          abi_tag: 'cp312',
          platform_tag: 'win_amd64',
        },
      ],
    } as Record<string, unknown>;
    const legacyArtifact = (legacy.packages as Array<Record<string, unknown>>)[0]!;
    delete legacyArtifact.wheel_tags;
    delete legacyArtifact.compatibility;
    const legacyPath = join(directory, 'legacy.json');
    writeFileSync(legacyPath, JSON.stringify(legacy));
    expect(verify(legacyPath, artifactRoot).status).toBe(0);

    const targetPath = join(directory, 'target.json');
    writeFileSync(targetPath, JSON.stringify(target('windows', 'x86_64', ['win_amd64'])));
    const migratedPath = join(directory, 'migrated.json');
    const migrated = runNode(migrationTool, [
      '--inventory',
      legacyPath,
      '--target-descriptor',
      targetPath,
      '--output',
      migratedPath,
    ]);
    expect(migrated.status, migrated.stderr).toBe(0);
    expect(verify(migratedPath, artifactRoot).status).toBe(0);
    expect(JSON.parse(readFileSync(migratedPath, 'utf8'))).toMatchObject({ schema_version: '2' });
  });

  it('uses the shared engine for v2 candidate generation and verifier evidence', () => {
    const targetDescriptor = target('windows', 'x86_64', ['win_amd64']);
    const metadata = buildWheel(artifactRoot, 'quality-candidate', 'py3-none-any', {
      noNative: true,
    });
    const targetPath = join(directory, 'target.json');
    const candidatePath = join(directory, 'candidate.json');
    writeFileSync(targetPath, JSON.stringify(targetDescriptor));
    const generated = runNode(candidateTool, [
      '--artifact-root',
      artifactRoot,
      '--scope',
      'PRODUCTION_WORKER_RUNTIME',
      '--schema-version',
      '2',
      '--target-descriptor',
      targetPath,
      '--inventory-id',
      'code-f-v2-candidate',
      '--source-index',
      'https://pypi.org/simple',
      '--source-base',
      'https://example.invalid/projects',
      '--download-base',
      'https://example.invalid/artifacts',
      '--supplier',
      'Synthetic fixture',
      '--direct',
      metadata.package_name,
      '--output',
      candidatePath,
    ]);
    expect(generated.status, generated.stderr).toBe(0);
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
    expect(candidate).toMatchObject({
      schema_version: '2',
      graph_complete: false,
      packages: [
        {
          wheel_tags: ['py3-none-any'],
          compatibility: { status: 'COMPATIBLE', matched_tags: ['py3-none-any'] },
          provenance: { review_status: 'PENDING' },
        },
      ],
    });
    const rejected = verify(candidatePath, artifactRoot);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('inventory schema invalid');
  });

  it('preserves hash, SBOM, license, vulnerability and native reconciliation bindings', () => {
    const targetDescriptor = target('windows', 'x86_64', ['win_amd64']);
    const universal = buildWheel(artifactRoot, 'quality-root', 'py3-none-any', {
      requires: ['quality-native==1.0.0'],
      noNative: true,
    });
    const native = buildWheel(artifactRoot, 'quality-native', 'cp312-cp312-win_amd64');
    const document = inventory(targetDescriptor, [
      artifact(universal, targetDescriptor, {
        direct: true,
        dependencies: [purl('quality-native')],
        requirements: ['quality-native==1.0.0'],
      }),
      artifact(native, targetDescriptor, { direct: false }),
    ]);
    const inventoryPath = join(directory, 'downstream.json');
    writeFileSync(inventoryPath, JSON.stringify(document));
    expect(verify(inventoryPath, artifactRoot).status).toBe(0);

    const requirementsPath = join(directory, 'requirements.lock');
    const locked = runNode(requireHashesTool, [
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--output',
      requirementsPath,
    ]);
    expect(locked.status, locked.stderr).toBe(0);
    const requirements = readFileSync(requirementsPath, 'utf8');
    expect(requirements).toContain('--require-hashes');
    expect(requirements).toContain(native.filename);
    expect(requirements).toContain(native.wheel_sha256);

    const license = runNode(cli, [
      'license',
      '--release',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(license.status, license.stderr).toBe(0);

    const osvPath = join(directory, 'osv.json');
    writeFileSync(
      osvPath,
      JSON.stringify({
        schema_version: '1',
        results: document.packages.map((entry) => ({
          purl: entry.purl,
          vulnerabilities: [],
        })),
      }),
    );
    const vulnerability = runNode(cli, [
      'vulnerability',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--offline-osv',
      osvPath,
    ]);
    expect(vulnerability.status, vulnerability.stderr).toBe(0);

    const sbomPath = join(directory, 'SBOM.cdx.json');
    const sbom = runNode(sbomTool, ['--output', sbomPath, '--python-inventory', inventoryPath]);
    expect(sbom.status, sbom.stderr).toBe(0);
    const nativeComponent = (
      JSON.parse(readFileSync(sbomPath, 'utf8')).components as Array<{
        purl?: string;
        hashes?: Array<{ content: string }>;
        properties?: Array<{ name: string; value: string }>;
      }>
    ).find((entry) => entry.purl === purl('quality-native'));
    expect(nativeComponent?.hashes?.[0]?.content).toBe(native.wheel_sha256);
    expect(nativeComponent?.properties).toEqual(
      expect.arrayContaining([
        { name: 'com.company.python.target_os', value: 'windows' },
        { name: 'com.company.python.compatibility_engine_version', value: '1' },
      ]),
    );

    const packagedRoot = join(directory, 'packaged');
    mkdirSync(join(packagedRoot, 'runtime'), { recursive: true });
    writeFileSync(join(packagedRoot, 'runtime/native.pyd'), 'synthetic-native-fixture-v1');
    const packagedInventory = join(directory, 'packaged.json');
    const scanned = runNode(cli, [
      'native-inventory',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-root',
      packagedRoot,
      '--inventory-id',
      'code-f-v2-packaged',
      '--output',
      packagedInventory,
    ]);
    expect(scanned.status, scanned.stderr).toBe(0);
    const reconciled = runNode(cli, [
      'reconcile',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-inventory',
      packagedInventory,
    ]);
    expect(reconciled.status, reconciled.stderr).toBe(0);

    document.packages[1]!.sha256 = '0'.repeat(64);
    writeFileSync(inventoryPath, JSON.stringify(document));
    const wrongHash = verify(inventoryPath, artifactRoot);
    expect(wrongHash.status).toBe(1);
    expect(wrongHash.stderr).toContain('wheel hash mismatch');
  });
});
