import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePythonExecutable } from '../helpers/python-runtime.js';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const cli = join(repositoryRoot, 'tools/python-supply-chain/cli.mjs');
const wheelBuilder = join(repositoryRoot, 'tests/fixtures/python-supply-chain/build_fixture.py');
const onefileBuilder = join(
  repositoryRoot,
  'tests/fixtures/python-supply-chain/build_onefile_fixture.py',
);
const onefileInspector = join(
  repositoryRoot,
  'tools/python-supply-chain/inspect-pyinstaller-onefile.py',
);
const sbomGenerator = join(repositoryRoot, 'tools/compliance/generate-sbom.mjs');
const sitePackages = join(repositoryRoot, 'artifacts/python-compliance-tools/site-packages');
const python = resolvePythonExecutable();

interface WheelFixture {
  filename: string;
  package_name: string;
  wheel_sha256: string;
  license_path: string;
  license_sha256: string;
  native_path: string;
  native_sha256: string;
}

interface InspectionFixture {
  bootloader_layer: { sha256: string };
  archive_payload: { sha256: string };
  final_artifact: { sha256: string };
}

interface PackagedFixture {
  schema_version: string;
  native_artifacts: Array<{ owner_reference: string }>;
  bootloader_layer: { sha256: string; source_artifact_sha256: string };
  archive_payload: { sha256: string };
  final_artifact: { sha256: string };
}

function hash(value: Buffer | string): string {
  const content = typeof value === 'string' ? readFileSync(value) : value;
  return createHash('sha256').update(content).digest('hex');
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function pythonEnvironment() {
  return {
    ...process.env,
    PYTHON_EXECUTABLE: python,
    PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
}

function runNode(argumentsValue: string[]) {
  return spawnSync(process.execPath, argumentsValue, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    env: pythonEnvironment(),
  });
}

function component(
  id: string,
  kind: string,
  name: string,
  version: string,
  filename: string,
  sha256: string,
  usageScopes: string[],
  packagedNativeArtifacts: unknown[] = [],
) {
  return {
    component_id: id,
    component_kind: kind,
    name,
    version,
    usage_scopes: usageScopes,
    platform: 'windows',
    architecture: 'x86_64',
    artifact: {
      artifact_type:
        kind === 'CPYTHON_DISTRIBUTION'
          ? 'distribution'
          : kind === 'PYINSTALLER_BOOTLOADER'
            ? 'bootloader'
            : 'wheel',
      filename,
      artifact_path: filename,
      sha256,
      canonical_reference: `https://example.invalid/artifacts/${filename}`,
      canonical_source: 'https://example.invalid/source',
    },
    provenance: {
      supplier: 'Synthetic Code F fixture',
      review_status: 'APPROVED',
      reviewed_at: '2026-08-28T00:00:00Z',
      notes: 'Synthetic regression only',
    },
    license: {
      expression:
        kind === 'PYINSTALLER' || kind === 'PYINSTALLER_BOOTLOADER'
          ? 'GPL-2.0-or-later WITH Bootloader-exception'
          : 'PSF-2.0',
      files: [{ relative_path: 'LICENSE.txt', sha256: '1'.repeat(64) }],
      review_status: 'APPROVED',
      redistribution_evidence: 'https://example.invalid/license-review',
    },
    vulnerability: {
      source_type: kind === 'CPYTHON_DISTRIBUTION' ? 'NVD' : 'OSV',
      data_source: kind === 'CPYTHON_DISTRIBUTION' ? 'https://nvd.nist.gov/' : 'https://osv.dev/',
      review_status: 'APPROVED',
      reviewed_at: '2026-08-28T00:00:00Z',
      review_expires_at: '2027-08-28T00:00:00Z',
      advisory_ids: [],
      unsupported_policy: 'No result is not clean; manual review is required before expiry.',
    },
    reason_included: 'Required by the synthetic Windows one-file build.',
    packaged_native_artifacts: packagedNativeArtifacts,
    dependencies: [],
  };
}

describe('packaged native / Python toolchain provenance v2', () => {
  let directory: string;
  let wheelRoot: string;
  let toolchainRoot: string;
  let buildRoot: string;
  let inventoryPath: string;
  let toolchainPath: string;
  let buildPath: string;
  let packagedPath: string;
  let numpy: WheelFixture;
  let onnx: WheelFixture;
  let toolchain: Record<string, unknown>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onefile-provenance-'));
    wheelRoot = join(directory, 'wheels');
    toolchainRoot = join(directory, 'toolchain');
    buildRoot = join(directory, 'build');
    mkdirSync(wheelRoot);
    mkdirSync(toolchainRoot);
    mkdirSync(buildRoot);
    const buildWheel = (name: string, nativeName: string): WheelFixture => {
      const result = spawnSync(
        python,
        [wheelBuilder, wheelRoot, '--name', name, '--native-name', nativeName],
        { encoding: 'utf8', shell: false, env: pythonEnvironment() },
      );
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as WheelFixture;
    };
    numpy = buildWheel('numpy-fixture', '_multiarray_umath.pyd');
    onnx = buildWheel('onnxruntime-fixture', 'onnxruntime_providers_shared.dll');
    const wheelRecord = (fixture: WheelFixture, packagedPathValue: string) => ({
      package_name: fixture.package_name,
      version: '1.0.0',
      artifact_type: 'wheel',
      filename: fixture.filename,
      artifact_path: fixture.filename,
      sha256: fixture.wheel_sha256,
      source: `https://example.invalid/${fixture.package_name}`,
      source_index: 'https://pypi.org/simple',
      python_version: '3.12',
      python_tag: 'cp312',
      abi_tag: 'cp312',
      platform_tag: 'win_amd64',
      purl: `pkg:pypi/${fixture.package_name}@1.0.0`,
      license_expression: 'MIT',
      license_files: [{ relative_path: fixture.license_path, sha256: fixture.license_sha256 }],
      native_artifacts: [
        {
          filename: packagedPathValue.split('/').at(-1),
          relative_path: fixture.native_path,
          packaged_relative_path: packagedPathValue,
          sha256: fixture.native_sha256,
          type: packagedPathValue.endsWith('.pyd') ? 'pyd' : 'dll',
          source_package: fixture.package_name,
        },
      ],
      provenance: {
        supplier: 'Synthetic Code F fixture',
        download_url: `https://example.invalid/artifacts/${fixture.filename}`,
        review_status: 'APPROVED',
        reviewed_at: '2026-08-28T00:00:00Z',
        upstream_signature: null,
        notes: 'Synthetic fixture only',
      },
      direct: true,
      dependencies: [],
      dependency_declarations: [],
    });
    inventoryPath = join(directory, 'wheel-inventory.json');
    writeJson(inventoryPath, {
      schema_version: '1',
      inventory_id: 'fixture-windows-worker-wheels',
      scope: 'PRODUCTION_WORKER_RUNTIME',
      target: {
        python_version: '3.12',
        python_tag: 'cp312',
        abi_tag: 'cp312',
        platform_tag: 'win_amd64',
      },
      graph_complete: true,
      packages: [
        wheelRecord(numpy, 'numpy/_multiarray_umath.pyd'),
        wheelRecord(onnx, 'onnxruntime/capi/onnxruntime_providers_shared.dll'),
      ],
    });
    const artifacts = {
      cpython: Buffer.from('approved-cpython-3.12.10-distribution'),
      pip: Buffer.from('approved-pip-wheel'),
      pyinstaller: Buffer.from('approved-pyinstaller-wheel'),
      bootloader: Buffer.from('MZ-approved-pyinstaller-windows-x64-bootloader'),
      pythonDll: Buffer.from('approved-python312-runtime-bytes'),
    };
    for (const [name, value] of Object.entries(artifacts)) {
      writeFileSync(join(toolchainRoot, `${name}.bin`), value);
    }
    toolchain = {
      schema_version: '1',
      inventory_id: 'fixture-windows-python-toolchain',
      target: {
        implementation: 'cpython',
        python_version: '3.12.10',
        os: 'windows',
        architecture: 'x86_64',
      },
      graph_complete: true,
      components: [
        component(
          'cpython-3.12.10-windows-x64',
          'CPYTHON_DISTRIBUTION',
          'CPython',
          '3.12.10',
          'cpython.bin',
          hash(join(toolchainRoot, 'cpython.bin')),
          ['BUILD_TOOLCHAIN_COMPONENT', 'PACKAGED_RUNTIME_COMPONENT'],
          [
            {
              filename: 'python312.dll',
              internal_path: 'python312.dll',
              sha256: hash(artifacts.pythonDll),
              size: artifacts.pythonDll.length,
              type: 'dll',
              reason_included: 'CPython runtime required by the frozen worker.',
              build_layer: 'CARCHIVE_PAYLOAD',
            },
          ],
        ),
        component(
          'pip-25.2-build-only',
          'PIP',
          'pip',
          '25.2',
          'pip.bin',
          hash(join(toolchainRoot, 'pip.bin')),
          ['BUILD_TOOLCHAIN_COMPONENT'],
        ),
        component(
          'pyinstaller-6.22.2-build',
          'PYINSTALLER',
          'PyInstaller',
          '6.22.2',
          'pyinstaller.bin',
          hash(join(toolchainRoot, 'pyinstaller.bin')),
          ['BUILD_TOOLCHAIN_COMPONENT'],
        ),
        component(
          'pyinstaller-6.22.2-bootloader-win-x64',
          'PYINSTALLER_BOOTLOADER',
          'PyInstaller Bootloader',
          '6.22.2',
          'bootloader.bin',
          hash(join(toolchainRoot, 'bootloader.bin')),
          ['BUILD_TOOLCHAIN_COMPONENT', 'PACKAGED_RUNTIME_COMPONENT'],
        ),
      ],
    };
    toolchainPath = join(directory, 'toolchain-inventory.json');
    writeJson(toolchainPath, toolchain);
    writeFileSync(join(buildRoot, 'worker.spec'), 'synthetic one-file build spec\n');
    writeFileSync(join(buildRoot, 'python312.dll'), artifacts.pythonDll);
    writeFileSync(
      join(buildRoot, '_multiarray_umath.pyd'),
      Buffer.from('synthetic-native-fixture-v1'),
    );
    writeFileSync(
      join(buildRoot, 'onnxruntime_providers_shared.dll'),
      Buffer.from('synthetic-native-fixture-v1'),
    );
    buildPath = join(directory, 'build-provenance.json');
    packagedPath = join(directory, 'packaged-native.json');
    createBuild([
      ['python312.dll', join(buildRoot, 'python312.dll')],
      ['numpy/_multiarray_umath.pyd', join(buildRoot, '_multiarray_umath.pyd')],
      [
        'onnxruntime/capi/onnxruntime_providers_shared.dll',
        join(buildRoot, 'onnxruntime_providers_shared.dll'),
      ],
    ]);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function createBuild(entries: Array<[string, string]>, finalName = 'media-worker.exe'): void {
    const finalPath = join(buildRoot, finalName);
    const argumentsValue = [
      onefileBuilder,
      '--output',
      finalPath,
      '--bootloader',
      join(toolchainRoot, 'bootloader.bin'),
      ...entries.flatMap(([internalPath, source]) => ['--entry', `${internalPath}=${source}`]),
    ];
    const built = spawnSync(python, argumentsValue, {
      encoding: 'utf8',
      shell: false,
      env: pythonEnvironment(),
    });
    expect(built.status, built.stderr).toBe(0);
    const inspected = spawnSync(python, [onefileInspector, finalPath], {
      encoding: 'utf8',
      shell: false,
      env: pythonEnvironment(),
    });
    expect(inspected.status, inspected.stderr).toBe(0);
    const layers = JSON.parse(inspected.stdout) as InspectionFixture;
    writeJson(buildPath, {
      schema_version: '1',
      build_id: `fixture-${finalName.replaceAll('.', '-')}`,
      build_commit_sha: '493de878db59eff1f699ab5a722662cac32eef44',
      build_timestamp: '2026-08-28T00:00:00Z',
      run_identity: 'synthetic-regression-run-12',
      target: { os: 'windows', architecture: 'x86_64', python_version: '3.12.10' },
      build_configuration: {
        path: 'worker.spec',
        sha256: hash(join(buildRoot, 'worker.spec')),
      },
      inputs: {
        wheel_inventories: [
          {
            inventory_id: 'fixture-windows-worker-wheels',
            manifest_path: 'wheel-inventory.json',
            manifest_sha256: hash(inventoryPath),
          },
        ],
        toolchain_inventory: {
          inventory_id: 'fixture-windows-python-toolchain',
          manifest_path: 'toolchain-inventory.json',
          manifest_sha256: hash(toolchainPath),
        },
        cpython_component_id: 'cpython-3.12.10-windows-x64',
        pip_component_id: 'pip-25.2-build-only',
        pyinstaller_component_id: 'pyinstaller-6.22.2-build',
        bootloader_component_id: 'pyinstaller-6.22.2-bootloader-win-x64',
      },
      output_layers: {
        bootloader_sha256: layers.bootloader_layer.sha256,
        archive_payload_sha256: layers.archive_payload.sha256,
      },
      final_artifact: {
        artifact_type: 'PYINSTALLER_ONEFILE',
        filename: finalName,
        artifact_path: finalName,
        sha256: layers.final_artifact.sha256,
      },
      bit_for_bit_reproducible_build_required: false,
    });
  }

  function v2Arguments() {
    return [
      '--inventory',
      inventoryPath,
      '--artifact-root',
      wheelRoot,
      '--toolchain-inventory',
      toolchainPath,
      '--toolchain-artifact-root',
      toolchainRoot,
      '--build-provenance',
      buildPath,
      '--build-root',
      buildRoot,
    ];
  }

  it('reconciles Windows one-file bytes to exact wheel/toolchain owners and final build', () => {
    const inventory = runNode([
      cli,
      'native-inventory',
      ...v2Arguments(),
      '--inventory-id',
      'fixture-packaged-native-v2',
      '--output',
      packagedPath,
    ]);
    expect(inventory.status, inventory.stderr).toBe(0);
    const packaged = JSON.parse(readFileSync(packagedPath, 'utf8')) as PackagedFixture;
    expect(packaged.schema_version).toBe('2');
    expect(packaged.native_artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          internal_path: 'python312.dll',
          owner_kind: 'TOOLCHAIN_OWNED_NATIVE',
          owner_reference: 'cpython-3.12.10-windows-x64',
        }),
        expect.objectContaining({
          internal_path: 'numpy/_multiarray_umath.pyd',
          owner_kind: 'WHEEL_OWNED_NATIVE',
        }),
        expect.objectContaining({
          internal_path: 'onnxruntime/capi/onnxruntime_providers_shared.dll',
          owner_kind: 'WHEEL_OWNED_NATIVE',
        }),
      ]),
    );
    expect(packaged.native_artifacts.some((entry) => entry.owner_reference.includes('pip'))).toBe(
      false,
    );
    expect(packaged.bootloader_layer.sha256).not.toBe(packaged.archive_payload.sha256);
    expect(packaged.bootloader_layer.source_artifact_sha256).toBe(
      hash(join(toolchainRoot, 'bootloader.bin')),
    );
    expect(packaged.final_artifact.sha256).not.toBe(packaged.bootloader_layer.sha256);
    const reconciled = runNode([
      cli,
      'reconcile',
      ...v2Arguments(),
      '--packaged-inventory',
      packagedPath,
    ]);
    expect(reconciled.status, reconciled.stderr).toBe(0);
  });

  it('fails closed for an unknown or wheel-hash-mismatched native payload', () => {
    writeFileSync(join(buildRoot, 'tampered.dll'), 'not-the-approved-wheel-native');
    createBuild([
      ['python312.dll', join(buildRoot, 'python312.dll')],
      ['numpy/_multiarray_umath.pyd', join(buildRoot, '_multiarray_umath.pyd')],
      ['onnxruntime/capi/onnxruntime_providers_shared.dll', join(buildRoot, 'tampered.dll')],
      ['unknown.dll', join(buildRoot, 'tampered.dll')],
    ]);
    const inventoried = runNode([
      cli,
      'native-inventory',
      ...v2Arguments(),
      '--inventory-id',
      'fixture-unknown-native-v2',
      '--output',
      packagedPath,
    ]);
    expect(inventoried.status).toBe(1);
    expect(inventoried.stderr).toContain('unknown one-file native owner/hash');
  });

  it('rejects a parsed CArchive with zero native entries', () => {
    writeFileSync(join(buildRoot, 'readme.txt'), 'not native');
    const finalPath = join(buildRoot, 'zero-native.exe');
    const built = spawnSync(
      python,
      [
        onefileBuilder,
        '--output',
        finalPath,
        '--bootloader',
        join(toolchainRoot, 'bootloader.bin'),
        '--entry',
        `README.txt=${join(buildRoot, 'readme.txt')}`,
      ],
      { encoding: 'utf8', shell: false, env: pythonEnvironment() },
    );
    expect(built.status, built.stderr).toBe(0);
    const inspected = spawnSync(python, [onefileInspector, finalPath], {
      encoding: 'utf8',
      shell: false,
      env: pythonEnvironment(),
    });
    expect(inspected.status).toBe(1);
    expect(inspected.stderr).toContain('zero native entries');
  });

  it('keeps SBOM, license and vulnerability evidence separated by owner and scope', () => {
    const inventoried = runNode([
      cli,
      'native-inventory',
      ...v2Arguments(),
      '--inventory-id',
      'fixture-packaged-native-v2',
      '--output',
      packagedPath,
    ]);
    expect(inventoried.status, inventoried.stderr).toBe(0);
    const licensePath = join(directory, 'toolchain-license.json');
    const license = runNode([
      cli,
      'toolchain-license',
      '--toolchain-inventory',
      toolchainPath,
      '--toolchain-artifact-root',
      toolchainRoot,
      '--output',
      licensePath,
    ]);
    expect(license.status, license.stderr).toBe(0);
    expect(readFileSync(licensePath, 'utf8')).toContain('TOOLCHAIN_OWNED_NATIVE');
    const vulnerabilityPath = join(directory, 'toolchain-vulnerability.json');
    const vulnerability = runNode([
      cli,
      'toolchain-vulnerability',
      '--toolchain-inventory',
      toolchainPath,
      '--toolchain-artifact-root',
      toolchainRoot,
      '--output',
      vulnerabilityPath,
    ]);
    expect(vulnerability.status, vulnerability.stderr).toBe(0);
    expect(readFileSync(vulnerabilityPath, 'utf8')).toContain('BUILD_TOOLCHAIN_COMPONENT');
    const sbomPath = join(directory, 'SBOM.cdx.json');
    const sbom = runNode([
      sbomGenerator,
      '--output',
      sbomPath,
      '--python-inventory',
      inventoryPath,
      '--packaged-native-inventory',
      packagedPath,
      '--toolchain-inventory',
      toolchainPath,
      '--build-provenance',
      buildPath,
    ]);
    expect(sbom.status, sbom.stderr).toBe(0);
    const text = readFileSync(sbomPath, 'utf8');
    expect(text).toContain('WHEEL_OWNED_NATIVE');
    expect(text).toContain('TOOLCHAIN_OWNED_NATIVE');
    expect(text).toContain('BUILD_ARTIFACT');
    expect(text).toContain('bit_for_bit_required');
  });
});
