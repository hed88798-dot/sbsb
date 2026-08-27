import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

export function repositoryRoot(argv = process.argv.slice(2)) {
  return resolve(optionValue(argv, '--root') ?? process.cwd());
}

export function manifestPaths(root, argv = process.argv.slice(2)) {
  const requested = optionValue(argv, '--manifest');
  if (requested) return [resolve(root, requested)];
  const directory = resolve(root, 'tests/golden/manifests');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => resolve(directory, name));
}

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateManifestStructure(manifest, path) {
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
    requireValue(
      ['UTF8_LF', 'EXACT_BYTES'].includes(file.canonicalization),
      `${path}: invalid canonicalization for ${file.path}`,
    );
    requireValue(/^[a-f0-9]{64}$/.test(file.sha256), `${path}: invalid SHA-256 for ${file.path}`);
  }
}

function requireCanonicalUtf8Lf(bytes, sourcePath) {
  requireValue(
    !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    `${sourcePath}: UTF8_LF forbids a UTF-8 BOM`,
  );
  let text;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    throw new Error(`${sourcePath}: UTF8_LF requires valid UTF-8`);
  }
  requireValue(!text.includes('\r'), `${sourcePath}: UTF8_LF forbids CRLF/CR line endings`);
  requireValue(text.endsWith('\n'), `${sourcePath}: UTF8_LF requires one trailing LF`);
  requireValue(!text.endsWith('\n\n'), `${sourcePath}: UTF8_LF requires one trailing LF`);
}

export function readCanonicalIntegrityBytes(root, file, manifestPath) {
  const sourcePath = resolve(root, file.path);
  requireValue(
    existsSync(sourcePath) && statSync(sourcePath).isFile(),
    `${manifestPath}: missing ${file.path}`,
  );
  const bytes = readFileSync(sourcePath);
  if (file.canonicalization === 'UTF8_LF') requireCanonicalUtf8Lf(bytes, file.path);
  return bytes;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function calculatedHashes(root, manifest, manifestPath) {
  return manifest.integrity.files.map((file) => ({
    file,
    sha256: sha256(readCanonicalIntegrityBytes(root, file, manifestPath)),
  }));
}

export function verifyManifest(root, manifest, manifestPath) {
  validateManifestStructure(manifest, manifestPath);
  for (const result of calculatedHashes(root, manifest, manifestPath)) {
    requireValue(
      result.sha256 === result.file.sha256,
      `${manifestPath}: hash mismatch for ${result.file.path}`,
    );
  }
}
