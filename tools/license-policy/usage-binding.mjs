import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { evaluateLicenseEvidence, licenseIdentityHash, loadLicensePolicy } from './evaluator.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const artifactEvidenceV2SchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/license-artifact-evidence/v2/evidence.schema.json',
);
export const artifactUsageBindingV1SchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-usage-binding/v1/binding.schema.json',
);
export const licensePolicyEvaluationV3SchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/license-policy-evaluation/v3/report.schema.json',
);

const distributionRoleAdapter = new Map([
  ['BUILD_ONLY', 'BUILD_ONLY_USE'],
  ['PRODUCT_RUNTIME', 'RUNTIME_DISTRIBUTION'],
  ['TOOLCHAIN_REDISTRIBUTION', 'TOOL_REDISTRIBUTION'],
  ['BOOTLOADER_INCLUSION', 'BOOTLOADER_INCLUSION'],
  ['FINAL_APPLICATION_DISTRIBUTION', 'GENERATED_APPLICATION_DISTRIBUTION'],
  ['SOURCE_REDISTRIBUTION', 'SOURCE_REDISTRIBUTION'],
  ['MODIFIED_TOOLCHAIN_DISTRIBUTION', 'MODIFIED_TOOLCHAIN_DISTRIBUTION'],
]);

function validatorFor(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateEvidenceSchema = validatorFor(artifactEvidenceV2SchemaPath);
const validateBindingSchema = validatorFor(artifactUsageBindingV1SchemaPath);
const validateEvaluationSchema = validatorFor(licensePolicyEvaluationV3SchemaPath);

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

export function buildProvenanceIdentity(buildProvenance) {
  return licenseIdentityHash(buildProvenance);
}

export function artifactEvidenceIdentity(evidence) {
  const identityInput = structuredClone(evidence);
  delete identityInput.scan.evidence_identity_sha256;
  return licenseIdentityHash(identityInput);
}

export function validateArtifactLicenseEvidenceV2(
  evidence,
  source = 'Artifact License Evidence v2',
) {
  if (!validateEvidenceSchema(evidence)) {
    throw new Error(`${source}: schema invalid: ${schemaErrors(validateEvidenceSchema)}`);
  }
  const failures = [];
  if (evidence.artifact.artifact_id !== `urn:sha256:${evidence.artifact.sha256}`) {
    failures.push('canonical artifact id does not match artifact SHA-256');
  }
  if (artifactEvidenceIdentity(evidence) !== evidence.scan.evidence_identity_sha256) {
    failures.push('artifact license evidence identity mismatch');
  }
  const sourceIds = new Set();
  for (const sourceEvidence of evidence.package_license.evidence_sources) {
    if (sourceIds.has(sourceEvidence.evidence_id)) {
      failures.push(`duplicate package evidence id: ${sourceEvidence.evidence_id}`);
    }
    sourceIds.add(sourceEvidence.evidence_id);
  }
  const filePaths = new Set();
  for (const scope of evidence.file_level_license_evidence) {
    for (const sourceEvidence of scope.evidence_sources) {
      const canonical = evidence.package_license.evidence_sources.find(
        (entry) => entry.evidence_id === sourceEvidence.evidence_id,
      );
      if (!canonical || licenseIdentityHash(canonical) !== licenseIdentityHash(sourceEvidence)) {
        failures.push(`${scope.scope_id}: file-level evidence source is not canonical`);
      }
    }
    for (const file of scope.files) {
      if (!scope.path_prefixes.some((prefix) => file.relative_path.startsWith(prefix))) {
        failures.push(`${scope.scope_id}: file is outside declared path prefixes`);
      }
      if (filePaths.has(file.relative_path)) {
        failures.push(`file appears in multiple file-level scopes: ${file.relative_path}`);
      }
      filePaths.add(file.relative_path);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return evidence;
}

export function validateArtifactUsageBindingV1(binding, source = 'Artifact Usage Binding v1') {
  if (!validateBindingSchema(binding)) {
    throw new Error(`${source}: schema invalid: ${schemaErrors(validateBindingSchema)}`);
  }
  return binding;
}

export function loadArtifactLicenseEvidenceV2(path) {
  const resolved = resolve(path);
  return {
    path: resolved,
    document: validateArtifactLicenseEvidenceV2(
      JSON.parse(readFileSync(resolved, 'utf8')),
      resolved,
    ),
  };
}

export function loadArtifactUsageBindingV1(path) {
  const resolved = resolve(path);
  return {
    path: resolved,
    document: validateArtifactUsageBindingV1(JSON.parse(readFileSync(resolved, 'utf8')), resolved),
  };
}

function baseReport(evidence, binding, buildProvenance, policy) {
  return {
    schema_version: '3',
    usage_binding_id: binding.usage_binding_id,
    artifact_sha256: binding.artifact_sha256,
    build_context_id: binding.build_context.build_context_id,
    dependency_role: binding.dependency_role,
    functional_role: binding.functional_role,
    distribution_role: binding.distribution_role,
    artifact_evidence_identity_sha256: evidence.scan.evidence_identity_sha256,
    usage_binding_identity_sha256: licenseIdentityHash(binding),
    build_provenance_identity_sha256: buildProvenanceIdentity(buildProvenance),
    license_policy_version: policy.document.license_policy_version,
    license_policy_sha256: policy.sha256,
    artifact_identity_reconciled: false,
    exception_binding_valid: false,
    reachability: binding.reachability,
    scope_decisions: [],
    policy_result: 'FAIL',
    reason: 'usage binding validation did not complete',
  };
}

function failed(report, failures) {
  const result = { ...report, reason: failures.join('; ') };
  if (!validateEvaluationSchema(result)) {
    throw new Error(
      `License Policy Evaluation v3 output invalid: ${schemaErrors(validateEvaluationSchema)}`,
    );
  }
  return result;
}

function withoutEvidenceId(entry) {
  const copy = { ...entry };
  delete copy.evidence_id;
  return copy;
}

function policyEvidence(evidence, binding, expression, evidenceSources) {
  return {
    artifact_sha256: evidence.artifact.sha256,
    package: evidence.artifact.package,
    version: evidence.artifact.version,
    artifact_type: evidence.artifact.artifact_type,
    artifact_role: binding.functional_role,
    distribution_role: distributionRoleAdapter.get(binding.distribution_role),
    detected_license_expression: expression,
    evidence_status: evidence.evidence_status,
    source_provenance: {
      artifact_id: evidence.artifact.artifact_id,
      download_url: evidence.artifact.download_url,
      supplier: evidence.artifact.supplier,
      review_status: evidence.artifact.review_status,
      usage_binding_id: binding.usage_binding_id,
      build_context_id: binding.build_context.build_context_id,
    },
    evidence_sources: evidenceSources.map(withoutEvidenceId),
    exception_evidence: evidenceSources
      .filter(
        (entry) =>
          entry.evidence_type === 'LICENSE_FILE' || entry.evidence_type === 'EXCEPTION_SOURCE',
      )
      .map(withoutEvidenceId),
  };
}

function expectedBuildOnlyReachability(binding) {
  if (
    binding.functional_role !== 'PYINSTALLER_BUILD_TOOL' ||
    binding.distribution_role !== 'BUILD_ONLY'
  ) {
    return [];
  }
  const expected = {
    build_sbom: 'INCLUDED',
    runtime_sbom: 'EXCLUDED_BUILD_ONLY',
    internal_compliance: 'RETAINED',
    customer_notice: 'EXCLUDED_BUILD_ONLY',
  };
  return Object.entries(expected)
    .filter(([key, value]) => binding.reachability[key] !== value)
    .map(([key, value]) => `build-only reachability ${key} must be ${value}`);
}

export function evaluateArtifactUsageBinding(
  artifactEvidence,
  usageBinding,
  { buildProvenance, toolchainInventory, policy: loadedPolicy = loadLicensePolicy() },
) {
  const policy = loadedPolicy.document
    ? loadedPolicy
    : {
        document: loadedPolicy,
        sha256: licenseIdentityHash(loadedPolicy),
      };
  validateArtifactLicenseEvidenceV2(artifactEvidence);
  validateArtifactUsageBindingV1(usageBinding);
  const report = baseReport(artifactEvidence, usageBinding, buildProvenance, policy);
  const failures = [];
  const artifactHash = artifactEvidence.artifact.sha256;
  const allArtifactReferences = [
    usageBinding.artifact_sha256,
    ...Object.values(usageBinding.artifact_references),
  ];
  if (allArtifactReferences.some((hash) => hash !== artifactHash)) {
    failures.push('canonical artifact identity reconciliation failed');
  }

  if (usageBinding.build_context.build_context_id !== buildProvenance.build_id) {
    failures.push('build context id does not match Build Artifact Provenance');
  }
  if (
    usageBinding.build_context.build_provenance_identity_sha256 !==
    buildProvenanceIdentity(buildProvenance)
  ) {
    failures.push('build context provenance identity mismatch');
  }
  const componentById = new Map(
    toolchainInventory.components.map((component) => [component.component_id, component]),
  );
  const pyinstaller = componentById.get(buildProvenance.inputs.pyinstaller_component_id);
  if (pyinstaller?.component_kind !== 'PYINSTALLER') {
    failures.push('build provenance does not reference a PyInstaller component');
  } else if (pyinstaller.artifact.sha256 !== artifactHash) {
    failures.push('toolchain PyInstaller artifact differs from canonical artifact identity');
  }
  if (
    toolchainInventory.target &&
    (toolchainInventory.target.os !== buildProvenance.target.os ||
      toolchainInventory.target.architecture !== buildProvenance.target.architecture ||
      toolchainInventory.target.python_version !== buildProvenance.target.python_version)
  ) {
    failures.push('toolchain target differs from build context target');
  }
  if (
    pyinstaller?.platform &&
    pyinstaller.platform !== 'any' &&
    (pyinstaller.platform !== buildProvenance.target.os ||
      (pyinstaller.architecture !== 'any' &&
        pyinstaller.architecture !== buildProvenance.target.architecture))
  ) {
    failures.push('PyInstaller artifact applicability differs from build context target');
  }
  if (usageBinding.dependency_role !== 'PYTHON_BUILD_DEPENDENCY') {
    failures.push('PyInstaller worker-build binding must retain PYTHON_BUILD_DEPENDENCY');
  }
  if (
    usageBinding.functional_role === 'PYINSTALLER_BUILD_TOOL' &&
    artifactEvidence.artifact.package.toLowerCase().replaceAll(/[-_.]+/gu, '-') !== 'pyinstaller'
  ) {
    failures.push('PYINSTALLER_BUILD_TOOL cannot be inherited by another package artifact');
  }
  if (
    usageBinding.policy_binding.license_policy_version !== policy.document.license_policy_version ||
    usageBinding.policy_binding.license_policy_sha256 !== policy.sha256
  ) {
    failures.push('usage binding policy identity mismatch');
  }

  const exception = usageBinding.exception_binding;
  for (const [actual, expected, label] of [
    [exception.artifact_sha256, artifactHash, 'artifact SHA-256'],
    [exception.build_context_id, usageBinding.build_context.build_context_id, 'build context'],
    [
      exception.detected_license_expression,
      artifactEvidence.package_license.expression,
      'license expression',
    ],
    [exception.functional_role, usageBinding.functional_role, 'functional role'],
    [exception.distribution_role, usageBinding.distribution_role, 'distribution role'],
    [exception.license_policy_version, policy.document.license_policy_version, 'policy version'],
    [exception.license_policy_sha256, policy.sha256, 'policy SHA-256'],
  ]) {
    if (actual !== expected) failures.push(`exception binding ${label} mismatch`);
  }
  const sourceById = new Map(
    artifactEvidence.package_license.evidence_sources.map((entry) => [entry.evidence_id, entry]),
  );
  const exceptionSources = exception.evidence_source_ids.map((id) => sourceById.get(id));
  if (exceptionSources.some((entry) => !entry)) {
    failures.push('exception binding references evidence from another artifact');
  }
  const evidenceTypes = new Set(
    exceptionSources.filter(Boolean).map((entry) => entry.evidence_type),
  );
  if (!evidenceTypes.has('LICENSE_FILE') || !evidenceTypes.has('EXCEPTION_SOURCE')) {
    failures.push('exception binding is missing exact license/exception evidence');
  }
  failures.push(...expectedBuildOnlyReachability(usageBinding));
  if (failures.length > 0) return failed(report, failures);

  report.artifact_identity_reconciled = true;
  report.exception_binding_valid = true;
  const packageDecision = evaluateLicenseEvidence(
    policyEvidence(
      artifactEvidence,
      usageBinding,
      artifactEvidence.package_license.expression,
      exceptionSources,
    ),
    { policy },
  );
  const fileDecisions = artifactEvidence.file_level_license_evidence.map((scope) => ({
    scope_id: scope.scope_id,
    relationship: scope.relationship,
    files: scope.files.map((entry) => entry.relative_path),
    ...evaluateLicenseEvidence(
      policyEvidence(artifactEvidence, usageBinding, scope.expression, scope.evidence_sources),
      { policy },
    ),
  }));
  report.scope_decisions = [{ scope_id: 'package-default', ...packageDecision }, ...fileDecisions];
  report.policy_result = report.scope_decisions.some((entry) => entry.policy_result === 'FAIL')
    ? 'FAIL'
    : report.scope_decisions.some((entry) => entry.policy_result === 'MANUAL_REVIEW')
      ? 'MANUAL_REVIEW'
      : 'PASS';
  report.reason =
    report.policy_result === 'PASS'
      ? 'artifact facts, build context, dependency/functional/distribution roles, exception evidence and scope reachability are exactly bound'
      : 'one or more package/file-level license scopes are not approved for this usage binding';
  if (!validateEvaluationSchema(report)) {
    throw new Error(
      `License Policy Evaluation v3 output invalid: ${schemaErrors(validateEvaluationSchema)}`,
    );
  }
  return report;
}

export function buildUsageReachabilityRecords(artifactEvidence, usageBinding, evaluation) {
  if (evaluation.policy_result !== 'PASS') {
    throw new Error('SBOM/notice reachability cannot be emitted for a non-PASS usage binding');
  }
  const component = {
    artifact_sha256: artifactEvidence.artifact.sha256,
    artifact_id: artifactEvidence.artifact.artifact_id,
    package: artifactEvidence.artifact.package,
    version: artifactEvidence.artifact.version,
    usage_binding_id: usageBinding.usage_binding_id,
    build_context_id: usageBinding.build_context.build_context_id,
    dependency_role: usageBinding.dependency_role,
    functional_role: usageBinding.functional_role,
    distribution_role: usageBinding.distribution_role,
    license_expression: artifactEvidence.package_license.expression,
  };
  return {
    schema_version: '1',
    build_sbom_components: usageBinding.reachability.build_sbom === 'INCLUDED' ? [component] : [],
    runtime_sbom_components:
      usageBinding.reachability.runtime_sbom === 'INCLUDED' ? [component] : [],
    internal_compliance_evidence:
      usageBinding.reachability.internal_compliance === 'RETAINED'
        ? [
            {
              ...component,
              artifact_evidence_identity_sha256: evaluation.artifact_evidence_identity_sha256,
              usage_binding_identity_sha256: evaluation.usage_binding_identity_sha256,
              license_policy_sha256: evaluation.license_policy_sha256,
            },
          ]
        : [],
    customer_notice_components:
      usageBinding.reachability.customer_notice === 'INCLUDED' ? [component] : [],
    decision_reason:
      usageBinding.distribution_role === 'BUILD_ONLY'
        ? 'build-only tool is retained in build/internal evidence and excluded from runtime/customer artifacts'
        : 'distribution reachability follows the explicitly reviewed usage binding',
  };
}
