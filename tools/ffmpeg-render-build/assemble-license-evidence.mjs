import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${key}`);
    result[key.slice(2)] = value;
  }
  return result;
}
const options = args(process.argv);
for (const key of ['source', 'records', 'profile', 'output'])
  if (!options[key]) throw new Error(`missing --${key}`);
const source = resolve(options.source);
const profile = JSON.parse(readFileSync(resolve(options.profile), 'utf8'));
const recipe = JSON.parse(readFileSync(resolve(options.records, 'build-recipe.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [];
function walk(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path, name);
    else if (/^(?:copying|license|notice|copyright|authors)(?:\.|$)/iu.test(entry.name))
      files.push({ path: name, bytes: statSync(path).size, sha256: sha256(readFileSync(path)) });
  }
}
walk(source);
if (!files.length) throw new Error('no FFmpeg upstream license evidence files found');
const configure = recipe.configure_arguments;
const required = (value) => configure.includes(value);
for (const value of ['--disable-gpl', '--disable-nonfree', '--disable-autodetect'])
  if (!required(value)) throw new Error(`license-safe configure flag missing: ${value}`);
for (const value of ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265'])
  if (required(value)) throw new Error(`forbidden license configure flag present: ${value}`);
const evidence = {
  schema_version: '1',
  evidence_id: `code-f-ffmpeg-render-${recipe.target.platform}-${process.env.GITHUB_RUN_ID ?? 'local'}-license`,
  subject: {
    upstream_project: profile.upstream_source.project,
    upstream_release: profile.upstream_source.release,
    source_archive: profile.upstream_source.archive,
    source_archive_sha256: profile.upstream_source.archive_sha256,
    build_profile_id: profile.profile_id,
    build_profile_sha256: profile.profile_sha256,
  },
  platform: recipe.target,
  exact_upstream_license_files: files.sort((left, right) => left.path.localeCompare(right.path)),
  configure_license_controls: {
    gpl: 'DISABLED',
    nonfree: 'DISABLED',
    libx264: 'NOT_INCLUDED_BY_PROFILE',
    libx265: 'NOT_INCLUDED_BY_PROFILE',
    external_linked_libraries: recipe.external_linked_libraries,
  },
  software_license_expression: 'LGPL-2.1-or-later',
  obligations: [
    'retain exact license and notice files',
    'provide corresponding source and build configuration for the distributed LGPL components',
    'preserve relinkability/replacement path for LGPL-covered shared components',
  ],
  codec_patent_consideration:
    'H264_AND_AAC_PATENT_OR_CODEC_PROGRAM_REQUIREMENTS_ARE_SEPARATE_FROM_SOURCE_LICENSE',
  policy_disposition: 'ALLOW_WITH_CONDITIONS',
  artifact_approval: 'PROVENANCE_VERIFIED_ONLY',
};
writeFileSync(resolve(options.output), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify({
    evidence_id: evidence.evidence_id,
    file_count: files.length,
    sha256: sha256(readFileSync(resolve(options.output))),
  }),
);
