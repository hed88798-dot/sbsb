import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const EXPECTED_TRANSPORT = 'a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01';
const EXPECTED_FFMPEG = '7fc910c87e37502f3ff1f7e56c0ee470d91597aece9cd873880ce3c477d0a933';
const EXPECTED_FFPROBE = '641b8649c3d11702942a4b649d6ecee35231e04e09ce50a8d74b8c46b5295c4e';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function parseArgs(argv) {
  const values = {};
  const normalized = argv[0] === '--' ? argv.slice(1) : argv;
  for (let index = 0; index < normalized.length; index += 2) {
    values[normalized[index]?.replace(/^--/u, '')] = normalized[index + 1];
  }
  for (const name of ['staging', 'packaging', 'installed', 'output']) {
    if (!values[name]) throw new Error(`THREE_STAGE_ARGUMENT_MISSING:${name}`);
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const staging = JSON.parse(await readFile(resolve(args.staging), 'utf8'));
const packaging = JSON.parse(await readFile(resolve(args.packaging), 'utf8'));
const installed = JSON.parse(await readFile(resolve(args.installed), 'utf8'));
const hashes = [
  staging.source_extracted_tree_hash,
  staging.build_staged_tree_hash,
  packaging.observed.runtime_tree_hash,
  installed.observed.runtime_tree_hash,
];
if (
  staging.status !== 'PASS' ||
  staging.transport_sha256 !== EXPECTED_TRANSPORT ||
  packaging.mode !== 'PACKAGING_ARTIFACT' ||
  installed.mode !== 'REAL_INSTALLED_APP' ||
  packaging.status !== 'PASS' ||
  installed.status !== 'PASS' ||
  new Set(hashes).size !== 1 ||
  canonicalJson(staging.staged_tree.members) !==
    canonicalJson(packaging.observed.runtime_tree.members) ||
  canonicalJson(staging.staged_tree.members) !==
    canonicalJson(installed.observed.runtime_tree.members) ||
  packaging.observed.ffmpeg_sha256 !== EXPECTED_FFMPEG ||
  installed.observed.ffmpeg_sha256 !== EXPECTED_FFMPEG ||
  packaging.observed.ffprobe_sha256 !== EXPECTED_FFPROBE ||
  installed.observed.ffprobe_sha256 !== EXPECTED_FFPROBE ||
  packaging.observed.path_fallback_used !== false ||
  installed.observed.path_fallback_used !== false
) {
  throw new Error('THREE_STAGE_RUNTIME_BYTES_INVALID');
}
const result = {
  schema_version: '1',
  record_kind: 'DESKTOP_RUNTIME_V2_THREE_STAGE_PROVENANCE',
  status: 'PASS',
  source_transport_sha256: EXPECTED_TRANSPORT,
  source_extracted_tree_hash: hashes[0],
  build_staged_tree_hash: hashes[1],
  packaging_artifact_tree_hash: hashes[2],
  installed_tree_hash: hashes[3],
  packaging_artifact_smoke: 'PASS',
  real_installed_app_smoke: 'PASS',
  packaged_production_fallback: 'NONE',
};
await mkdir(dirname(resolve(args.output)), { recursive: true });
await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
