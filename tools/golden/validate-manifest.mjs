import {
  manifestPaths,
  readManifest,
  repositoryRoot,
  requireValue,
  verifyManifest,
} from './manifest-integrity.mjs';

try {
  const root = repositoryRoot();
  const manifests = manifestPaths(root);
  requireValue(manifests.length > 0, 'no golden set manifests found');
  for (const path of manifests) verifyManifest(root, readManifest(path), path);
  console.log(`golden-verify: PASS (${manifests.length} manifest(s))`);
} catch (error) {
  console.error(`golden-verify: FAIL\n${error.message}`);
  process.exit(1);
}
