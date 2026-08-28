import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectPnpmInventory, npmPackageUrl } from '../lib/package-inventory.mjs';
import {
  discoverInventoryPaths,
  loadInventories,
  validatePackagedInventory,
} from '../python-supply-chain/inventory.mjs';
import { buildPythonSbomRecords, validatePythonSbomBinding } from '../python-supply-chain/sbom.mjs';

const repositoryRoot = process.cwd();
const outputIndex = process.argv.indexOf('--output');
const outputPath = resolve(
  repositoryRoot,
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? process.argv[outputIndex + 1]
    : 'artifacts/compliance/SBOM.cdx.json',
);
const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const qualityToolLock = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'compliance/quality-tooling/python/packaging-25.0.lock.json'),
    'utf8',
  ),
);
const pythonInventoryPaths = process.argv
  .flatMap((value, index) => (value === '--python-inventory' ? [process.argv[index + 1]] : []))
  .filter(Boolean)
  .map((path) => resolve(repositoryRoot, path));
const packagedInventoryPaths = process.argv
  .flatMap((value, index) =>
    value === '--packaged-native-inventory' ? [process.argv[index + 1]] : [],
  )
  .filter(Boolean)
  .map((path) => resolve(repositoryRoot, path));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

let inventory;
let pythonInventories;
let packagedInventories;
try {
  inventory = collectPnpmInventory(repositoryRoot);
  pythonInventories = loadInventories(
    pythonInventoryPaths.length > 0 ? pythonInventoryPaths : discoverInventoryPaths(repositoryRoot),
  );
  packagedInventories = packagedInventoryPaths.map((path) =>
    validatePackagedInventory(JSON.parse(readFileSync(path, 'utf8'))),
  );
} catch (error) {
  console.error(`sbom: FAIL\n${error.message}`);
  process.exit(1);
}

const npmComponents = inventory.map((entry) => ({
  type: 'library',
  'bom-ref': npmPackageUrl(entry.name, entry.version),
  name: entry.name,
  version: entry.version,
  purl: npmPackageUrl(entry.name, entry.version),
  licenses: [{ expression: entry.license }],
  properties: [{ name: 'com.company.inventory.source', value: 'installed-pnpm-virtual-store' }],
}));
const pythonRecords = buildPythonSbomRecords(pythonInventories, packagedInventories);
const qualityToolComponent = {
  type: 'library',
  'bom-ref': `urn:python-wheel:sha256:${qualityToolLock.sha256}`,
  name: qualityToolLock.package_name,
  version: qualityToolLock.version,
  purl: qualityToolLock.purl,
  scope: 'optional',
  hashes: [{ alg: 'SHA-256', content: qualityToolLock.sha256 }],
  licenses: [{ expression: qualityToolLock.license_expression }],
  externalReferences: [
    { type: 'distribution', url: qualityToolLock.download_url },
    { type: 'website', url: qualityToolLock.source },
  ],
  properties: [
    { name: 'com.company.python.scope', value: qualityToolLock.scope },
    { name: 'com.company.python.wheel.filename', value: qualityToolLock.filename },
    { name: 'com.company.python.provenance.supplier', value: qualityToolLock.supplier },
    {
      name: 'com.company.python.provenance.status',
      value: qualityToolLock.provenance_review_status,
    },
  ],
};
const components = [...npmComponents, qualityToolComponent, ...pythonRecords.components];
validatePythonSbomBinding(pythonInventories, components);
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: 'application',
          name: 'ai-video-sbom-scaffold',
          version: '1.0.0',
        },
      ],
    },
    component: {
      type: 'application',
      'bom-ref': `pkg:generic/${rootManifest.name}@${rootManifest.version}`,
      name: rootManifest.name,
      version: rootManifest.version,
      properties: [
        { name: 'com.company.git.commit', value: commit },
        {
          name: 'com.company.sbom.completeness',
          value: 'SOURCE_AND_BUILD_DEPENDENCIES_ONLY_NOT_INSTALLER_COMPLETE',
        },
        { name: 'com.company.release.blocking', value: 'true' },
      ],
    },
  },
  components,
  dependencies: pythonRecords.dependencies,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(
  `sbom: PASS (scaffold; ${npmComponents.length} npm + ${pythonRecords.components.length} product Python/native + 1 compliance-tool components; ${outputPath})`,
);
