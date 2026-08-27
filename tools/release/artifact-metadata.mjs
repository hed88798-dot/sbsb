import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const repositoryRoot = process.cwd();

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
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

const artifactValue = argument('--artifact');
const outputValue = argument('--output');
if (!artifactValue || !outputValue) {
  console.error(
    'artifact-metadata: FAIL\nusage: node tools/release/artifact-metadata.mjs --artifact <file> --output <json> [--require-main]',
  );
  process.exit(1);
}

const artifactPath = resolve(repositoryRoot, artifactValue);
const outputPath = resolve(repositoryRoot, outputValue);
if (!statSync(artifactPath).isFile()) {
  console.error(`artifact-metadata: FAIL\nartifact is not a file: ${artifactPath}`);
  process.exit(1);
}
const commit = git(['rev-parse', 'HEAD']);
const trackedChanges = git(['status', '--porcelain', '--untracked-files=no']);
if (trackedChanges) {
  console.error('artifact-metadata: FAIL\ntracked source tree is dirty');
  process.exit(1);
}
if (process.argv.includes('--require-main')) {
  if (process.env.GITHUB_REF !== 'refs/heads/main') {
    console.error(
      `artifact-metadata: FAIL\nformal artifact must be built from refs/heads/main; got ${process.env.GITHUB_REF ?? 'unset'}`,
    );
    process.exit(1);
  }
}

const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const desktopManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'apps/desktop/package.json'), 'utf8'),
);
const migrations = readdirSync(resolve(repositoryRoot, 'migrations/desktop-sqlite'))
  .map((name) => /^(\d+)_.*\.sql$/.exec(name))
  .filter(Boolean)
  .map((match) => Number(match[1]));
const contractSource = readFileSync(
  resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
  'utf8',
);
const ipcVersion = /SCHEMA_VERSION_V1\s*=\s*['"]([^'"]+)/.exec(contractSource)?.[1] ?? 'UNKNOWN';
const sidecarVersion =
  /SIDECAR_PROTOCOL_VERSION_V1\s*=\s*['"]([^'"]+)/.exec(contractSource)?.[1] ?? 'UNKNOWN';
const artifactSha256 = await hashFile(artifactPath);
const metadata = {
  schema_version: '1.0',
  source: {
    git_commit: commit,
    git_ref: process.env.GITHUB_REF ?? git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit_timestamp: git(['show', '-s', '--format=%cI', 'HEAD']),
    source_tree_clean: true,
  },
  build: {
    workflow: process.env.GITHUB_WORKFLOW ?? 'LOCAL_UNVERIFIED',
    run_id: process.env.GITHUB_RUN_ID ?? argument('--run-id') ?? 'LOCAL_UNVERIFIED',
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'LOCAL_UNVERIFIED',
    built_at: process.env.BUILD_TIMESTAMP ?? new Date().toISOString(),
    node: rootManifest.engines.node,
    pnpm: rootManifest.engines.pnpm,
    electron: desktopManifest.devDependencies?.electron ?? rootManifest.devDependencies.electron,
  },
  application: {
    version: rootManifest.version,
    installer_version: desktopManifest.version,
    db_schema_version: migrations.length > 0 ? Math.max(...migrations) : 0,
    ipc_schema_version: ipcVersion,
    sidecar_protocol_version: sidecarVersion,
    sidecar_version: 'NOT_PRESENT_V0.1',
    model_pack_version: 'NOT_PRESENT_V0.1',
    model_manifest_sha256: null,
    ffmpeg_build_id: 'NOT_PRESENT_V0.1',
    whisper_build_id: 'NOT_PRESENT_V0.1',
  },
  artifact: {
    file_name: basename(artifactPath),
    size_bytes: statSync(artifactPath).size,
    sha256: artifactSha256,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`artifact-metadata: PASS (${artifactSha256})`);
