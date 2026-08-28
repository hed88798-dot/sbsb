import { spawnSync } from 'node:child_process';
import { delimiter, basename, relative, resolve } from 'node:path';
import {
  listNativeFiles,
  nativeType,
  repositoryRoot,
  sha256File,
  validatePackagedInventory,
} from './inventory.mjs';

export async function buildPackagedNativeInventory(loaded, packagedRoot, inventoryId) {
  const root = resolve(packagedRoot);
  const expected = new Map();
  for (const { document } of loaded) {
    for (const artifact of document.packages) {
      for (const native of artifact.native_artifacts) {
        if (expected.has(native.packaged_relative_path)) {
          throw new Error(`duplicate packaged native path: ${native.packaged_relative_path}`);
        }
        expected.set(native.packaged_relative_path, { artifact, native });
      }
    }
  }
  const nativeArtifacts = [];
  for (const path of listNativeFiles(root)) {
    const relativePath = relative(root, path).replaceAll('\\', '/');
    const owner = expected.get(relativePath);
    nativeArtifacts.push({
      filename: basename(path),
      relative_path: relativePath,
      sha256: await sha256File(path),
      type: nativeType(path),
      source_package: owner?.artifact.package_name ?? 'UNKNOWN',
      source_artifact_sha256: owner?.artifact.sha256 ?? 'UNKNOWN',
      owner_resolution: owner ? 'MATCHED' : 'UNKNOWN',
    });
  }
  return validatePackagedInventory({
    schema_version: '1',
    inventory_id: inventoryId,
    generated_at: new Date().toISOString(),
    source_inventory_ids: loaded.map(({ document }) => document.inventory_id),
    native_artifacts: nativeArtifacts,
  });
}

export function reconcilePackagedNativeInventory(loaded, packaged) {
  validatePackagedInventory(packaged);
  if (packaged.schema_version === '2') {
    throw new Error('packaged native inventory v2 requires toolchain/build reconciliation inputs');
  }
  const expected = new Map();
  const expectedInventoryIds = new Set(loaded.map(({ document }) => document.inventory_id));
  for (const { document } of loaded) {
    for (const artifact of document.packages) {
      for (const native of artifact.native_artifacts) {
        if (expected.has(native.packaged_relative_path)) {
          throw new Error(
            `duplicate expected packaged native path: ${native.packaged_relative_path}`,
          );
        }
        expected.set(native.packaged_relative_path, { artifact, native });
      }
    }
  }
  const failures = [];
  const packagedInventoryIds = new Set(packaged.source_inventory_ids);
  if (
    packagedInventoryIds.size !== expectedInventoryIds.size ||
    [...expectedInventoryIds].some((inventoryId) => !packagedInventoryIds.has(inventoryId))
  ) {
    failures.push('packaged native source_inventory_ids do not match locked inventories');
  }
  const actual = new Map();
  for (const native of packaged.native_artifacts) {
    if (actual.has(native.relative_path)) {
      failures.push(`duplicate packaged native artifact: ${native.relative_path}`);
    }
    actual.set(native.relative_path, native);
  }
  for (const [path, entry] of expected) {
    const found = actual.get(path);
    if (!found) failures.push(`missing expected packaged native artifact: ${path}`);
    else {
      if (found.sha256 !== entry.native.sha256)
        failures.push(`packaged native hash mismatch: ${path}`);
      if (found.filename !== entry.native.filename)
        failures.push(`packaged native filename mismatch: ${path}`);
      if (found.type !== entry.native.type) failures.push(`packaged native type mismatch: ${path}`);
      if (found.source_package !== entry.artifact.package_name)
        failures.push(`packaged native owner mismatch: ${path}`);
      if (found.source_artifact_sha256 !== entry.artifact.sha256)
        failures.push(`packaged native wheel provenance mismatch: ${path}`);
      if (found.owner_resolution !== 'MATCHED')
        failures.push(`packaged native owner unknown: ${path}`);
    }
  }
  for (const [path, entry] of actual) {
    if (!expected.has(path)) failures.push(`unexpected packaged native artifact: ${path}`);
    if (entry.owner_resolution === 'UNKNOWN')
      failures.push(`unknown packaged native owner: ${path}`);
  }
  if (failures.length > 0) throw new Error([...new Set(failures)].join('\n'));
  return {
    schema_version: '1',
    status: 'PASS',
    source_inventory_ids: packaged.source_inventory_ids,
    expected_native_artifacts: expected.size,
    packaged_native_artifacts: actual.size,
  };
}

export function inspectPyInstallerOnefile(finalArtifact, options = {}) {
  const pythonExecutable =
    options.pythonExecutable ??
    process.env.PYTHON_EXECUTABLE ??
    (process.platform === 'win32' ? 'python.exe' : 'python3');
  const sitePackages =
    options.sitePackages ??
    process.env.PYTHON_COMPLIANCE_SITE_PACKAGES ??
    resolve(repositoryRoot, 'artifacts/python-compliance-tools/site-packages');
  const result = spawnSync(
    pythonExecutable,
    [
      resolve(repositoryRoot, 'tools/python-supply-chain/inspect-pyinstaller-onefile.py'),
      resolve(finalArtifact),
    ],
    {
      encoding: 'utf8',
      shell: false,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: [sitePackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      },
    },
  );
  if (result.error || result.status !== 0) {
    throw (
      result.error ?? new Error(result.stderr.trim() || 'PyInstaller one-file inspection failed')
    );
  }
  const inspection = JSON.parse(result.stdout);
  if (inspection.status !== 'PARSED' || inspection.native_entry_count < 1) {
    throw new Error('PyInstaller one-file inspection did not parse at least one native entry');
  }
  return inspection;
}

function expectedNativeOwners(loadedWheels, toolchain) {
  const expected = new Map();
  for (const { document } of loadedWheels) {
    for (const artifact of document.packages) {
      for (const native of artifact.native_artifacts) {
        if (expected.has(native.packaged_relative_path)) {
          throw new Error(`duplicate expected native path: ${native.packaged_relative_path}`);
        }
        expected.set(native.packaged_relative_path, {
          owner_kind: 'WHEEL_OWNED_NATIVE',
          owner_reference: artifact.purl,
          source_artifact_sha256: artifact.sha256,
          native,
        });
      }
    }
  }
  for (const component of toolchain.components) {
    if (!component.usage_scopes.includes('PACKAGED_RUNTIME_COMPONENT')) continue;
    for (const native of component.packaged_native_artifacts) {
      if (expected.has(native.internal_path)) {
        throw new Error(`duplicate expected native path: ${native.internal_path}`);
      }
      expected.set(native.internal_path, {
        owner_kind: 'TOOLCHAIN_OWNED_NATIVE',
        owner_reference: component.component_id,
        source_artifact_sha256: component.artifact.sha256,
        native,
      });
    }
  }
  return expected;
}

export async function buildOnefilePackagedNativeInventory(
  loadedWheels,
  loadedToolchain,
  loadedBuild,
  buildManifestSha256,
  finalArtifact,
  options = {},
) {
  const toolchain = loadedToolchain.document ?? loadedToolchain;
  const build = loadedBuild.document ?? loadedBuild;
  const inspection = inspectPyInstallerOnefile(finalArtifact, options);
  const expected = expectedNativeOwners(loadedWheels, toolchain);
  const byComponent = new Map(
    toolchain.components.map((component) => [component.component_id, component]),
  );
  const bootloader = byComponent.get(build.inputs.bootloader_component_id);
  if (bootloader?.component_kind !== 'PYINSTALLER_BOOTLOADER') {
    throw new Error('build provenance does not bind a PyInstaller bootloader component');
  }
  const nativeArtifacts = inspection.native_artifacts.map((native) => {
    const owner = expected.get(native.internal_path);
    const matches =
      owner &&
      owner.native.sha256 === native.sha256 &&
      owner.native.filename === native.filename &&
      owner.native.type === native.type &&
      (owner.native.size === undefined || owner.native.size === native.size);
    return {
      ...native,
      owner_kind: matches ? owner.owner_kind : 'UNKNOWN',
      owner_resolution: matches ? 'MATCHED' : 'UNKNOWN',
      owner_reference: matches ? owner.owner_reference : 'UNKNOWN',
      source_artifact_sha256: matches ? owner.source_artifact_sha256 : 'UNKNOWN',
      build_layer: 'CARCHIVE_PAYLOAD',
    };
  });
  const unknown = nativeArtifacts
    .filter((native) => native.owner_resolution === 'UNKNOWN')
    .map((native) => native.internal_path);
  if (unknown.length > 0) {
    throw new Error(`unknown one-file native owner/hash: ${unknown.join(', ')}`);
  }
  return validatePackagedInventory({
    schema_version: '2',
    inventory_id: options.inventoryId ?? `packaged-${build.build_id}`,
    generated_at: new Date().toISOString(),
    source_wheel_inventory_ids: loadedWheels.map(({ document }) => document.inventory_id),
    source_toolchain_inventory_ids: [toolchain.inventory_id],
    build_provenance: {
      build_id: build.build_id,
      manifest_sha256: buildManifestSha256,
    },
    inspection: {
      engine: inspection.engine,
      engine_version: inspection.engine_version,
      reader: inspection.reader,
      status: inspection.status,
      archive_entry_count: inspection.archive_entry_count,
      native_entry_count: inspection.native_entry_count,
    },
    final_artifact: {
      ...inspection.final_artifact,
      target_os: build.target.os,
      target_architecture: build.target.architecture,
    },
    bootloader_layer: {
      ...inspection.bootloader_layer,
      owner_kind: 'TOOLCHAIN_OWNED_NATIVE',
      owner_component_id: bootloader.component_id,
      source_artifact_sha256: bootloader.artifact.sha256,
      owner_resolution: 'MATCHED',
      build_layer: 'PYINSTALLER_BOOTLOADER',
    },
    archive_payload: inspection.archive_payload,
    native_artifacts: nativeArtifacts,
  });
}

export function reconcileOnefilePackagedNativeInventory(
  loadedWheels,
  loadedToolchain,
  loadedBuild,
  buildManifestSha256,
  packaged,
) {
  validatePackagedInventory(packaged);
  if (packaged.schema_version !== '2')
    throw new Error('one-file reconciliation requires packaged schema v2');
  const toolchain = loadedToolchain.document ?? loadedToolchain;
  const build = loadedBuild.document ?? loadedBuild;
  const expected = expectedNativeOwners(loadedWheels, toolchain);
  const failures = [];
  const wheelIds = new Set(loadedWheels.map(({ document }) => document.inventory_id));
  if (
    packaged.source_wheel_inventory_ids.length !== wheelIds.size ||
    packaged.source_wheel_inventory_ids.some((id) => !wheelIds.has(id))
  )
    failures.push('packaged wheel inventory ids differ from verified wheel graph');
  if (
    packaged.source_toolchain_inventory_ids.length !== 1 ||
    packaged.source_toolchain_inventory_ids[0] !== toolchain.inventory_id
  )
    failures.push('packaged toolchain inventory id differs from verified toolchain');
  if (
    packaged.build_provenance.build_id !== build.build_id ||
    packaged.build_provenance.manifest_sha256 !== buildManifestSha256
  )
    failures.push('packaged build provenance manifest binding mismatch');
  if (packaged.final_artifact.sha256 !== build.final_artifact.sha256)
    failures.push('final worker hash mismatch');
  if (packaged.bootloader_layer.sha256 !== build.output_layers.bootloader_sha256)
    failures.push('bootloader layer hash mismatch');
  if (packaged.archive_payload.sha256 !== build.output_layers.archive_payload_sha256)
    failures.push('CArchive payload hash mismatch');
  const bootloader = toolchain.components.find(
    (component) => component.component_id === build.inputs.bootloader_component_id,
  );
  if (
    packaged.bootloader_layer.owner_component_id !== bootloader?.component_id ||
    packaged.bootloader_layer.source_artifact_sha256 !== bootloader?.artifact.sha256
  )
    failures.push('bootloader provenance mismatch');
  const actual = new Map();
  for (const native of packaged.native_artifacts) {
    if (actual.has(native.internal_path))
      failures.push(`duplicate packaged native: ${native.internal_path}`);
    actual.set(native.internal_path, native);
    if (native.owner_kind === 'UNKNOWN' || native.owner_resolution === 'UNKNOWN') {
      failures.push(`unknown packaged native owner: ${native.internal_path}`);
    }
  }
  for (const [path, owner] of expected) {
    const native = actual.get(path);
    if (!native) failures.push(`missing expected packaged native: ${path}`);
    else {
      if (native.sha256 !== owner.native.sha256)
        failures.push(`packaged native hash mismatch: ${path}`);
      if (owner.native.size !== undefined && native.size !== owner.native.size)
        failures.push(`packaged native size mismatch: ${path}`);
      if (native.owner_kind !== owner.owner_kind)
        failures.push(`packaged native owner kind mismatch: ${path}`);
      if (native.owner_reference !== owner.owner_reference)
        failures.push(`packaged native owner reference mismatch: ${path}`);
      if (native.source_artifact_sha256 !== owner.source_artifact_sha256)
        failures.push(`packaged native source artifact mismatch: ${path}`);
    }
  }
  for (const path of actual.keys())
    if (!expected.has(path)) failures.push(`unexpected packaged native: ${path}`);
  if (packaged.inspection.native_entry_count !== actual.size || actual.size === 0)
    failures.push('native inspection count is zero or inconsistent');
  if (failures.length > 0) throw new Error([...new Set(failures)].join('\n'));
  return {
    schema_version: '2',
    status: 'PASS',
    build_id: build.build_id,
    final_artifact_sha256: build.final_artifact.sha256,
    expected_native_artifacts: expected.size,
    packaged_native_artifacts: actual.size,
    owner_kinds: [...new Set([...actual.values()].map((item) => item.owner_kind))].sort(),
  };
}
