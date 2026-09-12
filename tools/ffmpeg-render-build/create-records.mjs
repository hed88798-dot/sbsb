import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const profilePath = resolve(
  root,
  process.env.FFMPEG_RENDER_PROFILE_PATH ??
    'compliance/runtime-dependency-intake/ffmpeg-render-v1/FFMPEG_RENDER_BUILD_PROFILE_V1.json',
);
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

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
for (const key of [
  'platform',
  'architecture',
  'output',
  'compiler',
  'toolchain',
  'configure-json',
  'build-json',
])
  if (!options[key]) throw new Error(`missing --${key}`);
const platform = options.platform;
const architecture = options.architecture;
const configureArguments = JSON.parse(options['configure-json']);
const buildArguments = JSON.parse(options['build-json']);
if (!Array.isArray(configureArguments) || !Array.isArray(buildArguments))
  throw new Error('configure/build arguments must be arrays');
if (!profile.platform_builds[`${platform}-${architecture}`])
  throw new Error(`platform is not declared by the profile: ${platform}-${architecture}`);

const runIdentity = process.env.GITHUB_RUN_ID ?? 'local';
const commit = process.env.GITHUB_SHA ?? 'unknown';
const sourceTree = process.env.FFMPEG_SOURCE_TREE_SHA ?? 'unknown';
const idPrefix = `code-f-ffmpeg-render-${platform}-${architecture}-${runIdentity}`;
const target = { platform, architecture };
const upstream = {
  project: profile.upstream_source.project,
  release: profile.upstream_source.release,
  tag: profile.upstream_source.tag,
  commit: profile.upstream_source.commit,
  archive: profile.upstream_source.archive,
  archive_sha256: profile.upstream_source.archive_sha256,
};

function writeRecord(name, value) {
  const bytes = Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`, 'utf8');
  const path = resolve(options.output, name);
  writeFileSync(path, bytes);
  return { id: value.record_id, sha256: sha256(bytes), path };
}

mkdirSync(resolve(options.output), { recursive: true });
const recipe = {
  schema_version: '1',
  record_kind: 'FFMPEG_RENDER_BUILD_RECIPE',
  record_id: `${idPrefix}-recipe`,
  source_commit: commit,
  source_tree_sha: sourceTree,
  target,
  upstream,
  authority: {
    code_g_capability_profile_commit: profile.code_g_capability_profile.commit,
    code_g_capability_profile_hash: profile.code_g_capability_profile.profile_hash,
    build_profile_id: profile.profile_id,
    build_profile_sha256: profile.profile_sha256,
  },
  configure_arguments: configureArguments,
  build_arguments: buildArguments,
  compiler_identity: options.compiler,
  toolchain_identity: options.toolchain,
  enabled_components: [
    'ffmpeg',
    'ffprobe',
    'all-non-gpl-demuxers',
    'all-non-gpl-parsers',
    'all-non-gpl-decoders',
    ...profile.required_components.video_filters.map((value) => `filter:${value}`),
    ...profile.required_components.audio_filters.map((value) => `filter:${value}`),
    'encoder:aac',
    `encoder:${platform === 'windows' ? 'h264_mf' : 'h264_videotoolbox'}`,
    'encoder-input-format:nv12',
    'muxer:mov',
    'muxer:mp4',
    'protocol:file',
    'protocol:pipe',
  ],
  disabled_components: [
    'ffplay',
    'network-protocols',
    'devices',
    'autodetect',
    'gpl',
    'nonfree',
    'libx264',
    'libx265',
  ],
  external_linked_libraries: [],
  linkage: 'SHARED',
  loader_strategy: 'APP_LOCAL_SAME_DIRECTORY_V1',
};
const recipeRecord = writeRecord('build-recipe.json', recipe);

const environmentAllowlist = [
  'GITHUB_ACTIONS',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT',
  'GITHUB_SHA',
  'GITHUB_REF',
  'RUNNER_OS',
  'RUNNER_ARCH',
  'ImageOS',
  'ImageVersion',
  'MSYSTEM',
];
const environment = {
  schema_version: '1',
  record_kind: 'FFMPEG_RENDER_BUILD_ENVIRONMENT_DESCRIPTOR',
  record_id: `${idPrefix}-environment`,
  target,
  runner: {
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    image: process.env.ImageOS ?? process.env.ImageVersion ?? 'github-hosted-runner',
  },
  environment: Object.fromEntries(
    environmentAllowlist
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  ),
  compiler_identity: options.compiler,
  toolchain_identity: options.toolchain,
  generated_by: 'tools/ffmpeg-render-build/create-records.mjs',
};
const environmentRecord = writeRecord('environment-descriptor.json', environment);

const context = {
  schema_version: '1',
  record_kind: 'FFMPEG_RENDER_BUILD_CONTEXT',
  record_id: `${idPrefix}-context`,
  source_commit: commit,
  source_tree_sha: sourceTree,
  target,
  upstream,
  code_g_capability_profile_commit: profile.code_g_capability_profile.commit,
  code_g_capability_profile_hash: profile.code_g_capability_profile.profile_hash,
  build_profile_id: profile.profile_id,
  build_profile_sha256: profile.profile_sha256,
  build_recipe_id: recipeRecord.id,
  build_recipe_sha256: recipeRecord.sha256,
  build_environment_descriptor_id: environmentRecord.id,
  build_environment_descriptor_sha256: environmentRecord.sha256,
  configure_arguments: configureArguments,
  build_arguments: buildArguments,
  target_platform: platform,
  target_architecture: architecture,
};
const contextRecord = writeRecord('build-context.json', context);
writeFileSync(
  resolve(options.output, 'records-summary.json'),
  `${JSON.stringify(canonical({ recipe: recipeRecord, environment: environmentRecord, context: contextRecord }), null, 2)}\n`,
);
console.log(
  JSON.stringify({ recipe: recipeRecord, environment: environmentRecord, context: contextRecord }),
);
