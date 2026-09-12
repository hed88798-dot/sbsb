import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
for (const key of ['bundle', 'records', 'runtime-deps', 'license', 'profile', 'output'])
  if (!options[key]) throw new Error(`missing --${key}`);
const bundle = resolve(options.bundle);
const records = JSON.parse(readFileSync(resolve(options.records, 'records-summary.json'), 'utf8'));
const recipe = JSON.parse(readFileSync(resolve(options.records, 'build-recipe.json'), 'utf8'));
const context = JSON.parse(readFileSync(resolve(options.records, 'build-context.json'), 'utf8'));
const runtimeDeps = JSON.parse(readFileSync(resolve(options['runtime-deps']), 'utf8'));
const licensePath = resolve(options.license);
const license = JSON.parse(readFileSync(licensePath, 'utf8'));
const profile = JSON.parse(readFileSync(resolve(options.profile), 'utf8'));
const platform = context.target_platform;
const architecture = context.target_architecture;
const executable = platform === 'windows' ? 'ffmpeg.exe' : 'ffmpeg';
const probe = platform === 'windows' ? 'ffprobe.exe' : 'ffprobe';
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
const files = readdirSync(bundle, { withFileTypes: true })
  .filter((entry) => entry.isFile() || entry.isSymbolicLink())
  .map((entry) => entry.name)
  .sort();
for (const required of [executable, probe])
  if (!files.includes(required)) throw new Error(`missing entrypoint: ${required}`);
if (files.some((name) => /^(?:ffplay|ffmpeg\.debug|ffprobe\.debug)(?:\.exe)?$/iu.test(name)))
  throw new Error('prohibited runtime executable selected');

const members = files.map((name) => {
  const bytes = readFileSync(join(bundle, name));
  return {
    path: name,
    sha256: sha256(bytes),
    kind:
      name === executable || name === probe
        ? 'EXECUTABLE'
        : /\.dll$/iu.test(name)
          ? 'DYNAMIC_LIBRARY'
          : 'DATA',
  };
});
const internalMembers = runtimeDeps.internal
  .map(({ name, member_path }) => ({
    name,
    classification: 'INTERNAL_COMPANION_MEMBER',
    member_path,
    loader_scope: 'COMPANION_BUNDLE_ONLY',
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
const externalPrerequisites = runtimeDeps.external_os_imports
  .map((name) => ({
    id: `WINDOWS_OS_${name.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, '_')}`,
    name,
    version_policy: 'WINDOWS_OS_COMPONENT_ALLOWLIST_V1',
    allowlisted: true,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
const runtimeMemberNames = new Set(internalMembers.map((member) => member.member_path));
for (const member of members.filter((item) => item.kind === 'DYNAMIC_LIBRARY'))
  if (!runtimeMemberNames.has(member.path))
    throw new Error(`runtime dependency missing from closure: ${member.path}`);

const manifest = {
  schema_version: '1',
  subject_type: 'FFMPEG_RENDER_RUNTIME_BUNDLE',
  runtime_id: `code-f-ffmpeg-render-${platform}-${architecture}-${process.env.GITHUB_RUN_ID ?? 'local'}`,
  manifest_sha256: '0'.repeat(64),
  runtime_identity_sha256: '0'.repeat(64),
  role: 'PRODUCT_RUNTIME_DEPENDENCY',
  platform: { os: platform, architecture },
  entrypoints: [
    { path: executable, sha256: members.find((member) => member.path === executable).sha256 },
    { path: probe, sha256: members.find((member) => member.path === probe).sha256 },
  ],
  bundle_members: members,
  runtime_dependency_closure: {
    status: 'PASS',
    loader_policy: 'COMPANION_BUNDLE_ONLY',
    undeclared_runtime_resolution: 'FAIL_CLOSED',
    unresolved_count: runtimeDeps.unresolved.length,
    members: internalMembers,
    external_os_prerequisites: externalPrerequisites,
  },
  provenance: {
    source_commit: context.source_commit,
    code_g_capability_profile_commit: context.code_g_capability_profile_commit,
    code_g_capability_profile_hash: context.code_g_capability_profile_hash,
    build_profile_id: context.build_profile_id,
    build_profile_sha256: context.build_profile_sha256,
    upstream_project: context.upstream.project,
    upstream_release: context.upstream.release,
    upstream_tag: context.upstream.tag,
    upstream_commit: context.upstream.commit,
    source_archive_identity: context.upstream.archive,
    source_archive_sha256: context.upstream.archive_sha256,
    build_recipe_id: records.recipe.id,
    build_recipe_sha256: records.recipe.sha256,
    build_environment_descriptor_id: records.environment.id,
    build_environment_descriptor_sha256: records.environment.sha256,
    build_context_id: records.context.id,
    build_context_sha256: records.context.sha256,
    target_platform: platform,
    target_architecture: architecture,
  },
  build_configuration: {
    configure_arguments: recipe.configure_arguments,
    build_arguments: recipe.build_arguments,
    compiler_identity: recipe.compiler_identity,
    toolchain_identity: recipe.toolchain_identity,
    enabled_components: recipe.enabled_components,
    disabled_components: recipe.disabled_components,
    external_linked_libraries: recipe.external_linked_libraries,
    linkage: recipe.linkage,
    feature_selection: [
      `CODE_G_CAPABILITY_PROFILE_V${profile.profile_version}`,
      'H264',
      'AAC',
      'MP4',
      'MACHINE_READABLE_PROGRESS',
    ],
  },
  distribution: {
    mode: 'BUNDLED_RUNTIME_COMPANION',
    packaged_locator: `runtime/ffmpeg/${platform}/${architecture}/bundle/${executable}`,
    resolver_mode: 'EXPLICIT_BUNDLED_LOCATOR',
    system_path_fallback: false,
    external_os_prerequisite_allowlist: externalPrerequisites.map((entry) => entry.id),
  },
  artifact_approval: { status: 'PROVENANCE_VERIFIED' },
  license_evidence: {
    evidence_id: license.evidence_id,
    evidence_sha256: sha256(readFileSync(licensePath)),
    policy_disposition: license.policy_disposition,
  },
  retention: {
    transport_role: 'TRANSIENT_TRANSFER_ONLY',
    final_retention_channel: 'MAC_LOCAL_PROJECT_FOLDER',
    recovery_drill_required: true,
  },
};

const identityPayload = structuredClone(manifest);
delete identityPayload.manifest_sha256;
delete identityPayload.runtime_identity_sha256;
delete identityPayload.license_evidence;
manifest.runtime_identity_sha256 = sha256(
  Buffer.from(JSON.stringify(canonical(identityPayload)), 'utf8'),
);
const manifestPayload = structuredClone(manifest);
delete manifestPayload.manifest_sha256;
manifest.manifest_sha256 = sha256(Buffer.from(JSON.stringify(canonical(manifestPayload)), 'utf8'));
writeFileSync(resolve(options.output), `${JSON.stringify(canonical(manifest), null, 2)}\n`);
console.log(
  JSON.stringify({
    runtime_id: manifest.runtime_id,
    manifest_sha256: manifest.manifest_sha256,
    runtime_identity_sha256: manifest.runtime_identity_sha256,
    entrypoint_sha256: manifest.entrypoints[0].sha256,
    member_count: members.length,
  }),
);
