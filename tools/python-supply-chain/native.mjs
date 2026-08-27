import { basename, relative, resolve } from 'node:path';
import {
  listNativeFiles,
  nativeType,
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
