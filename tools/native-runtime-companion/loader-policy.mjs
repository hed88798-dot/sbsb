import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson } from './companion.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');
export const policyPath = resolve(
  repositoryRoot,
  'compliance/runtime-dependency-intake/native-runtime-companion-v1/RUNTIME_LOADER_POLICY_RECORD_V1.json',
);
const policyRoot = resolve(
  repositoryRoot,
  'compliance/runtime-dependency-intake/native-runtime-companion-v1',
);
const schemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/native-runtime-companion/v1/loader-policy.schema.json',
);
const qicrPath = resolve(policyRoot, 'QICR_RECORD_V1.json');
const profilePath = resolve(
  repositoryRoot,
  'compliance/runtime-dependency-intake/ffprobe-v2/FFPROBE_BUILD_PROFILE_V1.json',
);
const SHA256 = /^[0-9a-f]{64}$/u;

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashCanonical(value) {
  return sha256Bytes(JSON.stringify(canonicalJson(value)));
}

function hashCanonicalWithout(value, field) {
  const copy = structuredClone(value);
  delete copy[field];
  return hashCanonical(copy);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSha(value, label) {
  assert(typeof value === 'string' && SHA256.test(value), `${label} must be a lowercase SHA-256`);
}

function assertSchema(value) {
  assert(
    validateSchema(value),
    `runtime loader policy schema invalid: ${(validateSchema.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
      .join('; ')}`,
  );
}

function assertExactSidecar(jsonPath) {
  const sidecarPath = `${jsonPath.slice(0, -'.json'.length)}.sha256`;
  const sidecarText = readFileSync(sidecarPath, 'utf8').trim();
  const [sidecarHash, ...sidecarFile] = sidecarText.split(/\s+/u);
  assertSha(sidecarHash, `${sidecarPath} hash`);
  assert(
    sidecarFile.join(' ') === relative(repositoryRoot, jsonPath).replaceAll('\\', '/'),
    `${sidecarPath} does not bind the expected JSON path`,
  );
  assert(
    sha256Bytes(readFileSync(jsonPath)) === sidecarHash,
    `${jsonPath} exact-byte sidecar mismatch`,
  );
}

function assertBinding(binding, expectedId, expectedSha, label) {
  assert(binding.record_id === expectedId, `${label} record ID mismatch`);
  assert(binding.record_sha256 === expectedSha, `${label} record SHA mismatch`);
}

function assertListContainsAll(actual, expected, label) {
  for (const value of expected) assert(actual.includes(value), `${label} missing: ${value}`);
}

export function verifyLoaderPolicy(record = readJson(policyPath), options = {}) {
  assertSchema(record);
  assertSha(record.record_sha256, 'record_sha256');
  assert(
    hashCanonicalWithout(record, 'record_sha256') === record.record_sha256,
    'runtime loader policy semantic self hash mismatch',
  );
  assert(
    record.old_main_quality_baseline === '99e9d73f8b6d23f9415c87778f6fe66cbcc5aea2',
    'old main quality baseline mismatch',
  );
  assertBinding(
    record.qicr_binding,
    'code-f-native-runtime-companion-qicr-7d8d254-v1',
    '1b8c08d3f3b6385ad158a17985087c7a57fc0c67dfaf03354386ac3587215d58',
    'QICR',
  );
  const qicr = options.qicr ?? readJson(qicrPath);
  assert(qicr.record_id === record.qicr_binding.record_id, 'published QICR ID mismatch');
  assert(qicr.decision_status === 'PASS', 'published QICR is not PASS');
  assert(
    qicr.capabilities?.runtime_loader_policy_supported === true,
    'published QICR does not support loader policy',
  );
  assertBinding(
    record.ffprobe_build_profile_binding,
    'code-f-ffprobe-semantic-build-profile-v1',
    'd837b4e75e6feb616f42bec15054ce018313a94ef1df39a8ba8ce4eae4886004',
    'FFprobe Build Profile',
  );
  const profile = options.profile ?? readJson(profilePath);
  assert(
    profile.profile_id === record.ffprobe_build_profile_binding.record_id,
    'published FFprobe Build Profile ID mismatch',
  );
  assert(
    profile.profile_sha256 === record.ffprobe_build_profile_binding.record_sha256,
    'published FFprobe Build Profile SHA mismatch',
  );
  assert(
    hashCanonicalWithout(profile, 'profile_sha256') === profile.profile_sha256,
    'published FFprobe Build Profile semantic self hash mismatch',
  );

  const layout = record.runtime_companion_layout;
  assert(layout.layout_id === 'FLAT_APP_LOCAL_BUNDLE_V1', 'runtime companion layout mismatch');
  assert(layout.bundle_members_only === true, 'runtime companion contains non-bundle members');

  const linux = record.linux_policy;
  assert(linux.strategy === 'ELF_RUNPATH_ORIGIN_V1', 'Linux loader strategy mismatch');
  assert(linux.entrypoint_dt_runpath === '$ORIGIN', 'Linux entrypoint must use DT_RUNPATH=$ORIGIN');
  assert(
    linux.bundled_library_dt_runpath === '$ORIGIN',
    'Linux bundled libraries must use $ORIGIN',
  );
  assert(
    linux.transitive_runpath_closure_required === true &&
      linux.every_elf_member_with_bundled_dt_needed_requires_origin_runpath === true,
    'Linux transitive RUNPATH closure is not required',
  );
  assert(
    linux.dt_rpath_allowed === false &&
      linux.absolute_rpath_allowed === false &&
      linux.absolute_runpath_allowed === false,
    'Linux absolute or DT_RPATH search paths are allowed',
  );
  assert(linux.ld_library_path_authority === false, 'LD_LIBRARY_PATH is an authority');
  assert(
    linux.runtime_import_name_binding_supported === true &&
      linux.declared_import_name_to_bundle_member_binding === 'REQUIRED',
    'Linux import-name/member binding is not required',
  );
  assert(linux.undeclared_alias_or_symlink === 'FAIL_CLOSED', 'Linux aliases are not fail-closed');

  const windows = record.windows_policy;
  assert(windows.strategy === 'APP_LOCAL_SAME_DIRECTORY_V1', 'Windows loader strategy mismatch');
  assert(
    windows.entrypoint_locator === 'EXPLICIT_ABSOLUTE_BUNDLE_PATH' &&
      windows.bundled_dll_location === 'SAME_DIRECTORY_AS_ENTRYPOINT',
    'Windows app-local bundle semantics mismatch',
  );
  assert(
    windows.path_authority === false && windows.cwd_authority === false,
    'Windows PATH/CWD authority enabled',
  );
  assert(
    windows.runtime_resolution_authority ===
      'APP_LOCAL_BUNDLE_PLUS_APPROVED_OS_PREREQUISITE_ALLOWLIST',
    'Windows runtime resolution authority mismatch',
  );
  assert(
    windows.import_name_to_bundle_member_binding === 'REQUIRED' &&
      windows.undeclared_dll_alias === 'FAIL_CLOSED',
    'Windows import-name/member binding is not fail-closed',
  );
  assert(
    windows.decoy_dll_in_cwd_test_required === true &&
      windows.decoy_dll_in_path_test_required === true,
    'Windows decoy DLL tests are not required',
  );

  assert(
    record.external_os_prerequisite_policy.allowlist_enforced === true &&
      record.external_os_prerequisite_policy.undeclared_external_os_prerequisite === 'FAIL_CLOSED',
    'external OS prerequisite allowlist is not fail-closed',
  );
  const evidence = record.runtime_loader_evidence_requirements;
  for (const field of [
    'runtime_loader_trace_required',
    'bundled_member_load_location_enforced',
    'runtime_import_name_binding_supported',
    'requested_name_required',
    'resolved_absolute_location_required',
    'member_classification_required',
    'manifest_member_identity_required_for_bundled',
    'exact_resolved_file_sha256_required_where_applicable',
    'static_and_runtime_evidence_both_required',
  ]) {
    assert(evidence[field] === true, `runtime loader evidence requirement missing: ${field}`);
  }

  const negative = record.negative_resolution_tests;
  for (const field of [
    'linux_ld_library_path_unset',
    'linux_path_does_not_contain_companion',
    'linux_cwd_outside_companion_bundle',
    'linux_explicit_absolute_entrypoint_launch',
    'windows_path_does_not_contain_companion',
    'windows_cwd_outside_companion_bundle',
    'windows_explicit_absolute_entrypoint_launch',
    'minimal_version_probe_required',
    'minimal_benign_media_probe_required',
  ]) {
    assert(negative[field] === true, `negative loader test missing: ${field}`);
  }
  assert(
    negative.windows_decoy_cwd_library_consumed === false &&
      negative.windows_decoy_path_library_consumed === false,
    'Windows decoy DLL is allowed to be consumed',
  );
  assert(
    negative.system_library_shadowing_detected === 'FAIL_CLOSED' &&
      record.system_library_shadowing_policy === 'FAIL_CLOSED',
    'system-library shadowing is not fail-closed',
  );

  const requiredTriggers = [
    'Runtime Companion layout changes',
    'linkage policy changes',
    'Linux RUNPATH strategy changes',
    'Windows DLL loading strategy changes',
    'bundle member layout changes',
    'runtime import-name semantics change',
    'external OS prerequisite allowlist changes',
    'system PATH authority changes',
    'Worker runtime companion resolver semantics change',
    'Build Profile linkage semantics change',
  ];
  assertListContainsAll(record.recheck_triggers, requiredTriggers, 'recheck trigger list');

  const downstream = record.downstream_status;
  assert(downstream.ffprobe_build === 'NOT_RUN', 'ffprobe build must remain NOT_RUN');
  assert(
    downstream.linux_exact_artifact === 'NOT_YET_PRODUCED' &&
      downstream.windows_exact_artifact === 'NOT_YET_PRODUCED',
    'loader policy must not claim exact ffprobe artifacts',
  );
  assert(
    downstream.artifact_approval === 'NOT_PERFORMED' &&
      downstream.license_artifact_review === 'NOT_PERFORMED',
    'loader policy must not approve artifacts or licensing',
  );
  assert(
    downstream.worker_rebuild_required === 'NO' && downstream.worker_rebuild === 'NO',
    'loader policy must not require a Worker rebuild',
  );
  for (const field of [
    'native_rebind',
    'license_distribution_rebind',
    'sbom_notice_regeneration',
    'final_distribution_rebind',
    'vulnerability_rebind',
    'siglip_index',
    'real_index_acceptance',
    'code_c_version_acceptance',
  ]) {
    assert(downstream[field] === 'NOT_RUN', `forbidden downstream work was marked run: ${field}`);
  }
  assert(downstream.code_d === 'NOT_STARTED', 'Code D work must remain not started');
  assert(downstream.pr_8_updated === 'NO', 'PR #8 must remain unchanged');
  assert(
    downstream.next_owner === 'CODE_C_FFPROBE_EXACT_ARTIFACT_BUILD',
    'next owner must be Code C exact ffprobe artifact build',
  );

  if (options.verifySidecar !== false) {
    assertExactSidecar(policyPath);
    if (options.verifyAuthoritySidecars) {
      assertExactSidecar(qicrPath);
      assertExactSidecar(profilePath);
    }
  }
  return {
    status: 'PASS',
    policy_id: record.record_id,
    policy_sha256: record.record_sha256,
    layout: layout.layout_id,
    linux_strategy: linux.strategy,
    windows_strategy: windows.strategy,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = verifyLoaderPolicy(undefined, { verifyAuthoritySidecars: true });
    console.log(
      `runtime-loader-policy: PASS (${result.policy_id}; ${result.layout}; ${result.linux_strategy}; ${result.windows_strategy}; decision only)`,
    );
  } catch (error) {
    console.error(`runtime-loader-policy: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
