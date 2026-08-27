import { writeFileSync } from 'node:fs';
import {
  calculatedHashes,
  manifestPaths,
  readManifest,
  repositoryRoot,
  requireValue,
  validateManifestStructure,
} from './manifest-integrity.mjs';

try {
  const root = repositoryRoot();
  const manifests = manifestPaths(root);
  requireValue(manifests.length > 0, 'no golden set manifests found');
  let changed = 0;
  for (const path of manifests) {
    const manifest = readManifest(path);
    validateManifestStructure(manifest, path);
    let manifestChanged = false;
    for (const result of calculatedHashes(root, manifest, path)) {
      if (result.file.sha256 !== result.sha256) {
        result.file.sha256 = result.sha256;
        manifestChanged = true;
      }
    }
    if (manifestChanged) {
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      changed += 1;
      console.log(`golden-update: UPDATED ${path}`);
    }
  }
  console.log(`golden-update: COMPLETE (${changed} manifest(s) changed; review Git diff)`);
} catch (error) {
  console.error(`golden-update: FAIL\n${error.message}`);
  process.exit(1);
}
