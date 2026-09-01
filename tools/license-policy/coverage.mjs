import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { licenseIdentityHash } from './evaluator.mjs';
import { parseSpdxExpression } from './spdx-parser.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const licenseCoverageSchemaVersion = '1';
export const upstreamReleaseBindingSchemaVersion = '1';
export const coverageSelectorSemanticsVersion = '1';
export const licenseCoverageSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/license-coverage/v1/coverage.schema.json',
);
export const upstreamReleaseBindingSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/upstream-release-binding/v1/binding.schema.json',
);

function makeValidator(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateCoverageSchema = makeValidator(licenseCoverageSchemaPath);
const validateBindingSchema = makeValidator(upstreamReleaseBindingSchemaPath);

function schemaErrors(validate) {
  return (validate.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function sameArtifact(left, right) {
  return (
    left.package === right.package &&
    left.version === right.version &&
    left.filename === right.filename &&
    left.sha256 === right.sha256 &&
    left.artifact_type === right.artifact_type
  );
}

function assertRelativePath(path, label) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error(`${label}: selector path is not a safe relative POSIX path`);
  }
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globRegex(pattern) {
  assertRelativePath(pattern, 'coverage selector');
  let result = '';
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '*' && pattern[index + 1] === '*') {
      result += '.*';
      index += 1;
    } else if (pattern[index] === '*') {
      result += '[^/]*';
    } else {
      result += escapeRegex(pattern[index]);
    }
  }
  return new RegExp(`^${result}$`, 'u');
}

function selectorMatches(selector, memberPaths) {
  const include = selector.include ?? [];
  const exclude = selector.exclude ?? [];
  const explicit = new Set(selector.explicit_member_paths ?? []);
  [...include, ...exclude, ...explicit].forEach((path) =>
    assertRelativePath(path, 'coverage selector'),
  );

  if (selector.selector_type === 'ENTIRE_ARTIFACT') {
    if (include.length !== 1 || include[0] !== '*') {
      throw new Error('ENTIRE_ARTIFACT selector must use include ["*"]');
    }
    return memberPaths.filter((path) => !exclude.includes(path));
  }
  if (selector.selector_type === 'EXACT_PATH') {
    if (include.length !== 1 || exclude.length > 0 || explicit.size > 0) {
      throw new Error('EXACT_PATH selector must contain one include and no excludes');
    }
    return memberPaths.filter((path) => path === include[0]);
  }
  if (selector.selector_type === 'PATH_PREFIX') {
    if (include.length !== 1 || (exclude.length === 0 && explicit.size > 0)) {
      throw new Error('PATH_PREFIX selector shape is invalid');
    }
    const prefix = include[0].replace(/\/$/u, '');
    return memberPaths.filter(
      (path) =>
        (path === prefix || path.startsWith(`${prefix}/`)) &&
        !exclude.some(
          (entry) => path === entry || path.startsWith(`${entry.replace(/\/$/u, '')}/`),
        ),
    );
  }
  if (selector.selector_type === 'EXPLICIT_MEMBER_LIST') {
    if (explicit.size === 0 || include.length !== 1 || include[0] !== 'EXPLICIT_MEMBER_LIST') {
      throw new Error('EXPLICIT_MEMBER_LIST selector shape is invalid');
    }
    return memberPaths.filter((path) => explicit.has(path) && !exclude.includes(path));
  }
  if (selector.selector_type === 'VERSIONED_GLOB') {
    if (include.length === 0 || explicit.size > 0)
      throw new Error('VERSIONED_GLOB selector shape is invalid');
    const patterns = include.map(globRegex);
    return memberPaths.filter(
      (path) =>
        patterns.some((pattern) => pattern.test(path)) &&
        !exclude.some((entry) => globRegex(entry).test(path)),
    );
  }
  throw new Error(`unsupported selector type: ${selector.selector_type}`);
}

export function licenseCoverageRecordHash(record) {
  return licenseIdentityHash(withoutKey(record, 'coverage_record_sha256'));
}

export function upstreamReleaseBindingRecordHash(binding) {
  return licenseIdentityHash(withoutKey(binding, 'binding_record_sha256'));
}

export function validateLicenseCoverageRecord(record) {
  if (!validateCoverageSchema(record)) {
    throw new Error(`License Coverage v1 schema invalid: ${schemaErrors(validateCoverageSchema)}`);
  }
  if (licenseCoverageRecordHash(record) !== record.coverage_record_sha256) {
    throw new Error(`${record.coverage_id}: coverage record hash mismatch`);
  }
  if (record.coverage_selector.semantics_version !== coverageSelectorSemanticsVersion) {
    throw new Error(`${record.coverage_id}: unsupported selector semantics version`);
  }
  parseSpdxExpression(record.license_assertion.spdx_expression);
  const whole = record.coverage_assertion.assertion_type === 'WHOLE_ARTIFACT_COVERAGE_ASSERTION';
  if (whole && record.coverage_decision !== 'COVERS_ENTIRE_ARTIFACT') {
    throw new Error(`${record.coverage_id}: whole-artifact assertion has incompatible decision`);
  }
  if (!whole && record.coverage_decision !== 'COVERS_COMPONENT_SET') {
    throw new Error(`${record.coverage_id}: component assertion has incompatible decision`);
  }
  if (
    record.coverage_decision === 'COVERS_ENTIRE_ARTIFACT' &&
    record.coverage_selector.selector_type !== 'ENTIRE_ARTIFACT'
  ) {
    throw new Error(
      `${record.coverage_id}: entire-artifact decision requires ENTIRE_ARTIFACT selector`,
    );
  }
  return record;
}

export function validateUpstreamReleaseBinding(binding, { expectedRelease = null } = {}) {
  if (!validateBindingSchema(binding)) {
    throw new Error(
      `Upstream Release Binding v1 schema invalid: ${schemaErrors(validateBindingSchema)}`,
    );
  }
  if (upstreamReleaseBindingRecordHash(binding) !== binding.binding_record_sha256) {
    throw new Error(`${binding.binding_id}: upstream binding record hash mismatch`);
  }
  const release = binding.upstream_release;
  const releaseIdentity = {
    repository: release.repository,
    release_tag: release.release_tag,
    release_commit: release.release_commit,
    release_asset_filename: release.release_asset_filename,
    release_asset_sha256: release.release_asset_sha256,
    release_membership: release.release_membership,
  };
  if (release.release_membership_evidence_sha256 !== licenseIdentityHash(releaseIdentity)) {
    throw new Error(`${binding.binding_id}: release membership evidence identity mismatch`);
  }
  if (expectedRelease) {
    for (const key of Object.keys(releaseIdentity)) {
      if (releaseIdentity[key] !== expectedRelease[key]) {
        throw new Error(
          `${binding.binding_id}: upstream release ${key} does not match approved identity`,
        );
      }
    }
  }
  if (release.release_membership !== 'PASS' || release.commit_signature !== 'VERIFIED') {
    throw new Error(`${binding.binding_id}: official release membership/signature is not verified`);
  }
  if (release.release_asset_sha256 !== binding.covered_subject.sha256) {
    throw new Error(
      `${binding.binding_id}: release asset bytes do not match exact artifact SHA-256`,
    );
  }
  if (binding.binding_method === 'BUILD_PROVENANCE_ATTESTATION') {
    if (
      binding.binding_assurance !== 'BUILD_PROVENANCE_VERIFIED' ||
      binding.attestation.integrity !== 'PASS' ||
      binding.attestation.subject_membership !== 'PRESENT' ||
      !binding.attestation.provenance_sha256
    ) {
      throw new Error(`${binding.binding_id}: build provenance attestation is not fully verified`);
    }
  } else if (binding.binding_method === 'OFFICIAL_RELEASE_ASSET_BYTE_IDENTITY') {
    if (binding.binding_assurance !== 'OFFICIAL_PUBLICATION_EXACT_BYTES') {
      throw new Error(
        `${binding.binding_id}: official publication binding has incorrect assurance`,
      );
    }
    if (
      binding.attestation.integrity === 'FAIL' &&
      binding.attestation.subject_membership === 'PRESENT'
    ) {
      throw new Error(`${binding.binding_id}: contradictory attestation evidence`);
    }
  }
  return binding;
}

function assertSourceBinding(record, binding, membersByPath) {
  const source = record.evidence_source;
  if (!binding) return;
  if (source.upstream_binding_id !== binding.binding_id) {
    throw new Error(
      `${record.coverage_id}: coverage is not bound to the supplied upstream release binding`,
    );
  }
  const release = binding.upstream_release;
  if (
    source.source_archive_sha256 !== release.source_archive_sha256 ||
    source.license_path !== release.license_path ||
    source.license_sha256 !== release.license_sha256
  ) {
    throw new Error(
      `${record.coverage_id}: source/license evidence does not match release evidence`,
    );
  }
  if (source.license_path && membersByPath.has(source.license_path)) {
    if (membersByPath.get(source.license_path).sha256 !== source.license_sha256) {
      throw new Error(`${record.coverage_id}: license file SHA-256 does not match member manifest`);
    }
  }
}

export function evaluateLicenseCoverage({
  artifact,
  members,
  records,
  upstreamBinding = null,
  expectedRelease = null,
}) {
  if (!artifact || !Array.isArray(members) || !Array.isArray(records)) {
    throw new Error('coverage evaluation requires an artifact, member manifest, and records');
  }
  if (upstreamBinding) {
    validateUpstreamReleaseBinding(upstreamBinding, { expectedRelease });
    if (!sameArtifact(artifact, upstreamBinding.covered_subject)) {
      throw new Error('upstream binding is bound to another exact artifact');
    }
  }
  const memberPaths = members.map((member) => {
    assertRelativePath(member.path, 'member manifest');
    if (!/^[a-f0-9]{64}$/u.test(member.sha256))
      throw new Error(`${member.path}: member SHA-256 is invalid`);
    if (
      !['USED', 'DISTRIBUTED', 'BUILD_ONLY_USE', 'LICENSE_EVIDENCE', 'UNUSED'].includes(
        member.usage,
      )
    ) {
      throw new Error(`${member.path}: unknown member usage`);
    }
    if (member.usage === 'DISTRIBUTED' && member.distribution_role === 'BUILD_ONLY_USE') {
      throw new Error(`${member.path}: distributed member cannot be classified BUILD_ONLY_USE`);
    }
    return member.path;
  });
  if (new Set(memberPaths).size !== memberPaths.length)
    throw new Error('member manifest contains duplicate paths');
  const membersByPath = new Map(members.map((member) => [member.path, member]));
  const manifestHash = licenseIdentityHash(members);
  const effective = new Map();
  const validated = records.map(validateLicenseCoverageRecord);
  for (const record of validated) {
    if (!sameArtifact(artifact, record.covered_subject)) {
      throw new Error(
        `${record.coverage_id}: coverage evidence is bound to another exact artifact`,
      );
    }
    if (record.coverage_assertion.member_manifest_sha256 !== manifestHash) {
      throw new Error(`${record.coverage_id}: member manifest identity mismatch`);
    }
    if (record.coverage_assertion.member_count !== members.length) {
      throw new Error(`${record.coverage_id}: member manifest count mismatch`);
    }
    assertSourceBinding(record, upstreamBinding, membersByPath);
    const matches = selectorMatches(record.coverage_selector, memberPaths);
    if (matches.length === 0)
      throw new Error(`${record.coverage_id}: selector matches no existing member`);
    for (const path of matches) {
      if (effective.has(path)) {
        const previous = effective.get(path);
        throw new Error(
          `${record.coverage_id}: conflicting/overlapping coverage for ${path} (${previous.coverage_id})`,
        );
      }
      effective.set(path, record);
    }
  }
  const relevant = members.filter((member) =>
    ['USED', 'DISTRIBUTED', 'BUILD_ONLY_USE'].includes(member.usage),
  );
  const uncovered = relevant.filter((member) => !effective.has(member.path));
  if (uncovered.length > 0)
    throw new Error(
      `uncovered license-relevant members: ${uncovered.map((entry) => entry.path).join(', ')}`,
    );
  for (const record of validated) {
    if (record.coverage_assertion.unaccounted_license_relevant_member_count !== 0) {
      throw new Error(`${record.coverage_id}: unaccounted license-relevant members are non-zero`);
    }
  }
  return {
    status: 'PASS',
    artifact,
    member_manifest_sha256: manifestHash,
    member_count: members.length,
    covered_member_count: effective.size,
    unaccounted_license_relevant_member_count: uncovered.length,
    records: validated,
  };
}

export function validateBuildOnlyUsageBinding(usageBinding) {
  if (
    !usageBinding ||
    usageBinding.artifact_role !== 'PYTHON_BUILD_DEPENDENCY' ||
    usageBinding.distribution_role !== 'BUILD_ONLY_USE' ||
    usageBinding.distributed_in_final_worker !== false
  ) {
    throw new Error('build-only usage binding is not fail-closed');
  }
  return usageBinding;
}

function fixtureFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function loadFixture(root, name) {
  return JSON.parse(readFileSync(resolve(root, name), 'utf8'));
}

export function verifyCoverageFixtures() {
  const root = resolve(repositoryRoot, 'tests/fixtures/license-coverage');
  const names = ['sentencepiece-linux', 'sentencepiece-windows', 'pyinstaller-hooks-contrib'];
  for (const name of names) {
    const fixtureRoot = resolve(root, name);
    const manifest = loadFixture(fixtureRoot, 'manifest.json');
    if (manifest.fixture_scope !== 'REGRESSION_ONLY_NOT_RELEASE_APPROVAL') {
      throw new Error(`${name}: fixture scope is not regression-only`);
    }
    if (fixtureFiles(fixtureRoot).some((path) => extname(path).toLowerCase() === '.whl')) {
      throw new Error(`${name}: wheel binaries must not be committed`);
    }
    const artifact = loadFixture(fixtureRoot, 'artifact.json');
    const members = loadFixture(fixtureRoot, 'members.json');
    const records = loadFixture(fixtureRoot, 'coverage.json');
    const binding = existsSync(resolve(fixtureRoot, 'upstream-binding.json'))
      ? loadFixture(fixtureRoot, 'upstream-binding.json')
      : null;
    evaluateLicenseCoverage({
      artifact,
      members,
      records,
      upstreamBinding: binding,
      expectedRelease: manifest.expected_upstream_release ?? null,
    });
    if (name === 'pyinstaller-hooks-contrib') {
      validateBuildOnlyUsageBinding(loadFixture(fixtureRoot, 'usage-binding.json'));
    }
  }
  console.log(
    `license-coverage: PASS (${names.length} generic exact-artifact fixtures; CI verify-only)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv[2] !== 'verify-fixtures') {
    console.error('usage: node tools/license-policy/coverage.mjs verify-fixtures');
    process.exitCode = 2;
  } else {
    try {
      verifyCoverageFixtures();
    } catch (error) {
      console.error(`license-coverage: FAIL\n${error.message}`);
      process.exitCode = 1;
    }
  }
}
