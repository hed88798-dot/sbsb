import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadArtifactLicenseReviewPolicy,
  validateArtifactLicenseEvidenceV3,
  validateArtifactLicenseReviewV1,
} from './artifact-review.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

try {
  const policy = loadArtifactLicenseReviewPolicy();
  const fixtureRoot = resolve(
    repositoryRoot,
    'tests/fixtures/python-supply-chain/code-c-seven-wheel-license-qicr',
  );
  const fixtureFiles = files(fixtureRoot);
  if (fixtureFiles.some((path) => extname(path).toLowerCase() === '.whl')) {
    throw new Error('wheel binaries must not be committed with exact-license regression fixtures');
  }
  const evidenceFiles = fixtureFiles.filter((path) => path.endsWith('.evidence.v3.json'));
  const fixtureManifest = JSON.parse(readFileSync(resolve(fixtureRoot, 'manifest.json'), 'utf8'));
  if (
    fixtureManifest.fixture_scope !== 'REGRESSION_ONLY_NOT_RELEASE_APPROVAL' ||
    fixtureManifest.artifacts.length !== 7 ||
    evidenceFiles.length !== 7
  ) {
    throw new Error('Code C seven-wheel regression manifest identity is incomplete');
  }
  for (const path of evidenceFiles) {
    validateArtifactLicenseEvidenceV3(JSON.parse(readFileSync(path, 'utf8')));
  }

  const reviewRoot = resolve(repositoryRoot, 'compliance/license-reviews');
  const reviewFiles = files(reviewRoot).filter((path) => path.endsWith('.review.v1.json'));
  for (const path of reviewFiles) {
    validateArtifactLicenseReviewV1(JSON.parse(readFileSync(path, 'utf8')), { policy });
  }
  console.log(
    `artifact-license-records: PASS (${evidenceFiles.length} exact regression evidence snapshots; ${reviewFiles.length} approved review records; CI verify-only)`,
  );
} catch (error) {
  console.error(`artifact-license-records: FAIL\n${error.message}`);
  process.exitCode = 1;
}
