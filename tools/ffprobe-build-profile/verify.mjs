import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson } from '../native-runtime-companion/companion.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');
const evidenceRoot = resolve(repositoryRoot, 'compliance/runtime-dependency-intake/ffprobe-v2');
const schemaRoot = resolve(repositoryRoot, 'schemas/compliance/ffprobe-build-profile/v1');
const SHA256 = /^[0-9a-f]{64}$/u;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validators = {
  capability: ajv.compile(readJson(resolve(schemaRoot, 'capability-set.schema.json'))),
  profile: ajv.compile(readJson(resolve(schemaRoot, 'profile.schema.json'))),
  security: ajv.compile(readJson(resolve(schemaRoot, 'security-intake.schema.json'))),
  pin: ajv.compile(readJson(resolve(schemaRoot, 'pin-record.schema.json'))),
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashCanonicalWithout(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return sha256Bytes(JSON.stringify(canonicalJson(copy)));
}

function hashCanonical(value) {
  return sha256Bytes(JSON.stringify(canonicalJson(value)));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSchema(validate, value, label) {
  assert(
    validate(value),
    `${label} schema invalid: ${(validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`,
  );
}

function assertSha(value, label) {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function assertExactSidecar(jsonPath, expected) {
  const sidecar = `${jsonPath.slice(0, -'.json'.length)}.sha256`;
  const sidecarText = readFileSync(sidecar, 'utf8').trim();
  const actual = sha256Bytes(readFileSync(jsonPath));
  const [sidecarHash, ...sidecarPath] = sidecarText.split(/\s+/u);
  assert(sidecarHash && SHA256.test(sidecarHash), `${sidecar} does not contain a SHA-256`);
  assert(
    sidecarPath.join(' ') === relative(repositoryRoot, jsonPath).replaceAll('\\', '/'),
    `${sidecar} does not bind the expected JSON path`,
  );
  assert(actual === sidecarHash, `${jsonPath} exact-byte hash mismatch`);
  assert(expected && SHA256.test(expected), `${jsonPath} semantic hash is invalid`);
}

function setFrom(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  return new Set(values);
}

function assertSubset(required, provided, label) {
  const missing = [...setFrom(required, `${label}.required`)].filter(
    (item) => !setFrom(provided, `${label}.provided`).has(item),
  );
  assert(missing.length === 0, `${label} missing required capabilities: ${missing.join(', ')}`);
}

function verifyCapabilitySet(capability) {
  assertSchema(validators.capability, capability, 'required media capability set');
  assertSha(capability.capability_set_sha256, 'capability_set_sha256');
  assert(
    hashCanonicalWithout(capability, 'capability_set_sha256') === capability.capability_set_sha256,
    'required media capability set self hash mismatch',
  );
  assert(
    capability.required_media_capabilities.probe_fields.includes('duration'),
    'duration probe capability is required',
  );
  assert(
    capability.required_media_capabilities.probe_fields.includes('streams'),
    'streams probe capability is required',
  );
  assert(
    capability.required_media_capabilities.format_scope === 'FORMAT_NEUTRAL_LOCAL_MEDIA',
    'format-neutral media scope is required',
  );
  assert(
    capability.scope_constraints.implicit_format_narrowing === 'FORBIDDEN',
    'implicit format narrowing must be forbidden',
  );
}

function verifySecurity(security) {
  assertSchema(validators.security, security, 'FFmpeg release security intake');
  assertSha(security.snapshot_sha256, 'snapshot_sha256');
  assert(
    hashCanonicalWithout(security, 'snapshot_sha256') === security.snapshot_sha256,
    'security intake self hash mismatch',
  );
  assert(
    security.selected_release.release_version === '9.0.1',
    'security intake release differs from pinned release',
  );
  assert(
    security.selected_release.release_tag === 'n9.0.1',
    'security intake tag differs from pinned tag',
  );
  assert(
    security.outcome.ffmpeg_release_support_status === 'ACCEPTABLE',
    'FFmpeg release is not acceptable',
  );
  assert(
    security.outcome.ffmpeg_release_security_intake === 'PASS',
    'FFmpeg security intake is not PASS',
  );
  assert(
    security.outcome.known_relevant_advisory_review === 'PASS',
    'relevant advisory review is not PASS',
  );
  assert(
    security.outcome.blocking_advisories_identified === 0,
    'blocking upstream advisory was identified',
  );
}

function verifyProfile(profile, capability) {
  assertSchema(validators.profile, profile, 'ffprobe build profile');
  assertSha(profile.profile_sha256, 'profile_sha256');
  assert(
    hashCanonicalWithout(profile, 'profile_sha256') === profile.profile_sha256,
    'build profile self hash mismatch',
  );
  assert(
    profile.product_capability_authority.required_media_capability_set_id === capability.record_id,
    'profile capability set ID mismatch',
  );
  assert(
    profile.product_capability_authority.required_media_capability_set_sha256 ===
      capability.capability_set_sha256,
    'profile capability set SHA mismatch',
  );
  assert(profile.capability_coverage.status === 'PASS', 'profile capability coverage is not PASS');
  assert(
    profile.capability_coverage.no_silent_format_narrowing === true,
    'profile permits silent format narrowing',
  );
  assert(
    profile.protocol_policy.declared_protocol_set.length === 1 &&
      profile.protocol_policy.declared_protocol_set[0] === 'file',
    'only the file protocol may be declared',
  );
  assert(
    profile.protocol_policy.undeclared_protocol_enablement === 'FORBIDDEN',
    'undeclared protocol enablement must fail closed',
  );
  assert(
    profile.protocol_policy.network_protocol_policy === 'DISABLED',
    'network protocol policy must be disabled',
  );
  assert(
    profile.protocol_policy.network_protocol_allowlist.length === 0,
    'network protocol allowlist must be empty',
  );
  assert(
    profile.external_library_policy.build_autodetection_policy === 'FAIL_CLOSED',
    'external library autodetection must fail closed',
  );
  assert(
    profile.external_library_policy.undeclared_external_library_policy === 'FORBIDDEN',
    'undeclared external libraries must be forbidden',
  );
  assert(
    profile.external_library_policy.declared_external_library_set.length === 0,
    'profile must not declare an external library',
  );
  assert(
    profile.external_library_policy.declared_external_library_set_sha256 ===
      hashCanonical(profile.external_library_policy.declared_external_library_set),
    'declared external library set hash mismatch',
  );
  assert(
    profile.license_oriented_build_constraints.GPL_COMPONENT_POLICY === 'FORBIDDEN',
    'GPL components must be forbidden',
  );
  assert(
    profile.license_oriented_build_constraints.NONFREE_COMPONENT_POLICY === 'FORBIDDEN',
    'nonfree components must be forbidden',
  );
  assert(profile.program_enablement.FFPROBE_PROGRAM === 'REQUIRED', 'ffprobe must be enabled');
  assert(
    profile.program_enablement.FFMPEG_PROGRAM === 'DISABLED',
    'ffmpeg executable must be disabled',
  );
  assert(
    profile.program_enablement.FFPLAY_PROGRAM === 'DISABLED',
    'ffplay executable must be disabled',
  );
  assert(
    profile.artifact_status.linux_exact_ffprobe_artifact === 'NOT_YET_PRODUCED',
    'profile must not claim a Linux artifact',
  );
  assert(
    profile.artifact_status.windows_exact_ffprobe_artifact === 'NOT_YET_PRODUCED',
    'profile must not claim a Windows artifact',
  );
  assert(
    profile.artifact_status.artifact_approval === 'NOT_PERFORMED',
    'profile must not approve an artifact',
  );
  assert(
    profile.artifact_status.license_artifact_review === 'NOT_PERFORMED',
    'profile must not approve artifact licensing',
  );
  const required = profile.required_product_capabilities;
  const provided = profile.provided_capabilities;
  assert(required.input_scope === provided.input_scope, 'profile input scope is not covered');
  assert(
    required.probe_operation === provided.probe_operation,
    'profile probe operation is not covered',
  );
  assertSubset(required.probe_fields, provided.probe_fields, 'probe fields');
  assertSubset(required.stream_semantics, provided.stream_semantics, 'stream semantics');
  for (const policy of [
    'container_capability_policy',
    'demuxer_capability_policy',
    'parser_capability_policy',
  ]) {
    assert(required[policy] === provided[policy], `${policy} is not covered`);
  }
}

function verifyPinRecord(pin, capability, security, profile) {
  assertSchema(validators.pin, pin, 'FFprobe source/build pin record');
  assertSha(pin.record_sha256, 'record_sha256');
  assert(
    hashCanonicalWithout(pin, 'record_sha256') === pin.record_sha256,
    'pin record self hash mismatch',
  );
  assert(
    pin.old_main_quality_baseline === 'fc6816214b7d4f56d691309ed6b2fd628ad25f79',
    'old main baseline mismatch',
  );
  assert(
    pin.qicr_binding.record_id === 'code-f-native-runtime-companion-qicr-7d8d254-v1',
    'QICR record ID mismatch',
  );
  assert(
    pin.qicr_binding.record_sha256 ===
      '1b8c08d3f3b6385ad158a17985087c7a57fc0c67dfaf03354386ac3587215d58',
    'QICR record SHA mismatch',
  );
  assert(
    pin.product_media_capability_binding.required_media_capability_set_id === capability.record_id,
    'pin capability set ID mismatch',
  );
  assert(
    pin.product_media_capability_binding.required_media_capability_set_sha256 ===
      capability.capability_set_sha256,
    'pin capability set SHA mismatch',
  );
  assert(
    pin.ffmpeg_upstream_release.upstream_project === 'FFmpeg/FFmpeg',
    'upstream project mismatch',
  );
  assert(
    pin.ffmpeg_upstream_release.release_version === '9.0.1',
    'pinned release version mismatch',
  );
  assert(pin.ffmpeg_upstream_release.release_tag === 'n9.0.1', 'pinned release tag mismatch');
  assert(
    pin.ffmpeg_upstream_release.release_commit === 'bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa',
    'pinned release commit mismatch',
  );
  assert(
    pin.release_security_intake_binding.snapshot_id === security.snapshot_id,
    'security snapshot ID mismatch',
  );
  assert(
    pin.release_security_intake_binding.snapshot_sha256 === security.snapshot_sha256,
    'security snapshot SHA mismatch',
  );
  assert(pin.source_archive.name === 'ffmpeg-9.0.1.tar.xz', 'source archive name mismatch');
  assert(
    pin.source_archive.locator === 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
    'source archive must use official upstream locator',
  );
  assert(
    pin.source_archive.sha256 ===
      'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
    'source archive SHA mismatch',
  );
  assert(
    pin.source_archive.release_binding === 'PASS',
    'source archive release binding is not PASS',
  );
  assert(pin.build_profile_binding.profile_id === profile.profile_id, 'build profile ID mismatch');
  assert(
    pin.build_profile_binding.profile_sha256 === profile.profile_sha256,
    'build profile SHA mismatch',
  );
  assert(
    pin.semantic_constraints.network_protocol_policy === 'DISABLED',
    'pin record enables network protocols',
  );
  assert(
    pin.semantic_constraints.build_autodetection_policy === 'FAIL_CLOSED',
    'pin record does not fail closed on autodetection',
  );
  assert(
    pin.semantic_constraints.declared_external_library_set_sha256 ===
      profile.external_library_policy.declared_external_library_set_sha256,
    'pin external library set hash mismatch',
  );
  assert(
    pin.capability_coverage.build_profile_capability_coverage === 'PASS',
    'pin capability coverage is not PASS',
  );
  assert(
    pin.downstream_status.linux_exact_ffprobe_artifact === 'NOT_YET_PRODUCED',
    'pin record claims a Linux artifact',
  );
  assert(
    pin.downstream_status.windows_exact_ffprobe_artifact === 'NOT_YET_PRODUCED',
    'pin record claims a Windows artifact',
  );
  assert(pin.downstream_status.worker_rebuild === 'NO', 'Worker rebuild must remain NO');
  assert(pin.next_owner === 'CODE_C_FFPROBE_EXACT_ARTIFACT_BUILD', 'next owner mismatch');
}

export function verifyFfprobePin({
  capability,
  security,
  profile,
  pin,
  verifySidecars = false,
} = {}) {
  assert(
    capability && security && profile && pin,
    'all four FFprobe authority records are required',
  );
  verifyCapabilitySet(capability);
  verifySecurity(security);
  verifyProfile(profile, capability);
  verifyPinRecord(pin, capability, security, profile);
  if (verifySidecars) {
    const paths = [
      'REQUIRED_MEDIA_CAPABILITY_SET_V1.json',
      'FFMPEG_RELEASE_SECURITY_INTAKE_V1.json',
      'FFPROBE_BUILD_PROFILE_V1.json',
      'FFPROBE_SOURCE_AND_BUILD_PROFILE_PIN_RECORD_V1.json',
    ];
    const hashes = [
      capability.capability_set_sha256,
      security.snapshot_sha256,
      profile.profile_sha256,
      pin.record_sha256,
    ];
    paths.forEach((name, index) => assertExactSidecar(resolve(evidenceRoot, name), hashes[index]));
  }
  return {
    status: 'PASS',
    release: pin.ffmpeg_upstream_release.release_version,
    profile: profile.profile_id,
    capabilitySet: capability.record_id,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const capability = readJson(resolve(evidenceRoot, 'REQUIRED_MEDIA_CAPABILITY_SET_V1.json'));
    const security = readJson(resolve(evidenceRoot, 'FFMPEG_RELEASE_SECURITY_INTAKE_V1.json'));
    const profile = readJson(resolve(evidenceRoot, 'FFPROBE_BUILD_PROFILE_V1.json'));
    const pin = readJson(
      resolve(evidenceRoot, 'FFPROBE_SOURCE_AND_BUILD_PROFILE_PIN_RECORD_V1.json'),
    );
    const result = verifyFfprobePin({ capability, security, profile, pin, verifySidecars: true });
    console.log(
      `ffprobe-source-profile: PASS (${result.release}; ${result.profile}; ${result.capabilitySet}; source/build intent only)`,
    );
  } catch (error) {
    console.error(`ffprobe-source-profile: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
