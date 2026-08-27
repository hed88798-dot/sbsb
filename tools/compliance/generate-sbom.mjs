import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collectPnpmInventory, npmPackageUrl } from '../lib/package-inventory.mjs';

const repositoryRoot = process.cwd();
const outputIndex = process.argv.indexOf('--output');
const outputPath = resolve(
  repositoryRoot,
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? process.argv[outputIndex + 1]
    : 'artifacts/compliance/SBOM.cdx.json',
);
const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

let inventory;
try {
  inventory = collectPnpmInventory(repositoryRoot);
} catch (error) {
  console.error(`sbom: FAIL\n${error.message}`);
  process.exit(1);
}

const components = inventory.map((entry) => ({
  type: 'library',
  'bom-ref': npmPackageUrl(entry.name, entry.version),
  name: entry.name,
  version: entry.version,
  purl: npmPackageUrl(entry.name, entry.version),
  licenses: [{ expression: entry.license }],
  properties: [{ name: 'com.company.inventory.source', value: 'installed-pnpm-virtual-store' }],
}));
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
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`sbom: PASS (scaffold; ${components.length} components; ${outputPath})`);
