import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson } from '../python-supply-chain/inventory.mjs';

export const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const runtimeConsumerRequirementSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/runtime-consumer-requirement/v1/requirement.schema.json',
);
export const externalRuntimePrerequisiteSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/external-runtime-prerequisite/v1/prerequisite.schema.json',
);
export const windowsRuntimeProviderProbeSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/external-runtime-prerequisite/v1/windows-provider-probe.schema.json',
);

function validator(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateRequirementSchema = validator(runtimeConsumerRequirementSchemaPath);
const validatePrerequisiteSchema = validator(externalRuntimePrerequisiteSchemaPath);
const validateProbeSchema = validator(windowsRuntimeProviderProbeSchemaPath);

function errors(validate) {
  return (validate.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function identityHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function runtimeConsumerRequirementHash(requirement) {
  return identityHash(withoutKey(requirement, 'requirement_sha256'));
}

export function externalRuntimePrerequisiteHash(prerequisite) {
  return identityHash(withoutKey(prerequisite, 'manifest_sha256'));
}

export function externalRuntimeProviderIdentityHash(prerequisite) {
  const provider = structuredClone(prerequisite.provider);
  delete provider.installation_probe;
  delete provider.bootstrap_artifact.signature_status;
  return identityHash({
    schema_version: prerequisite.schema_version,
    prerequisite_id: prerequisite.prerequisite_id,
    consumer_requirement_id: prerequisite.consumer_requirement_id,
    target_disposition: prerequisite.target_disposition,
    provider,
    compatibility_policy: prerequisite.compatibility_policy,
  });
}

export function windowsRuntimeProviderProbeHash(probe) {
  return identityHash(withoutKey(probe, 'probe_sha256'));
}

function unique(values, label) {
  const normalized = values.map((value) => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
  return normalized;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function validateRuntimeConsumerRequirement(requirement) {
  if (!validateRequirementSchema(requirement)) {
    throw new Error(
      `runtime consumer requirement schema invalid: ${errors(validateRequirementSchema)}`,
    );
  }
  const expectedHash = runtimeConsumerRequirementHash(requirement);
  if (expectedHash !== requirement.requirement_sha256) {
    throw new Error(
      `${requirement.requirement_id}: requirement hash mismatch (${requirement.requirement_sha256} != ${expectedHash})`,
    );
  }
  const capabilities = unique(requirement.required_capabilities, 'required capability family');
  const observations = unique(
    requirement.raw_observations.map((entry) => entry.capability),
    'raw observation family',
  );
  if (!sameSet(capabilities, observations)) {
    throw new Error(`${requirement.requirement_id}: raw selection and requirement family differ`);
  }
  return requirement;
}

export function validateExternalRuntimePrerequisite(prerequisite) {
  if (!validatePrerequisiteSchema(prerequisite)) {
    throw new Error(
      `external runtime prerequisite schema invalid: ${errors(validatePrerequisiteSchema)}`,
    );
  }
  const expectedHash = externalRuntimePrerequisiteHash(prerequisite);
  if (expectedHash !== prerequisite.manifest_sha256) {
    throw new Error(
      `${prerequisite.prerequisite_id}: prerequisite manifest hash mismatch (${prerequisite.manifest_sha256} != ${expectedHash})`,
    );
  }
  const expectedProviderIdentityHash = externalRuntimeProviderIdentityHash(prerequisite);
  if (expectedProviderIdentityHash !== prerequisite.provider_identity_sha256) {
    throw new Error(
      `${prerequisite.prerequisite_id}: provider identity hash mismatch (${prerequisite.provider_identity_sha256} != ${expectedProviderIdentityHash})`,
    );
  }
  return prerequisite;
}

export function validateWindowsRuntimeProviderProbe(probe, prerequisiteValue) {
  const prerequisite = validateExternalRuntimePrerequisite(prerequisiteValue);
  if (!validateProbeSchema(probe)) {
    throw new Error(
      `Windows runtime provider probe schema invalid: ${errors(validateProbeSchema)}`,
    );
  }
  const expectedHash = windowsRuntimeProviderProbeHash(probe);
  if (expectedHash !== probe.probe_sha256) {
    throw new Error(
      `${probe.evidence_id}: provider probe hash mismatch (${probe.probe_sha256} != ${expectedHash})`,
    );
  }
  if (
    probe.prerequisite_id !== prerequisite.prerequisite_id ||
    probe.provider_identity_sha256 !== prerequisite.provider_identity_sha256
  ) {
    throw new Error(`${probe.evidence_id}: provider probe identity binding mismatch`);
  }
  const expected = prerequisite.provider.bootstrap_artifact;
  for (const key of ['filename', 'version', 'sha256', 'size']) {
    if (probe.bootstrap_artifact[key] !== expected[key]) {
      throw new Error(`${probe.evidence_id}: bootstrap ${key} does not match prerequisite`);
    }
  }
  if (
    probe.bootstrap_artifact.signer_subject !== expected.expected_signer_subject ||
    probe.bootstrap_artifact.signer_certificate_sha256 !==
      expected.expected_signer_certificate_sha256
  ) {
    throw new Error(`${probe.evidence_id}: bootstrap signer identity mismatch`);
  }
  if (
    compareVersions(
      probe.installed_runtime.version,
      prerequisite.compatibility_policy.minimum_accepted_version,
    ) < 0
  ) {
    throw new Error(`${probe.evidence_id}: installed runtime is older than compatibility policy`);
  }
  const required = unique(
    prerequisite.provider.provided_capabilities,
    'provider capability family',
  );
  const installed = unique(
    probe.provider_installed_required_capabilities.map((entry) => entry.capability),
    'installed capability family',
  );
  if (!sameSet(required, installed)) {
    throw new Error(`${probe.evidence_id}: installed provider capability closure is incomplete`);
  }
  return probe;
}

export function evaluateExternalRuntimePrerequisite(
  requirementValue,
  prerequisiteValue,
  {
    requireApproved = false,
    materializedCapabilities = [],
    finalCapabilities = [],
    now = new Date(),
  } = {},
) {
  const requirement = validateRuntimeConsumerRequirement(requirementValue);
  const prerequisite = validateExternalRuntimePrerequisite(prerequisiteValue);
  const failures = [];
  const blockers = [];
  const binding = prerequisite.provider_binding;
  if (prerequisite.consumer_requirement_id !== requirement.requirement_id) {
    failures.push('consumer requirement identity mismatch');
  }
  if (binding.consumer_requirement_sha256 !== requirement.requirement_sha256) {
    failures.push('consumer requirement hash binding mismatch');
  }
  for (const [label, actual, expected] of [
    [
      'build context ID',
      binding.build_context_id,
      requirement.application_closure.build_context_id,
    ],
    [
      'build context SHA-256',
      binding.build_context_sha256,
      requirement.application_closure.build_context_sha256,
    ],
    [
      'Analysis TOC SHA-256',
      binding.analysis_toc_sha256,
      requirement.application_closure.analysis_toc_sha256,
    ],
  ]) {
    if (actual !== expected) failures.push(`${label} binding mismatch`);
  }
  if (
    prerequisite.provider.architecture !== requirement.architecture ||
    prerequisite.compatibility_policy.architecture !== requirement.architecture ||
    prerequisite.compatibility_policy.runtime_family !== requirement.runtime_family
  ) {
    failures.push('provider family/architecture differs from consumer requirement');
  }

  const required = unique(requirement.required_capabilities, 'required capability family');
  const provided = unique(
    prerequisite.provider.provided_capabilities,
    'provider capability family',
  );
  for (const capability of required) {
    if (!provided.includes(capability)) failures.push(`provider does not cover ${capability}`);
  }

  const dispositions = prerequisite.provider_binding.capability_dispositions;
  unique(
    dispositions.map((entry) => entry.capability),
    'provider disposition family',
  );
  const dispositionCapabilities = dispositions.map((entry) => entry.capability.toLowerCase());
  if (!sameSet(required, dispositionCapabilities)) {
    failures.push('consumer requirement provider partition is incomplete or invented');
  }
  const internal = dispositions
    .filter((entry) => entry.disposition === 'INTERNAL_PROVIDER')
    .map((entry) => entry.capability.toLowerCase());
  const external = dispositions
    .filter((entry) => entry.disposition === 'EXTERNAL_PROVIDER')
    .map((entry) => entry.capability.toLowerCase());
  if (internal.some((entry) => external.includes(entry))) {
    failures.push('internal and external provider partitions overlap');
  }
  if (binding.internal_provider !== internal.length > 0) {
    failures.push('internal provider partition flag mismatch');
  }
  if (binding.external_provider !== external.length > 0) {
    failures.push('external provider partition flag mismatch');
  }
  for (const entry of dispositions) {
    if (
      entry.disposition === 'EXTERNAL_PROVIDER' &&
      entry.provider_id !== prerequisite.provider.provider_id
    ) {
      failures.push(`external capability has wrong provider binding: ${entry.capability}`);
    }
    if (entry.disposition === 'INTERNAL_PROVIDER' && entry.provider_id !== null) {
      failures.push(
        `internal capability must not reference the external provider: ${entry.capability}`,
      );
    }
  }

  const materialized = materializedCapabilities.map((entry) => entry.toLowerCase());
  const final = finalCapabilities.map((entry) => entry.toLowerCase());
  for (const capability of external) {
    if (materialized.includes(capability)) {
      failures.push(`external requirement was materialized internally: ${capability}`);
    }
    if (final.includes(capability)) {
      failures.push(`external requirement appears in final package: ${capability}`);
    }
  }
  for (const capability of internal) {
    if (!materialized.includes(capability)) {
      failures.push(`internal requirement is not materialized: ${capability}`);
    }
    if (!final.includes(capability)) {
      failures.push(`internal requirement is missing from final package: ${capability}`);
    }
  }

  const bootstrap = prerequisite.provider.bootstrap_artifact;
  const probe = prerequisite.provider.installation_probe;
  if (bootstrap.version !== prerequisite.provider.version) {
    failures.push('bootstrap artifact and provider versions differ');
  }
  if (
    compareVersions(
      prerequisite.provider.version,
      prerequisite.compatibility_policy.minimum_accepted_version,
    ) < 0
  ) {
    failures.push('approved bootstrap is older than minimum accepted installed runtime');
  }
  if (bootstrap.signature_status !== 'PASS') blockers.push('bootstrap Authenticode probe pending');
  if (probe.status !== 'PASS' || probe.artifact_bound !== true) {
    blockers.push('artifact-bound runtime provider installation probe pending');
  }
  if (prerequisite.license_evidence.status !== 'PASS') {
    blockers.push('redistribution license evidence incomplete');
  }
  if (prerequisite.approval.revoked) blockers.push('prerequisite approval revoked');
  if (new Date(prerequisite.approval.expires_at) <= now) {
    blockers.push('prerequisite approval expired');
  }
  if (prerequisite.approval.status !== 'PASS') blockers.push('prerequisite approval blocked');
  if (
    prerequisite.approval.status === 'PASS' &&
    prerequisite.approval.blocking_reasons.length > 0
  ) {
    failures.push('approved prerequisite retains blocking reasons');
  }
  if (
    prerequisite.approval.status === 'PASS' &&
    (bootstrap.signature_status !== 'PASS' ||
      probe.status !== 'PASS' ||
      !probe.artifact_bound ||
      prerequisite.license_evidence.status !== 'PASS' ||
      prerequisite.approval.revoked)
  ) {
    failures.push('approval claims PASS while provider evidence is incomplete or revoked');
  }

  if (failures.length > 0) throw new Error([...new Set(failures)].join('\n'));
  const uniqueBlockers = [...new Set(blockers)];
  if (requireApproved && uniqueBlockers.length > 0) {
    throw new Error(uniqueBlockers.join('\n'));
  }
  return {
    schema_version: '1',
    status: uniqueBlockers.length === 0 ? 'PASS' : 'BLOCKED',
    target_disposition: prerequisite.target_disposition,
    requirement_id: requirement.requirement_id,
    prerequisite_id: prerequisite.prerequisite_id,
    internal_capabilities: internal.sort(),
    external_capabilities: external.sort(),
    raw_selection_preserved: requirement.raw_selection_preserved,
    raw_source_approval_implied: false,
    provider_covers_required_dll_family: true,
    external_entries_not_materialized: true,
    external_entries_not_final: true,
    blockers: uniqueBlockers,
  };
}
