import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePythonExecutable } from '../helpers/python-runtime.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const cli = join(repositoryRoot, 'tools/python-supply-chain/cli.mjs');
const candidateTool = join(repositoryRoot, 'tools/python-supply-chain/create-candidate.mjs');
const fixtureBuilder = join(repositoryRoot, 'tests/fixtures/python-supply-chain/build_fixture.py');
const sbomGenerator = join(repositoryRoot, 'tools/compliance/generate-sbom.mjs');
const python = resolvePythonExecutable();

interface FixtureMetadata {
  filename: string;
  package_name: string;
  wheel_sha256: string;
  license_path: string;
  license_sha256: string;
  native_path: string;
  native_sha256: string;
}

function runTool(argumentsValue: string[]) {
  return spawnSync(process.execPath, [cli, ...argumentsValue], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, PYTHON_EXECUTABLE: python },
  });
}

function inventory(metadata: FixtureMetadata, overrides: Record<string, unknown> = {}) {
  const normalizedName = metadata.package_name.toLowerCase().replaceAll(/[-_.]+/gu, '-');
  const artifact = {
    package_name: metadata.package_name,
    version: '1.0.0',
    artifact_type: 'wheel',
    filename: metadata.filename,
    artifact_path: metadata.filename,
    sha256: metadata.wheel_sha256,
    source: `https://example.invalid/${normalizedName}`,
    source_index: 'https://pypi.org/simple',
    python_version: '3.12',
    python_tag: 'cp312',
    abi_tag: 'cp312',
    platform_tag: 'win_amd64',
    purl: `pkg:pypi/${normalizedName}@1.0.0`,
    license_expression: 'MIT',
    license_files: [{ relative_path: metadata.license_path, sha256: metadata.license_sha256 }],
    native_artifacts: [
      {
        filename: 'native.pyd',
        relative_path: metadata.native_path,
        packaged_relative_path: 'runtime/native.pyd',
        sha256: metadata.native_sha256,
        type: 'pyd',
        source_package: metadata.package_name,
      },
    ],
    provenance: {
      supplier: 'Synthetic Code F fixture',
      download_url: `https://example.invalid/artifacts/${metadata.filename}`,
      review_status: 'APPROVED',
      reviewed_at: '2026-08-28T00:00:00Z',
      upstream_signature: null,
      notes: 'Synthetic fixture only',
    },
    direct: true,
    dependencies: [],
    dependency_declarations: [],
    ...overrides,
  };
  return {
    schema_version: '1',
    inventory_id: 'code-f-synthetic-win312-runtime',
    scope: 'PRODUCTION_WORKER_RUNTIME',
    target: {
      python_version: '3.12',
      python_tag: 'cp312',
      abi_tag: 'cp312',
      platform_tag: 'win_amd64',
    },
    graph_complete: true,
    packages: [artifact],
  };
}

describe('Python/native supply-chain gates', () => {
  let directory: string;
  let artifactRoot: string;
  let metadata: FixtureMetadata;
  let inventoryPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'python-supply-chain-'));
    artifactRoot = join(directory, 'wheels');
    mkdirSync(artifactRoot);
    const built = spawnSync(python, [fixtureBuilder, artifactRoot], {
      encoding: 'utf8',
      shell: false,
    });
    expect(built.status, built.stderr).toBe(0);
    metadata = JSON.parse(built.stdout) as FixtureMetadata;
    inventoryPath = join(directory, 'inventory.json');
    writeFileSync(inventoryPath, `${JSON.stringify(inventory(metadata), null, 2)}\n`);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('accepts a complete hash-locked wheel and rejects missing/wrong hashes', () => {
    const valid = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain('1 hash-verified wheels');

    const missing = inventory(metadata);
    delete (missing.packages[0] as Record<string, unknown>).sha256;
    writeFileSync(inventoryPath, JSON.stringify(missing));
    const missingResult = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(missingResult.status).toBe(1);
    expect(missingResult.stderr).toContain("must have required property 'sha256'");

    writeFileSync(inventoryPath, JSON.stringify(inventory(metadata, { sha256: '0'.repeat(64) })));
    const wrong = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('wheel hash mismatch');
  });

  it('creates an explicit review candidate that CI cannot auto-approve', () => {
    const candidatePath = join(directory, 'candidate.json');
    const generated = spawnSync(
      process.execPath,
      [
        candidateTool,
        '--artifact-root',
        artifactRoot,
        '--scope',
        'PRODUCTION_WORKER_RUNTIME',
        '--python-version',
        '3.12',
        '--python-tag',
        'cp312',
        '--abi-tag',
        'cp312',
        '--platform-tag',
        'win_amd64',
        '--inventory-id',
        'candidate-fixture',
        '--source-index',
        'https://pypi.org/simple',
        '--source-base',
        'https://example.invalid/projects',
        '--download-base',
        'https://example.invalid/artifacts',
        '--supplier',
        'Synthetic fixture',
        '--direct',
        'quality-fixture',
        '--output',
        candidatePath,
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        shell: false,
        env: { ...process.env, PYTHON_EXECUTABLE: python },
      },
    );
    expect(generated.status, generated.stderr).toBe(0);
    const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as {
      graph_complete: boolean;
      packages: Array<{ provenance: { review_status: string } }>;
    };
    expect(candidate.graph_complete).toBe(false);
    expect(candidate.packages[0]?.provenance.review_status).toBe('PENDING');
    const verification = runTool([
      'verify',
      '--inventory',
      candidatePath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(verification.status).toBe(1);
    expect(verification.stderr).toContain('inventory schema invalid');
  });

  it('rejects an undeclared wheel and unknown/conflicting license metadata', () => {
    copyFileSync(
      join(artifactRoot, metadata.filename),
      join(artifactRoot, 'undeclared-1.0.0-py3-none-any.whl'),
    );
    const unknownWheel = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(unknownWheel.status).toBe(1);
    expect(unknownWheel.stderr).toContain('undeclared wheel in artifact root');

    rmSync(join(artifactRoot, 'undeclared-1.0.0-py3-none-any.whl'));
    writeFileSync(
      inventoryPath,
      JSON.stringify(inventory(metadata, { license_expression: 'UNKNOWN' })),
    );
    const unknownLicense = runTool([
      'license',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(unknownLicense.status).toBe(1);
    expect(unknownLicense.stderr).toMatch(
      /conflicts with inventory|rejected\/unknown license|SPDX parser rejected expression|artifact license evidence conflict/u,
    );
  });

  it('binds OSV findings to scope, wheel hash and dependency path', () => {
    rmSync(join(artifactRoot, metadata.filename));
    const rebuiltRoot = spawnSync(
      python,
      [fixtureBuilder, artifactRoot, '--requires', 'quality-transitive==1.0.0'],
      { encoding: 'utf8', shell: false },
    );
    expect(rebuiltRoot.status, rebuiltRoot.stderr).toBe(0);
    metadata = JSON.parse(rebuiltRoot.stdout) as FixtureMetadata;
    const builtTransitive = spawnSync(
      python,
      [fixtureBuilder, artifactRoot, '--name', 'quality-transitive'],
      { encoding: 'utf8', shell: false },
    );
    expect(builtTransitive.status, builtTransitive.stderr).toBe(0);
    const transitiveMetadata = JSON.parse(builtTransitive.stdout) as FixtureMetadata;
    const graph = inventory(metadata);
    graph.packages[0]!.dependencies = ['pkg:pypi/quality-transitive@1.0.0'];
    graph.packages[0]!.dependency_declarations = [
      {
        requirement: 'quality-transitive==1.0.0',
        package_name: 'quality-transitive',
        disposition: 'INCLUDED',
        purl: 'pkg:pypi/quality-transitive@1.0.0',
        reason: '',
      },
    ];
    const transitivePackage = inventory(transitiveMetadata).packages[0]!;
    transitivePackage.direct = false;
    graph.packages.push(transitivePackage);
    writeFileSync(inventoryPath, JSON.stringify(graph));
    const osvPath = join(directory, 'osv.json');
    writeFileSync(
      osvPath,
      JSON.stringify({
        schema_version: '1',
        results: [
          {
            purl: 'pkg:pypi/quality-fixture@1.0.0',
            vulnerabilities: [],
          },
          {
            purl: 'pkg:pypi/quality-transitive@1.0.0',
            vulnerabilities: [
              {
                id: 'PYSEC-CODE-F-1',
                modified: '2026-08-28T00:00:00Z',
                summary: 'Synthetic vulnerable dependency fixture',
                aliases: ['CVE-2099-0001'],
                severity: [
                  { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
                ],
                affected: [
                  {
                    package: { ecosystem: 'PyPI', name: 'quality-transitive' },
                    ranges: [
                      { type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '1.0.1' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const reportPath = join(directory, 'vulnerabilities.json');
    const result = runTool([
      'vulnerability',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--offline-osv',
      osvPath,
      '--report',
      reportPath,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PYSEC-CODE-F-1');
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(report.findings[0]).toMatchObject({
      scope: 'PRODUCTION_WORKER_RUNTIME',
      artifact_sha256: transitiveMetadata.wheel_sha256,
      dependency_paths: [['pkg:pypi/quality-fixture@1.0.0', 'pkg:pypi/quality-transitive@1.0.0']],
    });
  });

  it('reconciles expected native files and rejects an unexpected packaged DLL', () => {
    const packagedRoot = join(directory, 'packaged-worker');
    mkdirSync(join(packagedRoot, 'runtime'), { recursive: true });
    writeFileSync(join(packagedRoot, 'runtime/native.pyd'), 'synthetic-native-fixture-v1');
    const packagedInventory = join(directory, 'packaged-native.json');
    const generated = runTool([
      'native-inventory',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-root',
      packagedRoot,
      '--inventory-id',
      'synthetic-packaged-worker',
      '--output',
      packagedInventory,
    ]);
    expect(generated.status, generated.stderr).toBe(0);
    const reconciled = runTool([
      'reconcile',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-inventory',
      packagedInventory,
    ]);
    expect(reconciled.status, reconciled.stderr).toBe(0);

    const tamperedDocument = JSON.parse(readFileSync(packagedInventory, 'utf8')) as {
      source_inventory_ids: string[];
      native_artifacts: Array<Record<string, unknown>>;
    };
    tamperedDocument.source_inventory_ids = ['stale-inventory-id'];
    tamperedDocument.native_artifacts[0]!.source_package = 'wrong-owner';
    tamperedDocument.native_artifacts.push({ ...tamperedDocument.native_artifacts[0]! });
    writeFileSync(packagedInventory, JSON.stringify(tamperedDocument));
    const tampered = runTool([
      'reconcile',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-inventory',
      packagedInventory,
    ]);
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toMatch(
      /source_inventory_ids do not match|owner mismatch|duplicate packaged native/u,
    );

    writeFileSync(join(packagedRoot, 'runtime/unexpected.dll'), 'unexpected-native');
    const unexpectedInventory = join(directory, 'unexpected-native.json');
    const scanned = runTool([
      'native-inventory',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-root',
      packagedRoot,
      '--inventory-id',
      'synthetic-packaged-worker-unexpected',
      '--output',
      unexpectedInventory,
    ]);
    expect(scanned.status, scanned.stderr).toBe(0);
    const unexpected = runTool([
      'reconcile',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
      '--packaged-inventory',
      unexpectedInventory,
    ]);
    expect(unexpected.status).toBe(1);
    expect(unexpected.stderr).toContain('unexpected packaged native artifact');
  });

  it('emits wheel and native hashes in CycloneDX and keeps scope separation', () => {
    const output = join(directory, 'SBOM.cdx.json');
    const result = spawnSync(
      process.execPath,
      [sbomGenerator, '--output', output, '--python-inventory', inventoryPath],
      { cwd: repositoryRoot, encoding: 'utf8', shell: false },
    );
    expect(result.status, result.stderr).toBe(0);
    const bom = JSON.parse(readFileSync(output, 'utf8')) as {
      components: Array<Record<string, unknown>>;
    };
    expect(bom.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purl: 'pkg:pypi/quality-fixture@1.0.0',
          hashes: [{ alg: 'SHA-256', content: metadata.wheel_sha256 }],
          properties: expect.arrayContaining([
            { name: 'com.company.python.scope', value: 'PRODUCTION_WORKER_RUNTIME' },
            { name: 'com.company.python.platform_tag', value: 'win_amd64' },
          ]),
        }),
        expect.objectContaining({
          name: 'native.pyd',
          hashes: [{ alg: 'SHA-256', content: metadata.native_sha256 }],
        }),
      ]),
    );
  });

  it('fails closed for sdist/VCS inputs and production torch while allowing export scope', () => {
    writeFileSync(
      inventoryPath,
      JSON.stringify(
        inventory(metadata, {
          artifact_type: 'sdist',
          filename: 'quality-fixture-latest.tar.gz',
          provenance: {
            supplier: 'fixture',
            download_url: 'https://example.invalid/refs/heads/main/quality-fixture.tar.gz',
            review_status: 'APPROVED',
            reviewed_at: '2026-08-28T00:00:00Z',
          },
        }),
      ),
    );
    const sdist = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(sdist.status).toBe(1);
    expect(sdist.stderr).toMatch(/artifact_type sdist|floating\/VCS/u);

    rmSync(join(artifactRoot, metadata.filename));
    const torchBuilt = spawnSync(python, [fixtureBuilder, artifactRoot, '--name', 'torch'], {
      encoding: 'utf8',
      shell: false,
    });
    expect(torchBuilt.status, torchBuilt.stderr).toBe(0);
    const torchMetadata = JSON.parse(torchBuilt.stdout) as FixtureMetadata;
    const productionTorch = inventory(torchMetadata);
    writeFileSync(inventoryPath, JSON.stringify(productionTorch));
    const blocked = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('forbidden in production worker scope');

    productionTorch.scope = 'MODEL_EXPORT';
    writeFileSync(inventoryPath, JSON.stringify(productionTorch));
    const exportScope = runTool([
      'verify',
      '--inventory',
      inventoryPath,
      '--artifact-root',
      artifactRoot,
    ]);
    expect(exportScope.status, exportScope.stderr).toBe(0);
  });
});
