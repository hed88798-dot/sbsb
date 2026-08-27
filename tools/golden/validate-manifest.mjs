import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const repositoryRoot = process.cwd();

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifestPaths() {
  const requestedIndex = process.argv.indexOf('--manifest');
  if (requestedIndex >= 0) {
    const requested = process.argv[requestedIndex + 1];
    if (!requested) throw new Error('--manifest needs a path');
    return [resolve(repositoryRoot, requested)];
  }
  const directory = resolve(repositoryRoot, 'tests/golden/manifests');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => resolve(directory, name));
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validate(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  requireValue(manifest.schema_version === '1.0', `${path}: unsupported schema_version`);
  requireValue(
    /^[a-z0-9][a-z0-9._-]{2,63}$/.test(manifest.dataset_id),
    `${path}: invalid dataset_id`,
  );
  requireValue(
    /^\d+\.\d+\.\d+$/.test(manifest.dataset_version),
    `${path}: invalid dataset_version`,
  );
  requireValue(
    ['SYNTHETIC', 'AUTHORIZED', 'RESTRICTED'].includes(manifest.authorization?.status),
    `${path}: authorization status is missing or invalid`,
  );
  requireValue(
    ['SYNTHETIC', 'CUSTOMER_AUTHORIZED', 'PUBLIC_APPROVED'].includes(
      manifest.provenance?.source_type,
    ),
    `${path}: provenance source_type is missing or invalid`,
  );
  requireValue(
    typeof manifest.provenance?.contains_customer_data === 'boolean',
    `${path}: contains_customer_data must be explicit`,
  );
  requireValue(
    Array.isArray(manifest.splits) && manifest.splits.length > 0,
    `${path}: splits missing`,
  );
  const testSplit = manifest.splits.find((split) => split.name === 'test');
  if (testSplit) requireValue(testSplit.locked === true, `${path}: test split must be locked`);

  requireValue(manifest.integrity?.algorithm === 'SHA-256', `${path}: SHA-256 required`);
  requireValue(
    Array.isArray(manifest.integrity?.files) && manifest.integrity.files.length > 0,
    `${path}: integrity files missing`,
  );
  for (const file of manifest.integrity.files) {
    requireValue(
      !isAbsolute(file.path) && !file.path.split(/[\\/]/).includes('..'),
      `${path}: unsafe path`,
    );
    requireValue(/^[a-f0-9]{64}$/.test(file.sha256), `${path}: invalid SHA-256 for ${file.path}`);
    const sourcePath = resolve(repositoryRoot, file.path);
    requireValue(
      existsSync(sourcePath) && statSync(sourcePath).isFile(),
      `${path}: missing ${file.path}`,
    );
    requireValue(sha256(sourcePath) === file.sha256, `${path}: hash mismatch for ${file.path}`);
  }
}

try {
  const manifests = manifestPaths();
  requireValue(manifests.length > 0, 'no golden set manifests found');
  manifests.forEach(validate);
  console.log(`golden-manifest: PASS (${manifests.length} manifest(s))`);
} catch (error) {
  console.error(`golden-manifest: FAIL\n${error.message}`);
  process.exit(1);
}
