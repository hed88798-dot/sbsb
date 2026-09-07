import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

const MIB = 1024 * 1024;
const HARD_MAX_BYTES = 20 * MIB;
const TRANSIENT_WORKER_MAX_BYTES = 500 * MIB;

function fail(message) {
  console.error(`actions-artifact-budget: FAIL\n${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const values = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--allow-transient-worker-binary') {
      values.allowTransientWorkerBinary = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`missing value for ${option}`);
    index += 1;
    if (option === '--path') values.paths.push(value);
    else if (option === '--name') values.name = value;
    else if (option === '--purpose') values.purpose = value;
    else if (option === '--classification') values.classification = value;
    else if (option === '--retention-days') values.retentionDays = Number(value);
    else if (option === '--max-bytes') values.maxBytes = Number(value);
    else if (option === '--inventory') values.inventory = value;
    else fail(`unknown option: ${option}`);
  }
  return values;
}

const options = parseArguments(process.argv.slice(2));
if (!options.name || !options.purpose || !options.classification || !options.inventory) {
  fail('--name, --purpose, --classification, and --inventory are required');
}
if (!['authoritative', 'transient'].includes(options.classification)) {
  fail('--classification must be authoritative or transient');
}
if (!Number.isSafeInteger(options.retentionDays) || ![1, 3, 7].includes(options.retentionDays)) {
  fail('--retention-days must be one of 1, 3, or 7');
}
if (options.paths.length === 0) fail('at least one --path is required');

const transientWorkerBinary = options.allowTransientWorkerBinary === true;
const maxAllowedBytes = transientWorkerBinary ? TRANSIENT_WORKER_MAX_BYTES : HARD_MAX_BYTES;
if (
  !Number.isSafeInteger(options.maxBytes) ||
  options.maxBytes <= 0 ||
  options.maxBytes > maxAllowedBytes
) {
  fail(`--max-bytes must be between 1 and ${maxAllowedBytes}`);
}
if (transientWorkerBinary) {
  if (options.classification !== 'transient' || options.retentionDays !== 1) {
    fail('--allow-transient-worker-binary requires transient classification and 1-day retention');
  }
  if (options.paths.length !== 1) {
    fail('--allow-transient-worker-binary requires exactly one upload path');
  }
}

const repositoryRoot = realpathSync(process.cwd());
const forbiddenSegments = new Set(['candidate-venv', 'dist', 'distpath', 'work', 'workpath']);
const forbiddenExtensions = new Set(['.dll', '.dylib', '.exe', '.pyd', '.so']);

function assertAllowedPath(path) {
  const relativePath = relative(repositoryRoot, path);
  const segments = relativePath.split(sep).map((part) => part.toLowerCase());
  if (segments.some((part) => forbiddenSegments.has(part))) {
    fail(`forbidden candidate/build/environment path selected: ${relativePath}`);
  }
  const lowerName = basename(path).toLowerCase();
  if (
    [...forbiddenExtensions].some((extension) => lowerName.endsWith(extension)) &&
    !(transientWorkerBinary && lowerName === 'media-worker.exe')
  ) {
    fail(`candidate/native binary selected for Actions upload: ${relativePath}`);
  }
}

const files = [];
function collect(path) {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) fail(`selected path does not exist: ${path}`);
  const stat = lstatSync(absolutePath);
  if (stat.isSymbolicLink())
    fail(`symbolic links are forbidden in upload inputs: ${path} -> ${readlinkSync(absolutePath)}`);
  assertAllowedPath(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolutePath).sort()) collect(resolve(absolutePath, entry));
    return;
  }
  if (!stat.isFile()) fail(`unsupported upload input type: ${path}`);
  files.push({ path: relative(repositoryRoot, absolutePath), size_bytes: stat.size });
}

for (const path of options.paths) collect(path);
if (files.length === 0) fail('selected upload paths contain no files');
if (transientWorkerBinary) {
  const selectedPath = files[0].path.replaceAll('\\', '/');
  if (selectedPath !== 'artifacts/transient-worker/media-worker.exe') {
    fail(
      '--allow-transient-worker-binary only permits artifacts/transient-worker/media-worker.exe',
    );
  }
}

const totalBytes = files.reduce((total, file) => total + file.size_bytes, 0);
const inventory = {
  schema_version: 1,
  artifact_name: options.name,
  included_paths: options.paths,
  files,
  total_size_bytes: totalBytes,
  retention_days: options.retentionDays,
  artifact_purpose: options.purpose,
  classification: options.classification,
  inventory_file: {
    path: relative(repositoryRoot, resolve(options.inventory)),
    scope: 'metadata_self_excluded_from_size_to_avoid_recursive_inventory',
  },
  policy: {
    hard_max_single_artifact_bytes: HARD_MAX_BYTES,
    transient_worker_binary_exception: transientWorkerBinary
      ? {
          enabled: true,
          max_bytes: TRANSIENT_WORKER_MAX_BYTES,
          scope: 'single media-worker.exe for one-day Windows runtime smoke only',
        }
      : 'DISABLED',
    allocated_max_bytes: options.maxBytes,
    large_candidate_actions_upload: transientWorkerBinary
      ? 'TRANSIENT_WORKER_SMOKE_ONLY'
      : 'FORBIDDEN',
  },
  upload_size_policy: totalBytes <= options.maxBytes ? 'PASS' : 'FAIL',
};

mkdirSync(dirname(resolve(options.inventory)), { recursive: true });
writeFileSync(resolve(options.inventory), `${JSON.stringify(inventory, null, 2)}\n`);

if (totalBytes > options.maxBytes) {
  fail(`${options.name} is ${totalBytes} bytes; allocated maximum is ${options.maxBytes} bytes`);
}

console.log(
  `actions-artifact-budget: PASS (${options.name}; ${totalBytes}/${options.maxBytes} bytes)`,
);
