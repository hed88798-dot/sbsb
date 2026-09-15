import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApprovedRuntimeV2Authority } from '../../apps/desktop/dist-electron/main/render-runtime-authority-service.js';
import {
  assertRuntimeTreesEqual,
  createRuntimeTreeEvidence,
} from '../../apps/desktop/dist-electron/main/render-runtime-tree.js';

const EXPECTED_TRANSPORT_SHA256 =
  'a1d0bff4ea3c53dc56e7de7ee7436dfb872bf3e9bc1317acffb0c0254a3bcc01';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const approvedStageRoot = resolve(repositoryRoot, 'apps/desktop/.runtime-stage/ffmpeg-render-v2');

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

async function hashFile(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

function parseArgs(argv) {
  const parsed = {};
  const values = argv[0] === '--' ? argv.slice(1) : argv;
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('STAGE_RUNTIME_ARGUMENT_INVALID');
    parsed[name.slice(2)] = value;
  }
  for (const required of ['transport', 'source-root', 'approval', 'destination', 'evidence']) {
    if (!parsed[required]) throw new Error(`STAGE_RUNTIME_ARGUMENT_MISSING:${required}`);
  }
  return parsed;
}

async function copyApprovedDistribution(authority, sourceRoot, destination) {
  await mkdir(join(destination, 'bundle'), { recursive: true });
  await mkdir(join(destination, 'approval'), { recursive: true });
  await copyFile(join(sourceRoot, 'manifest.json'), join(destination, 'manifest.json'));
  await copyFile(join(sourceRoot, 'SBOM.cdx.json'), join(destination, 'SBOM.cdx.json'));
  await copyFile(
    join(sourceRoot, 'THIRD_PARTY_NOTICES.md'),
    join(destination, 'THIRD_PARTY_NOTICES.md'),
  );
  await copyFile(
    authority.approval_receipt_path,
    join(destination, 'approval', 'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json'),
  );
  for (const member of authority.identity.runtime_member_hashes) {
    const target = join(destination, 'bundle', member.relative_path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(authority.bundle_root, member.relative_path), target);
  }
}

export async function stageApprovedRuntimeV2(input) {
  const destination = resolve(input.destination);
  if (destination !== approvedStageRoot) throw new Error('STAGE_RUNTIME_DESTINATION_FORBIDDEN');
  const transportSha256 = await hashFile(resolve(input.transport));
  if (transportSha256 !== EXPECTED_TRANSPORT_SHA256) {
    throw new Error('STAGE_RUNTIME_TRANSPORT_HASH_MISMATCH');
  }

  const sourceRoot = resolve(input.sourceRoot);
  const sourceAuthority = await resolveApprovedRuntimeV2Authority({
    runtime_root: sourceRoot,
    runtime_manifest_path: join(sourceRoot, 'manifest.json'),
    approval_receipt_path: resolve(input.approval),
  });
  const sourceTree = await createRuntimeTreeEvidence({
    authority: sourceAuthority,
    runtime_root: sourceRoot,
    exact_member_set: false,
  });

  await rm(destination, { recursive: true, force: true });
  await copyApprovedDistribution(sourceAuthority, sourceRoot, destination);
  const stagedAuthority = await resolveApprovedRuntimeV2Authority({
    runtime_root: destination,
    runtime_manifest_path: join(destination, 'manifest.json'),
    approval_receipt_path: join(destination, 'approval', 'FFMPEG_RENDER_RUNTIME_APPROVAL_V2.json'),
  });
  const stagedTree = await createRuntimeTreeEvidence({
    authority: stagedAuthority,
    runtime_root: destination,
    exact_member_set: true,
  });
  assertRuntimeTreesEqual(sourceTree, stagedTree);

  const evidence = {
    schema_version: '1',
    record_kind: 'FFMPEG_RENDER_RUNTIME_BUILD_STAGING',
    status: 'PASS',
    transport_sha256: transportSha256,
    runtime_id: stagedAuthority.identity.runtime_id,
    source_extracted_tree_hash: sourceTree.runtime_tree_hash,
    build_staged_tree_hash: stagedTree.runtime_tree_hash,
    source_tree: sourceTree,
    staged_tree: stagedTree,
  };
  await mkdir(dirname(resolve(input.evidence)), { recursive: true });
  await writeFile(resolve(input.evidence), `${canonicalJson(evidence)}\n`);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const evidence = await stageApprovedRuntimeV2({
    transport: args.transport,
    sourceRoot: args['source-root'],
    approval: args.approval,
    destination: args.destination,
    evidence: args.evidence,
  });
  console.log(JSON.stringify(evidence));
}
