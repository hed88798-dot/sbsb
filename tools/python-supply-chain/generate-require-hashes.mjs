import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadInventories, verifyArtifactInventories } from './inventory.mjs';

function option(values, name) {
  const index = values.indexOf(name);
  if (index < 0 || !values[index + 1]) throw new Error(`${name} requires a value`);
  return values[index + 1];
}

async function main() {
  const values = process.argv.slice(2);
  const inventoryPath = resolve(option(values, '--inventory'));
  const artifactRoot = resolve(option(values, '--artifact-root'));
  const outputPath = resolve(option(values, '--output'));
  const loaded = loadInventories([inventoryPath]);
  await verifyArtifactInventories(loaded, artifactRoot);
  const artifacts = loaded.flatMap(({ document }) => document.packages);
  const lines = [
    '# Generated from an APPROVED Python Artifact Inventory. Do not edit hashes in CI.',
    '# Install with: python -m pip install --require-hashes --no-deps -r <this-file>',
    '--only-binary=:all:',
    ...artifacts
      .sort((left, right) => left.purl.localeCompare(right.purl))
      .map(
        (artifact) =>
          `${artifact.package_name} @ ${artifact.provenance.download_url} --hash=sha256:${artifact.sha256}`,
      ),
    '',
  ];
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join('\n'));
  console.log(`python-require-hashes: PASS (${artifacts.length} exact wheel artifacts)`);
}

main().catch((error) => {
  console.error(`python-require-hashes: FAIL\n${error.message}`);
  process.exitCode = 1;
});
