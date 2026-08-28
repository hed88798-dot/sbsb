import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { licenseIdentityHash, loadLicensePolicy } from './evaluator.mjs';

function componentIdentity(component) {
  return {
    component_id: component.component_id,
    name: component.name,
    version: component.version,
    detected_license_expression: component.license_expression,
  };
}

export function loadBundledLicenseEvidence(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  const identityInput = structuredClone(document);
  delete identityInput.evidence_identity_sha256;
  const computedIdentity = licenseIdentityHash(identityInput);
  if (document.evidence_identity_sha256 !== computedIdentity) {
    throw new Error(`${path}: bundled-license evidence identity mismatch`);
  }
  return { path, document, sha256: computedIdentity };
}

export function evaluateBundledLicenseEvidence(
  scan,
  { policy: loadedPolicy = loadLicensePolicy() } = {},
) {
  const evidence = scan.document ?? scan;
  const policy = loadedPolicy.document ?? loadedPolicy;
  const policyHash = loadedPolicy.sha256 ?? licenseIdentityHash(policy);
  const review = (policy.artifact_bundled_license_reviews ?? []).find(
    (candidate) => candidate.artifact_sha256 === evidence.artifact.sha256,
  );
  const failures = [];
  if (!review) {
    failures.push('exact artifact has no approved bundled-license review');
  } else {
    const licenseEvidence = evidence.license_evidence_files.find(
      (entry) => entry.relative_path === review.license_evidence_relative_path,
    );
    if (
      review.package !== evidence.artifact.package ||
      review.version !== evidence.artifact.version
    ) {
      failures.push('artifact package/version differs from bundled-license review');
    }
    if (review.evidence_identity_sha256 !== evidence.evidence_identity_sha256) {
      failures.push('scan evidence identity differs from bundled-license review');
    }
    if (
      !licenseEvidence ||
      licenseEvidence.sha256 !== review.license_evidence_sha256 ||
      licenseEvidence.normalized_lf_sha256 !== review.license_evidence_normalized_lf_sha256 ||
      licenseEvidence.materialized_text_sha256 !== review.license_evidence_materialized_text_sha256
    ) {
      failures.push('license evidence bytes differ from bundled-license review');
    }
    const reviewedById = new Map(
      review.components.map((component) => [component.component_id, component]),
    );
    if (reviewedById.size !== review.components.length) {
      failures.push('bundled-license review contains duplicate component identifiers');
    }
    if (reviewedById.size !== evidence.bundled_components.length) {
      failures.push('bundled-license component set differs from approved review');
    }
    for (const component of evidence.bundled_components) {
      const approved = reviewedById.get(component.component_id);
      if (!approved) {
        failures.push(`${component.component_id}: no approved bundled-license decision`);
        continue;
      }
      const observed = componentIdentity(component);
      const expected = {
        component_id: approved.component_id,
        name: approved.name,
        version: approved.version,
        detected_license_expression: approved.detected_license_expression,
      };
      if (licenseIdentityHash(observed) !== licenseIdentityHash(expected)) {
        failures.push(`${component.component_id}: license fact differs from approved review`);
      }
      if (approved.policy_result !== 'PASS') {
        failures.push(`${component.component_id}: bundled-license policy is not approved`);
      }
    }
  }
  const status = failures.length === 0 && review?.policy_result === 'PASS' ? 'PASS' : 'FAIL';
  const decisions = (review?.components ?? []).map((component) => ({
    artifact_sha256: evidence.artifact.sha256,
    evidence_identity_sha256: evidence.evidence_identity_sha256,
    review_id: review.review_id,
    component_id: component.component_id,
    package: component.name,
    version: component.version,
    detected_license_expression: component.detected_license_expression,
    selected_policy_branch: component.selected_policy_branch ?? null,
    policy_result: failures.some((failure) => failure.startsWith(`${component.component_id}:`))
      ? 'FAIL'
      : component.policy_result,
    obligations: component.obligations,
    license_policy_version: policy.license_policy_version,
    license_policy_sha256: policyHash,
  }));
  const result = {
    schema_version: '1',
    status,
    artifact_sha256: evidence.artifact.sha256,
    evidence_identity_sha256: evidence.evidence_identity_sha256,
    review_id: review?.review_id ?? null,
    license_policy_version: policy.license_policy_version,
    license_policy_sha256: policyHash,
    policy_input_hash: licenseIdentityHash({ evidence, review, policyHash }),
    notice_materialization_required: review?.notice_materialization_required ?? false,
    failures,
    decisions,
  };
  if (status !== 'PASS') throw new Error(failures.join('\n'));
  return result;
}

export function loadAndEvaluateBundledLicenseEvidence(path, options = {}) {
  return evaluateBundledLicenseEvidence(loadBundledLicenseEvidence(resolve(path)), options);
}
