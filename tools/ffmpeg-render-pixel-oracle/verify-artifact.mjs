import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const profilePath = resolve(
  repositoryRoot,
  'tools/ffmpeg-render-pixel-oracle/CODE_F_ROTATION_PIXEL_ORACLE_BUILD_PROFILE_V1.json',
);
const expectedSourceCommit = 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa';
const expectedSourceSha = 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635';
const SHA256 = /^[0-9a-f]{64}$/u;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return resolve(process.argv[index + 1]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasToken(output, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?=\\s|,|$)`, 'mu').test(output);
}

function listing(binary, command) {
  const result = spawnSync(binary, ['-hide_banner', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error || result.status !== 0)
    throw new Error(`${command} inspection failed: ${result.error?.message ?? output}`);
  return output;
}

function parserAvailable(binary, parser) {
  // FFmpeg exposes no parser-list CLI (unlike codecs/demuxers). Inspect the
  // linked executable's retained registration string, then rely on the
  // decoder/parser path during the downstream fixture smoke.
  const executableText = readFileSync(binary, 'latin1');
  return new RegExp(`${parser}_(?:parser|parse)`, 'iu').test(executableText);
}

function bundleFiles(root) {
  const bundleRoot = resolve(root, 'bundle');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).replaceAll('\\', '/'));
    }
  };
  visit(bundleRoot);
  return files.sort();
}

const root = argument('--root');
const manifestPath = resolve(root, 'pixel-oracle-manifest.json');
const manifestSidecarPath = `${manifestPath}.sha256`;
const manifest = readJson(manifestPath);
const binaryPath = resolve(root, manifest.entrypoint);

assert(manifest.tool_role === 'TEST_ONLY', 'pixel oracle must be TEST_ONLY');
assert(
  manifest.product_runtime_identity_effect === 'NONE',
  'pixel oracle must not affect product runtime',
);
assert(
  manifest.package_inclusion === 'FORBIDDEN',
  'pixel oracle package inclusion must be FORBIDDEN',
);
assert(manifest.source?.commit === expectedSourceCommit, 'unexpected FFmpeg source commit');
assert(
  manifest.source?.archive_sha256 === expectedSourceSha,
  'unexpected FFmpeg source archive hash',
);
assert(manifest.build_profile?.sha256 === sha256File(profilePath), 'build profile hash mismatch');
assert(existsSync(binaryPath), `missing oracle entrypoint: ${manifest.entrypoint}`);
assert(SHA256.test(manifest.ffmpeg_sha256), 'manifest ffmpeg hash is not SHA-256');
assert(
  sha256File(binaryPath) === manifest.ffmpeg_sha256,
  'entrypoint hash does not match manifest',
);

const declaredMembers = [...(manifest.members ?? [])]
  .map((member) => member.path.replaceAll('\\', '/'))
  .sort();
const actualMembers = bundleFiles(root);
assert(
  JSON.stringify(actualMembers) === JSON.stringify(declaredMembers),
  `bundle members differ from manifest: ${JSON.stringify(actualMembers)} != ${JSON.stringify(declaredMembers)}`,
);
for (const member of manifest.members) {
  const memberPath = resolve(root, member.path);
  assert(sha256File(memberPath) === member.sha256, `member hash mismatch: ${member.path}`);
}

const sidecar = readFileSync(manifestSidecarPath, 'utf8').trim().split(/\s+/u);
assert(sidecar[0] === sha256File(manifestPath), 'manifest sidecar hash mismatch');
assert(
  sidecar.slice(1).join(' ') === 'pixel-oracle-manifest.json',
  'manifest sidecar path mismatch',
);

const demuxers = listing(binaryPath, '-demuxers');
const decoders = listing(binaryPath, '-decoders');
const encoders = listing(binaryPath, '-encoders');
const muxers = listing(binaryPath, '-muxers');
const filters = listing(binaryPath, '-filters');
const pixelFormats = listing(binaryPath, '-pix_fmts');
const protocols = listing(binaryPath, '-protocols');
const devices = listing(binaryPath, '-devices');

const checks = {
  mov_demux: hasToken(demuxers, 'mov'),
  h264_decoder: hasToken(decoders, 'h264'),
  h264_parser: parserAvailable(binaryPath, 'h264'),
  format_filter: hasToken(filters, 'format'),
  rgb24_pixel_format: hasToken(pixelFormats, 'rgb24'),
  rawvideo_encoder: hasToken(encoders, 'rawvideo'),
  rawvideo_muxer: hasToken(muxers, 'rawvideo'),
  file_protocol: hasToken(protocols, 'file'),
  network_absent: !['http', 'https', 'ftp', 'rtmp', 'rtsp', 'tcp', 'udp'].some((name) =>
    hasToken(protocols, name),
  ),
  h264_mf_absent: !hasToken(encoders, 'h264_mf'),
  aac_absent: !hasToken(encoders, 'aac'),
  devices_absent: !/^\s*(?:D\.|\.E|DE)\s+(?![.=])/mu.test(devices),
};
for (const [name, value] of Object.entries(checks))
  assert(value, `static capability check failed: ${name}`);

const evidence = {
  schema_version: '1',
  record_kind: 'CODE_F_ROTATION_PIXEL_ORACLE_STATIC_CAPABILITY_INSPECTION',
  artifact_entrypoint: manifest.entrypoint,
  artifact_sha256: manifest.ffmpeg_sha256,
  checks,
  inspection_commands: {
    demuxers: '-hide_banner -demuxers',
    decoders: '-hide_banner -decoders',
    encoders: '-hide_banner -encoders',
    muxers: '-hide_banner -muxers',
    filters: '-hide_banner -filters',
    pixel_formats: '-hide_banner -pix_fmts',
    protocols: '-hide_banner -protocols',
    parser_h264: 'binary registration string scan for h264_parser/h264_parse',
    devices: '-hide_banner -devices',
  },
};
writeFileSync(
  resolve(root, 'evidence/static-capability-inspection.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence));
