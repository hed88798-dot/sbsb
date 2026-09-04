import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function args(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 2) result[argv[i].slice(2)] = argv[i + 1];
  return result;
}
const options = args(process.argv);
if (!options.source || !options.output || !options.platform || !options['source-sha256'])
  throw new Error('source, output, platform and source-sha256 are required');
const source = resolve(options.source);
const names = [];
function walk(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path, name);
    else if (/^(?:copying|license|notice|copyright|authors)(?:\.|$)/iu.test(entry.name))
      names.push(name);
  }
}
walk(source);
if (!names.length) throw new Error('no upstream license evidence files found');
const files = names.sort().map((path) => ({
  path,
  sha256: sha256(readFileSync(join(source, path))),
  bytes: statSync(join(source, path)).size,
}));
const evidence = {
  schema_version: '1',
  evidence_id: `code-c-ffprobe-${options.platform}-license-${process.env.GITHUB_RUN_ID ?? 'local'}`,
  subject: {
    upstream_project: 'FFmpeg/FFmpeg',
    release: '9.0.1',
    source_archive_sha256: options['source-sha256'],
  },
  platform: options.platform,
  exact_license_files: files,
  policy_disposition: 'SEPARATE_REVIEW_REQUIRED',
  artifact_approval: 'NOT_YET_APPROVED',
};
writeFileSync(resolve(options.output), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify({
    evidence_id: evidence.evidence_id,
    file_count: files.length,
    sha256: sha256(readFileSync(resolve(options.output))),
  }),
);
