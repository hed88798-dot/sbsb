import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}

const options = parseArgs(process.argv);
for (const key of ['root', 'platform', 'candidate-id', 'profile', 'manifest', 'records', 'output'])
  if (!options[key]) throw new Error(`missing --${key}`);

const root = resolve(options.root);
const profile = JSON.parse(readFileSync(resolve(options.profile), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
const records = JSON.parse(readFileSync(resolve(options.records, 'build-context.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) {
      const bytes = readFileSync(path);
      files.push({
        path: relative(root, path).replaceAll('\\', '/'),
        size_bytes: statSync(path).size,
        sha256: sha256(bytes),
      });
    }
  }
}
walk(root);
const transfer = {
  schema_version: '1',
  record_kind: 'FFMPEG_RENDER_CANDIDATE_TRANSFER_MANIFEST',
  candidate_id: options['candidate-id'],
  transfer_role: 'TRANSIENT_ACTIONS_ARTIFACT',
  final_retention_logical_root: `frozen-candidates/${options['candidate-id']}/${options.platform}/`,
  platform: options.platform,
  architecture: manifest.platform.architecture,
  source_commit: records.source_commit,
  code_g_capability_profile_commit: profile.code_g_capability_profile.commit,
  code_g_capability_profile_hash: profile.code_g_capability_profile.profile_hash,
  build_profile_id: profile.profile_id,
  build_profile_sha256: profile.profile_sha256,
  build_context_id: records.record_id,
  build_context_sha256: sha256(readFileSync(resolve(options.records, 'build-context.json'))),
  runtime_identity_sha256: manifest.runtime_identity_sha256,
  runtime_manifest_sha256: manifest.manifest_sha256,
  files: files.sort((left, right) => left.path.localeCompare(right.path)),
  retention: {
    actions_artifact_retention_days: 1,
    mac_local_project_folder_required: true,
    recovery_drill_required: true,
  },
};
const output = resolve(options.output);
writeFileSync(output, `${JSON.stringify(transfer, null, 2)}\n`);
console.log(
  JSON.stringify({
    candidate_id: transfer.candidate_id,
    file_count: files.length,
    sha256: sha256(readFileSync(output)),
  }),
);
