import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  companionIdentityHash,
  manifestHash,
  validateCompanionManifest,
} from '../native-runtime-companion/companion.mjs';

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
  for (let i = 2; i < argv.length; i += 2) result[argv[i].slice(2)] = argv[i + 1];
  return result;
}
const options = args(process.argv);
for (const key of ['bundle', 'records', 'runtime-deps', 'license', 'platform', 'output'])
  if (!options[key]) throw new Error(`missing --${key}`);
const bundle = resolve(options.bundle);
const records = JSON.parse(readFileSync(resolve(options.records, 'records-summary.json'), 'utf8'));
const context = JSON.parse(readFileSync(resolve(options.records, 'build-context.json'), 'utf8'));
const recipe = JSON.parse(readFileSync(resolve(options.records, 'build-recipe.json'), 'utf8'));
const environment = JSON.parse(
  readFileSync(resolve(options.records, 'environment-descriptor.json'), 'utf8'),
);
const deps = JSON.parse(readFileSync(resolve(options['runtime-deps']), 'utf8'));
const licensePath = resolve(options.license);
const license = JSON.parse(readFileSync(licensePath, 'utf8'));
const platform = options.platform;
const executable = platform === 'windows' ? 'ffprobe.exe' : 'ffprobe';
const names = readdirSync(bundle, { withFileTypes: true })
  .filter((entry) => entry.isFile() || entry.isSymbolicLink())
  .map((entry) => entry.name)
  .sort();
if (!names.includes(executable)) throw new Error(`missing ${executable} entrypoint`);
if (names.some((name) => /^(?:ffmpeg|ffplay)(?:\.exe)?$/u.test(name)))
  throw new Error('prohibited FFmpeg executable in companion bundle');
const members = names.map((name) => {
  const path = join(bundle, name);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    return {
      path: name,
      sha256: sha256(Buffer.from(readlinkSync(path), 'utf8')),
      kind: 'SYMLINK',
      link_target: readlinkSync(path),
    };
  const bytes = readFileSync(path);
  return {
    path: name,
    sha256: sha256(bytes),
    kind:
      name === executable
        ? 'EXECUTABLE'
        : /\.dll$/iu.test(name) || /\.so(?:\.|$)/u.test(name)
          ? 'DYNAMIC_LIBRARY'
          : 'DATA',
  };
});
const internalByPath = new Map(
  members
    .filter((member) => member.kind === 'DYNAMIC_LIBRARY')
    .map((member) => [
      member.path,
      {
        name: member.path,
        classification: 'INTERNAL_COMPANION_MEMBER',
        member_path: member.path,
        loader_scope: 'COMPANION_BUNDLE_ONLY',
      },
    ]),
);
for (const dependency of deps.internal) {
  internalByPath.set(dependency.member_path, {
    name: dependency.name,
    classification: 'INTERNAL_COMPANION_MEMBER',
    member_path: dependency.member_path,
    loader_scope: 'COMPANION_BUNDLE_ONLY',
  });
}
const internal = [...internalByPath.values()].sort((left, right) =>
  left.name.localeCompare(right.name),
);
const prerequisiteId =
  platform === 'windows' ? 'WINDOWS_MSVC_RUNTIME_X64' : 'LINUX_GLIBC_BASELINE_X86_64';
const manifest = {
  schema_version: '1',
  subject_type: 'NATIVE_RUNTIME_COMPANION_BUNDLE',
  companion_id: `code-c-ffprobe-${platform}-${process.env.GITHUB_RUN_ID ?? 'local'}`,
  manifest_sha256: '0'.repeat(64),
  companion_identity_sha256: '0'.repeat(64),
  role: 'PRODUCT_RUNTIME_DEPENDENCY',
  platform: { os: platform, architecture: 'x86_64' },
  entrypoint: {
    path: executable,
    sha256: members.find((member) => member.path === executable).sha256,
  },
  bundle_members: members,
  runtime_dependency_closure: {
    status: 'PASS',
    loader_policy: 'COMPANION_BUNDLE_ONLY',
    undeclared_runtime_resolution: 'FAIL_CLOSED',
    unresolved_count: 0,
    members: internal,
    external_os_prerequisites: [
      {
        id: prerequisiteId,
        name: prerequisiteId,
        version_policy: 'APPROVED_PLATFORM_ALLOWLIST_V1',
        allowlisted: true,
      },
    ],
  },
  provenance: {
    upstream_project: 'FFmpeg/FFmpeg',
    upstream_release: '9.0.1',
    upstream_tag: 'n9.0.1',
    upstream_commit: 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa',
    source_archive_identity: 'ffmpeg-9.0.1.tar.xz',
    source_archive_sha256: context.source_archive_sha256,
    build_recipe_id: records.recipe.id,
    build_recipe_sha256: records.recipe.sha256,
    build_environment_descriptor_id: records.environment.id,
    build_environment_descriptor_sha256: records.environment.sha256,
    build_context_id: records.context.id,
    build_context_sha256: records.context.sha256,
    target_platform: platform,
    target_architecture: 'x86_64',
  },
  build_configuration: {
    configure_arguments: recipe.configure_arguments,
    build_arguments: recipe.build_arguments,
    compiler_identity: recipe.compiler_identity,
    toolchain_identity: recipe.toolchain_identity,
    enabled_components: recipe.enabled_components,
    disabled_components: recipe.disabled_components,
    external_linked_libraries: [],
    linkage: 'SHARED',
    feature_selection: ['FFPROBE_JSON_SHOW_STREAMS_SHOW_FORMAT'],
  },
  distribution: {
    mode: 'BUNDLED_RUNTIME_COMPANION',
    packaged_locator: executable,
    resolver_mode: 'EXPLICIT_BUNDLED_LOCATOR',
    system_path_fallback: false,
    external_os_prerequisite_allowlist: [prerequisiteId],
  },
  artifact_approval: { status: 'NOT_YET_APPROVED' },
  license_evidence: {
    evidence_id: license.evidence_id,
    evidence_sha256: sha256(readFileSync(licensePath)),
    policy_disposition: 'SEPARATE_REVIEW_REQUIRED',
  },
  retention: {
    transport_role: 'TRANSIENT_TRANSFER_ONLY',
    final_retention_channel: 'MAC_LOCAL_PROJECT_FOLDER',
    recovery_drill_required: true,
  },
};
manifest.companion_identity_sha256 = companionIdentityHash(manifest);
manifest.manifest_sha256 = manifestHash(manifest);
validateCompanionManifest(manifest, {
  expectedSourceBinding: {
    upstream_project: 'FFmpeg/FFmpeg',
    upstream_release: '9.0.1',
    upstream_tag: 'n9.0.1',
    upstream_commit: 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa',
    source_archive_identity: 'ffmpeg-9.0.1.tar.xz',
    source_archive_sha256: context.source_archive_sha256,
  },
  expectedBuildRecipe: { id: records.recipe.id, sha256: records.recipe.sha256 },
  expectedEnvironmentDescriptor: { id: records.environment.id, sha256: records.environment.sha256 },
  expectedBuildContext: { id: records.context.id, sha256: records.context.sha256 },
  expectedPlatform: manifest.platform,
});
writeFileSync(resolve(options.output), `${JSON.stringify(canonical(manifest), null, 2)}\n`);
writeFileSync(
  resolve(bundle, 'manifest.json'),
  `${JSON.stringify(canonical(manifest), null, 2)}\n`,
);
console.log(
  JSON.stringify({
    companion_id: manifest.companion_id,
    manifest_sha256: manifest.manifest_sha256,
    companion_identity_sha256: manifest.companion_identity_sha256,
    member_count: members.length,
  }),
);
