import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function argumentsMap(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for --${key}`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function required(args, key) {
  if (!args[key]) throw new Error(`missing --${key}`);
  return args[key];
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function writeRecord(directory, name, value) {
  const bytes = Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`, 'utf8');
  const path = resolve(directory, name);
  writeFileSync(path, bytes);
  return { id: value.record_id, sha256: sha256(bytes), path };
}

const args = argumentsMap(process.argv);
const platform = required(args, 'platform');
if (!['linux', 'windows'].includes(platform)) throw new Error('platform must be linux or windows');
const output = resolve(required(args, 'output'));
mkdirSync(output, { recursive: true });
const profile = readJson(required(args, 'profile'));
const loaderPolicy = readJson(required(args, 'loader-policy'));
const configureIntent = profile.build_configuration_constraints.configure_intent;
const extraConfigure = JSON.parse(args['extra-configure-json'] ?? '[]');
const configureArguments = [...configureIntent, ...extraConfigure];
const buildArguments = JSON.parse(args['build-json'] ?? '[]');
const compilerIdentity = required(args, 'compiler');
const toolchainIdentity = required(args, 'toolchain');
const runIdentity = args['run-id'] ?? process.env.GITHUB_RUN_ID ?? 'local';
const commit = args.commit ?? process.env.GITHUB_SHA ?? 'unknown';
const sourceArchiveSha256 = required(args, 'source-sha256');
const targetArchitecture = required(args, 'architecture');
const sourceIdentity = required(args, 'source-archive');
const prefix = `code-c-ffprobe-${platform}-${runIdentity}`;

const recipe = {
  schema_version: '1',
  record_kind: 'FFPROBE_BUILD_RECIPE',
  record_id: `${prefix}-recipe`,
  code_c_commit: commit,
  target: { platform, architecture: targetArchitecture },
  upstream: {
    release: '9.0.1',
    tag: 'n9.0.1',
    commit: 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa',
    source_archive: sourceIdentity,
    source_archive_sha256: sourceArchiveSha256,
  },
  authority: {
    profile_id: profile.profile_id,
    profile_sha256: profile.profile_sha256,
    loader_policy_id: loaderPolicy.record_id,
    loader_policy_sha256: loaderPolicy.record_sha256,
  },
  configure_arguments: configureArguments,
  build_arguments: buildArguments,
  compiler_identity: compilerIdentity,
  toolchain_identity: toolchainIdentity,
  enabled_components: ['ffprobe', 'demuxers', 'parsers', 'decoders', 'file-protocol'],
  disabled_components: [
    'ffmpeg',
    'ffplay',
    'network',
    'autodetect',
    'gpl',
    'nonfree',
    'doc',
    'debug',
  ],
  external_linked_libraries: [],
  linkage: 'SHARED',
  loader_strategy: platform === 'linux' ? 'ELF_RUNPATH_ORIGIN_V1' : 'APP_LOCAL_SAME_DIRECTORY_V1',
};
const recipeRecord = writeRecord(output, 'build-recipe.json', recipe);

const envAllowlist = [
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
  record_kind: 'FFPROBE_BUILD_ENVIRONMENT_DESCRIPTOR',
  record_id: `${prefix}-environment`,
  target: { platform, architecture: targetArchitecture },
  runner: {
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    image: process.env.ImageOS ?? process.env.ImageVersion ?? 'github-hosted-runner',
  },
  environment: Object.fromEntries(
    envAllowlist
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  ),
  compiler_identity: compilerIdentity,
  toolchain_identity: toolchainIdentity,
  generated_by: 'tools/ffprobe-build/create_records.mjs',
};
const environmentRecord = writeRecord(output, 'environment-descriptor.json', environment);

const context = {
  schema_version: '1',
  record_kind: 'FFPROBE_BUILD_CONTEXT',
  record_id: `${prefix}-context`,
  code_c_commit: commit,
  source_archive_identity: sourceIdentity,
  source_archive_sha256: sourceArchiveSha256,
  profile_id: profile.profile_id,
  profile_sha256: profile.profile_sha256,
  loader_policy_id: loaderPolicy.record_id,
  loader_policy_sha256: loaderPolicy.record_sha256,
  build_recipe_id: recipeRecord.id,
  build_recipe_sha256: recipeRecord.sha256,
  build_environment_descriptor_id: environmentRecord.id,
  build_environment_descriptor_sha256: environmentRecord.sha256,
  target: { platform, architecture: targetArchitecture },
  build_settings: {
    configure_arguments: configureArguments,
    build_arguments: buildArguments,
    external_linked_libraries: [],
    linkage: 'SHARED',
  },
};
const contextRecord = writeRecord(output, 'build-context.json', context);
writeFileSync(
  resolve(output, 'records-summary.json'),
  `${JSON.stringify(canonical({ recipe: recipeRecord, environment: environmentRecord, context: contextRecord }), null, 2)}\n`,
);
console.log(
  JSON.stringify({ recipe: recipeRecord, environment: environmentRecord, context: contextRecord }),
);
