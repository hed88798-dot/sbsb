import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentHash } from './trust-chain.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const defaultRetentionRoot = 'frozen-candidates';
const sha256Pattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9][a-z0-9._:-]{2,191}$/u;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`missing required argument ${name}`);
  return value;
}

function resolveInput(value) {
  return resolve(repositoryRoot, value);
}

function readJson(value) {
  const path = resolveInput(value);
  return { path, document: JSON.parse(readFileSync(path, 'utf8')) };
}

function writeJson(value, document) {
  const path = resolveInput(value);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return path;
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function assertId(value, label) {
  if (!idPattern.test(value)) throw new Error(`${label} must be a portable identifier`);
}

function assertSha(value, label) {
  if (!sha256Pattern.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function assertPortableFilename(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} must be a portable relative filename`);
  }
}

function assertTransferManifest(document) {
  if (document.schema_version !== '2')
    throw new Error('transfer manifest schema_version must be 2');
  assertId(document.manifest_id, 'manifest_id');
  assertSha(document.manifest_sha256, 'manifest_sha256');
  if (document.manifest_sha256 !== documentHash(document, 'manifest_sha256'))
    throw new Error('manifest_sha256 does not match canonical bytes');
  assertId(document.candidate_id, 'candidate_id');
  if (!['linux', 'windows'].includes(document.platform?.os))
    throw new Error('platform.os must be linux or windows');
  if (!['x86_64', 'arm64'].includes(document.platform?.architecture))
    throw new Error('platform.architecture is unsupported');
  for (const [label, output] of [
    ['Worker', document.worker],
    ['CArchive', document.carchive],
  ]) {
    assertPortableFilename(output?.filename, `${label} filename`);
    assertSha(output?.sha256, `${label} sha256`);
    if (!Number.isInteger(output?.size_bytes) || output.size_bytes < 1)
      throw new Error(`${label} size_bytes must be positive`);
  }
  for (const [label, binding] of [
    ['Build Recipe', document.build_recipe],
    ['Environment Descriptor', document.environment_descriptor],
    ['Build Context', document.build_context],
  ]) {
    assertId(binding?.id, `${label} id`);
    assertSha(binding?.sha256, `${label} sha256`);
  }
  if (document.transfer_role !== 'TRANSIENT_ACTIONS_TRANSFER')
    throw new Error('transfer_role must be TRANSIENT_ACTIONS_TRANSFER');
  if (
    typeof document.actions_artifact?.name !== 'string' ||
    document.actions_artifact.name.length === 0
  )
    throw new Error('Actions transfer artifact name must be non-empty');
  if (document.actions_artifact?.retention_days !== 1)
    throw new Error('Actions transfer artifact retention_days must be 1');
  if (document.actions_artifact?.authority_role !== 'TRANSPORT_ONLY')
    throw new Error('Actions artifact authority_role must be TRANSPORT_ONLY');
  if (document.final_retention?.channel !== 'MAC_LOCAL_PROJECT_FOLDER')
    throw new Error('final retention channel must be MAC_LOCAL_PROJECT_FOLDER');
  if (document.final_retention?.logical_root !== `${defaultRetentionRoot}/`)
    throw new Error(`final retention logical_root must be ${defaultRetentionRoot}/`);
  if (document.final_retention?.secondary_copy_required !== false)
    throw new Error('secondary permanent retention must be false');
}

async function verifyOutput(pathValue, expected, label) {
  const path = resolveInput(pathValue);
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`${label} is missing: ${path}`);
  const size = statSync(path).size;
  const sha256 = await hashFile(path);
  if (size !== expected.size_bytes) throw new Error(`${label} size mismatch`);
  if (sha256 !== expected.sha256) throw new Error(`${label} SHA-256 mismatch`);
  return { path, size_bytes: size, sha256 };
}

async function verifyTransfer(manifestValue, workerValue, carchiveValue) {
  const { document } = readJson(manifestValue);
  assertTransferManifest(document);
  const worker = await verifyOutput(workerValue, document.worker, 'Worker');
  const carchive = await verifyOutput(carchiveValue, document.carchive, 'CArchive');
  return { manifest: document, worker, carchive };
}

function localLocator(candidateId, platform) {
  return `${defaultRetentionRoot}/${candidateId}/${platform}/`;
}

async function recoveryDrill({ manifest, retention, sourceDirectory, recoveryOutput }) {
  if (retention.candidate_id !== manifest.candidate_id)
    throw new Error('retention candidate_id does not match transfer manifest');
  if (retention.local_copy?.worker_sha256 !== manifest.worker.sha256)
    throw new Error('retention local Worker hash does not match transfer manifest');
  if (retention.local_copy?.carchive_sha256 !== manifest.carchive.sha256)
    throw new Error('retention local CArchive hash does not match transfer manifest');
  const retainedManifestPath = join(sourceDirectory, 'manifest.json');
  if (!existsSync(retainedManifestPath)) throw new Error('retained transfer manifest is missing');
  const retainedManifest = JSON.parse(readFileSync(retainedManifestPath, 'utf8'));
  assertTransferManifest(retainedManifest);
  if (retainedManifest.manifest_sha256 !== manifest.manifest_sha256)
    throw new Error('retained transfer manifest hash does not match transfer manifest');
  const recoveryRoot = mkdtempSync(join(tmpdir(), 'candidate-recovery-'));
  const validationDirectory = join(recoveryRoot, manifest.candidate_id, manifest.platform.os);
  mkdirSync(validationDirectory, { recursive: true });
  try {
    const workerPath = join(sourceDirectory, basename(manifest.worker.filename));
    const carchivePath = join(sourceDirectory, basename(manifest.carchive.filename));
    copyFileSync(workerPath, join(validationDirectory, basename(manifest.worker.filename)));
    copyFileSync(carchivePath, join(validationDirectory, basename(manifest.carchive.filename)));
    const worker = await verifyOutput(
      join(validationDirectory, basename(manifest.worker.filename)),
      manifest.worker,
      'recovered Worker',
    );
    const carchive = await verifyOutput(
      join(validationDirectory, basename(manifest.carchive.filename)),
      manifest.carchive,
      'recovered CArchive',
    );
    const recovery = {
      schema_version: '2',
      drill_id: `${manifest.candidate_id}-recovery-${manifest.platform.os}`,
      drill_sha256: '',
      candidate_id: manifest.candidate_id,
      retention_receipt_id: retention.receipt_id,
      procedure_version: '2-local-folder',
      recovery_location: `local-validation://${manifest.candidate_id}/${manifest.platform.os}`,
      local_recovery: {
        source_copy_id: retention.local_copy.copy_id,
        worker_sha256: worker.sha256,
        carchive_sha256: carchive.sha256,
        worker_size_bytes: worker.size_bytes,
        carchive_size_bytes: carchive.size_bytes,
        status: 'PASS',
      },
      status: 'PASS',
      verified_at: new Date().toISOString(),
    };
    recovery.drill_sha256 = documentHash(recovery, 'drill_sha256');
    if (recoveryOutput) writeJson(recoveryOutput, recovery);
    return recovery;
  } finally {
    rmSync(recoveryRoot, { force: true, recursive: true });
  }
}

async function createTransferManifest() {
  const candidateId = requiredArgument('--candidate-id');
  const platform = requiredArgument('--platform');
  const architecture = argument('--architecture', 'x86_64');
  assertId(candidateId, 'candidate-id');
  if (!['linux', 'windows'].includes(platform))
    throw new Error('platform must be linux or windows');
  const workerPath = resolveInput(requiredArgument('--worker'));
  const carchivePath = resolveInput(requiredArgument('--carchive'));
  if (!statSync(workerPath).isFile() || !statSync(carchivePath).isFile())
    throw new Error('Worker and CArchive must be files');
  const [workerSha, carchiveSha] = await Promise.all([
    hashFile(workerPath),
    hashFile(carchivePath),
  ]);
  const recipeId = requiredArgument('--build-recipe-id');
  const recipeSha = requiredArgument('--build-recipe-sha256');
  const environmentId = requiredArgument('--environment-id');
  const environmentSha = requiredArgument('--environment-sha256');
  const contextId = requiredArgument('--build-context-id');
  const contextSha = requiredArgument('--build-context-sha256');
  assertId(recipeId, 'build-recipe-id');
  assertId(environmentId, 'environment-id');
  assertId(contextId, 'build-context-id');
  assertSha(recipeSha, 'build-recipe-sha256');
  assertSha(environmentSha, 'environment-sha256');
  assertSha(contextSha, 'build-context-sha256');
  const manifest = {
    schema_version: '2',
    manifest_id: `${candidateId}-transfer-${platform}`,
    manifest_sha256: '',
    candidate_id: candidateId,
    platform: { os: platform, architecture },
    worker: {
      filename: basename(workerPath),
      sha256: workerSha,
      size_bytes: statSync(workerPath).size,
    },
    carchive: {
      filename: basename(carchivePath),
      sha256: carchiveSha,
      size_bytes: statSync(carchivePath).size,
    },
    build_recipe: { id: recipeId, sha256: recipeSha },
    environment_descriptor: { id: environmentId, sha256: environmentSha },
    build_context: { id: contextId, sha256: contextSha },
    transfer_role: 'TRANSIENT_ACTIONS_TRANSFER',
    actions_artifact: {
      name: argument('--artifact-name', `candidate-transfer-${candidateId}-${platform}`),
      retention_days: 1,
      authority_role: 'TRANSPORT_ONLY',
    },
    final_retention: {
      channel: 'MAC_LOCAL_PROJECT_FOLDER',
      logical_root: `${defaultRetentionRoot}/`,
      secondary_copy_required: false,
    },
    generated_at: new Date().toISOString(),
  };
  manifest.manifest_sha256 = documentHash(manifest, 'manifest_sha256');
  assertTransferManifest(manifest);
  const output = requiredArgument('--output');
  writeJson(output, manifest);
  console.log(`candidate-egress: transfer manifest PASS (${manifest.manifest_sha256})`);
}

async function retainLocal() {
  const manifestValue = requiredArgument('--manifest');
  const workerValue = requiredArgument('--worker');
  const carchiveValue = requiredArgument('--carchive');
  const verified = await verifyTransfer(manifestValue, workerValue, carchiveValue);
  const manifest = verified.manifest;
  const retentionRoot = resolveInput(argument('--root', defaultRetentionRoot));
  const destinationDirectory = join(retentionRoot, manifest.candidate_id, manifest.platform.os);
  if (existsSync(destinationDirectory))
    throw new Error(`local retention destination already exists: ${destinationDirectory}`);
  mkdirSync(destinationDirectory, { recursive: true });
  try {
    copyFileSync(
      verified.worker.path,
      join(destinationDirectory, basename(manifest.worker.filename)),
    );
    copyFileSync(
      verified.carchive.path,
      join(destinationDirectory, basename(manifest.carchive.filename)),
    );
    writeFileSync(
      join(destinationDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    assertTransferManifest(
      JSON.parse(readFileSync(join(destinationDirectory, 'manifest.json'), 'utf8')),
    );
    const retained = {
      manifest,
      worker: await verifyOutput(
        join(destinationDirectory, basename(manifest.worker.filename)),
        manifest.worker,
        'retained Worker',
      ),
      carchive: await verifyOutput(
        join(destinationDirectory, basename(manifest.carchive.filename)),
        manifest.carchive,
        'retained CArchive',
      ),
    };
    const receipt = {
      schema_version: '2',
      receipt_id: `${manifest.candidate_id}-retention-${manifest.platform.os}`,
      receipt_sha256: '',
      candidate_id: manifest.candidate_id,
      platform: manifest.platform,
      worker: { sha256: retained.worker.sha256, size_bytes: retained.worker.size_bytes },
      carchive: { sha256: retained.carchive.sha256, size_bytes: retained.carchive.size_bytes },
      build_recipe: manifest.build_recipe,
      environment_descriptor: manifest.environment_descriptor,
      build_context: manifest.build_context,
      storage_channel_class: 'MAC_LOCAL_PROJECT_FOLDER',
      secondary_retention_copy_required: false,
      local_copy: {
        copy_id: `${manifest.candidate_id}-${manifest.platform.os}-local`,
        storage_locator: localLocator(manifest.candidate_id, manifest.platform.os),
        storage_location_identity: 'MAC_LOCAL_PROJECT_FOLDER',
        worker_sha256: retained.worker.sha256,
        carchive_sha256: retained.carchive.sha256,
        worker_size_bytes: retained.worker.size_bytes,
        carchive_size_bytes: retained.carchive.size_bytes,
        availability_status: 'AVAILABLE',
      },
      archived_at: new Date().toISOString(),
      retention_state: 'ARCHIVED',
      recovery_procedure_version: '2-local-folder',
      availability_verification_timestamp: new Date().toISOString(),
    };
    const recovery = await recoveryDrill({
      manifest,
      retention: receipt,
      sourceDirectory: destinationDirectory,
      recoveryOutput: argument(
        '--recovery-output',
        `artifacts/compliance/RECOVERY_DRILL_${manifest.candidate_id}_${manifest.platform.os}.json`,
      ),
    });
    receipt.retention_state = 'FROZEN_CANDIDATE';
    receipt.availability_verification_timestamp = recovery.verified_at;
    receipt.receipt_sha256 = documentHash(receipt, 'receipt_sha256');
    writeJson(requiredArgument('--output'), receipt);
    console.log(
      `candidate-egress: local retention PASS (${localLocator(manifest.candidate_id, manifest.platform.os)})`,
    );
  } catch (error) {
    rmSync(destinationDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function rerunRecovery() {
  const { document: manifest } = readJson(requiredArgument('--manifest'));
  const { document: retention } = readJson(requiredArgument('--retention'));
  assertTransferManifest(manifest);
  if (
    retention.schema_version !== '2' ||
    retention.storage_channel_class !== 'MAC_LOCAL_PROJECT_FOLDER'
  )
    throw new Error('retention receipt is not a v2 Mac local-folder receipt');
  if (retention.receipt_sha256 !== documentHash(retention, 'receipt_sha256'))
    throw new Error('retention receipt receipt_sha256 does not match canonical bytes');
  if (retention.candidate_id !== manifest.candidate_id)
    throw new Error('retention receipt candidate_id does not match transfer manifest');
  if (
    retention.local_copy?.storage_locator !==
    localLocator(manifest.candidate_id, manifest.platform.os)
  )
    throw new Error('retention receipt local locator does not match transfer manifest');
  const sourceDirectory = resolveInput(
    join(defaultRetentionRoot, manifest.candidate_id, manifest.platform.os),
  );
  await verifyOutput(
    join(sourceDirectory, basename(manifest.worker.filename)),
    manifest.worker,
    'retained Worker',
  );
  await verifyOutput(
    join(sourceDirectory, basename(manifest.carchive.filename)),
    manifest.carchive,
    'retained CArchive',
  );
  const recovery = await recoveryDrill({
    manifest,
    retention,
    sourceDirectory,
    recoveryOutput: requiredArgument('--output'),
  });
  console.log(`candidate-egress: recovery drill PASS (${recovery.drill_sha256})`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'create-transfer-manifest') return createTransferManifest();
  if (command === 'verify-transfer') {
    await verifyTransfer(
      requiredArgument('--manifest'),
      requiredArgument('--worker'),
      requiredArgument('--carchive'),
    );
    console.log('candidate-egress: transfer verification PASS');
    return;
  }
  if (command === 'retain-local') return retainLocal();
  if (command === 'recovery-drill') return rerunRecovery();
  throw new Error(
    'usage: candidate-egress.mjs <create-transfer-manifest|verify-transfer|retain-local|recovery-drill> ...',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`candidate-egress: FAIL\n${error.message}`);
    process.exitCode = 1;
  });
}

export {
  assertTransferManifest,
  createTransferManifest,
  recoveryDrill,
  retainLocal,
  verifyTransfer,
};
