import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson, loadInventories } from './inventory.mjs';
import { evaluateWheel, validateTargetCompatibilityMetadata } from './compatibility.mjs';

function option(values, name) {
  const index = values.indexOf(name);
  if (index < 0 || !values[index + 1]) throw new Error(`${name} requires a path`);
  return resolve(values[index + 1]);
}

function assertTargetContinuity(legacy, target) {
  if (!target.python_version.startsWith(`${legacy.target.python_version}.`)) {
    throw new Error('v2 target Python patch version does not match v1 target Python minor');
  }
  const platform = legacy.target.platform_tag.toLowerCase();
  if (platform.startsWith('win_') && target.os !== 'windows') {
    throw new Error('v1 Windows target cannot migrate to a non-Windows descriptor');
  }
  if (
    (platform.startsWith('linux_') || platform.startsWith('manylinux')) &&
    target.os !== 'linux'
  ) {
    throw new Error('v1 Linux target cannot migrate to a non-Linux descriptor');
  }
}

async function main() {
  const values = process.argv.slice(2);
  const inventoryPath = option(values, '--inventory');
  const targetPath = option(values, '--target-descriptor');
  const outputPath = option(values, '--output');
  const [{ document: legacy }] = loadInventories([inventoryPath]);
  if (legacy.schema_version !== '1') throw new Error('migration input must use schema v1');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
  validateTargetCompatibilityMetadata(target);
  assertTargetContinuity(legacy, target);
  const migrated = {
    ...legacy,
    schema_version: '2',
    target,
    packages: legacy.packages.map((legacyArtifact) => {
      const evaluated = evaluateWheel(legacyArtifact.filename, target);
      if (evaluated.status !== 'COMPATIBLE') {
        throw new Error(`${legacyArtifact.filename}: v1 artifact is incompatible with v2 target`);
      }
      const artifact = { ...legacyArtifact };
      delete artifact.python_version;
      delete artifact.python_tag;
      delete artifact.abi_tag;
      delete artifact.platform_tag;
      return {
        ...artifact,
        wheel_tags: evaluated.wheel_tags,
        compatibility: { status: evaluated.status, matched_tags: evaluated.matched_tags },
      };
    }),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, canonicalJson(migrated));
  try {
    loadInventories([outputPath]);
  } catch (error) {
    rmSync(outputPath, { force: true });
    throw error;
  }
  console.log(`python-inventory-migration: PASS (${legacy.inventory_id}; v1 -> v2)`);
}

main().catch((error) => {
  console.error(`python-inventory-migration: FAIL\n${error.message}`);
  process.exitCode = 1;
});
