import {
  compareLicenseDecisionReports,
  evaluateLicenseCollection,
} from '../license-policy/evaluator.mjs';
import {
  createArtifactLicenseEvidenceV3,
  resolveArtifactLicenseReview,
} from '../license-policy/artifact-review.mjs';
import { normalizePythonName } from './inventory.mjs';

function assertApprovedBuildToolUsage(evaluation, evidence) {
  const packageDecision = evaluation.scope_decisions?.find(
    (entry) => entry.scope_id === 'package-default',
  );
  if (
    evaluation.schema_version !== '3' ||
    evaluation.policy_result !== 'PASS' ||
    evaluation.artifact_identity_reconciled !== true ||
    evaluation.exception_binding_valid !== true ||
    evaluation.dependency_role !== 'PYTHON_BUILD_DEPENDENCY' ||
    evaluation.functional_role !== 'PYINSTALLER_BUILD_TOOL' ||
    evaluation.distribution_role !== 'BUILD_ONLY' ||
    packageDecision?.detected_license_expression !== evidence.detected_license_expression
  ) {
    throw new Error(
      `${evaluation.artifact_sha256}: artifact usage evaluation is not an exact approved PyInstaller build-only binding`,
    );
  }
}

function wheelRoles(scope) {
  return scope === 'PRODUCTION_WORKER_RUNTIME'
    ? { artifactRole: 'RUNTIME_WHEEL', distributionRole: 'RUNTIME_DISTRIBUTION' }
    : { artifactRole: 'PYTHON_BUILD_DEPENDENCY', distributionRole: 'BUILD_ONLY_USE' };
}

export function buildWheelArtifactLicenseEvidenceV3(verifiedArtifacts) {
  return verifiedArtifacts.map(({ artifact, inspected }) => {
    const metadataExpression = inspected.license_expression?.trim() || null;
    let evidenceStatus = metadataExpression ? 'PASS' : 'MANUAL_REVIEW';
    if (metadataExpression && metadataExpression !== artifact.license_expression) {
      evidenceStatus = 'CONFLICT';
    }
    if (
      !metadataExpression &&
      !inspected.legacy_license?.trim() &&
      (inspected.license_classifiers ?? []).length === 0 &&
      inspected.license_files.length === 0
    ) {
      evidenceStatus = 'FAIL';
    }
    return createArtifactLicenseEvidenceV3({
      artifact: {
        package: normalizePythonName(artifact.package_name),
        version: artifact.version,
        filename: artifact.filename,
        sha256: artifact.sha256,
        purl: artifact.purl,
      },
      inspected,
      evidenceStatus,
    });
  });
}

export function buildWheelLicenseEvidence(verifiedArtifacts, { licenseReviews = [] } = {}) {
  const snapshots = buildWheelArtifactLicenseEvidenceV3(verifiedArtifacts);
  return verifiedArtifacts.map(({ inventory, artifact }, index) => {
    const snapshot = snapshots[index];
    const resolution = resolveArtifactLicenseReview(snapshot, licenseReviews);
    const activeReview =
      snapshot.evidence_status === 'MANUAL_REVIEW' ? resolution.active_review : null;
    const { artifactRole, distributionRole } = wheelRoles(inventory.scope);
    const rawExpression = snapshot.raw_license_evidence.reported_license_expression;
    const rawLegacy = snapshot.raw_license_evidence.legacy_license_value;
    const detectedExpression =
      activeReview?.reviewed_spdx_expression ?? rawExpression ?? artifact.license_expression;
    const reviewCanResolve =
      snapshot.evidence_status === 'MANUAL_REVIEW' && resolution.status === 'ACTIVE';
    const evidenceStatus =
      resolution.status === 'REVOKED'
        ? 'FAIL'
        : reviewCanResolve
          ? 'PASS'
          : snapshot.evidence_status;
    return {
      artifact_sha256: artifact.sha256,
      package: normalizePythonName(artifact.package_name),
      version: artifact.version,
      artifact_type: 'PYTHON_WHEEL',
      artifact_role: artifactRole,
      distribution_role: distributionRole,
      detected_license_expression: detectedExpression,
      evidence_status: evidenceStatus,
      source_provenance: {
        purl: artifact.purl,
        source: artifact.source,
        source_index: artifact.source_index,
        download_url: artifact.provenance.download_url,
        supplier: artifact.provenance.supplier,
        review_status: artifact.provenance.review_status,
      },
      evidence_sources: [
        {
          evidence_type: rawExpression ? 'METADATA_LICENSE_EXPRESSION' : 'METADATA_LICENSE',
          value: rawExpression ?? rawLegacy ?? 'MISSING',
          metadata_sha256: snapshot.raw_license_evidence.metadata_sha256,
        },
        ...snapshot.raw_license_evidence.license_files.map((entry) => ({
          evidence_type: entry.kind,
          relative_path: entry.relative_path,
          sha256: entry.sha256,
        })),
      ],
      exact_artifact_license_evidence: snapshot,
      reviewed_license_assertion: activeReview
        ? {
            review_id: activeReview.review_id,
            reviewed_spdx_expression: activeReview.reviewed_spdx_expression,
            evidence_snapshot_sha256: activeReview.evidence_snapshot_sha256,
            review_record_sha256: activeReview.review_record_sha256,
            reviewer_identity: activeReview.reviewer.identity,
            reviewer_authority_id: activeReview.reviewer.authority_id,
            approval_method: activeReview.reviewer.approval_method,
            approval_timestamp: activeReview.reviewer.approval_timestamp,
          }
        : null,
      review_resolution: {
        status: resolution.status,
        review_states: resolution.review_states,
        machine_suggestion_is_approval: false,
      },
      exception_evidence: [],
    };
  });
}

export function auditPythonLicenses(
  verifiedArtifacts,
  { release = false, previousReport = null, usageEvaluations = [], licenseReviews = [] } = {},
) {
  const evidence = buildWheelLicenseEvidence(verifiedArtifacts, { licenseReviews });
  const report = evaluateLicenseCollection(evidence);
  const evidenceByArtifact = new Map(evidence.map((entry) => [entry.artifact_sha256, entry]));
  if (licenseReviews.length > 0) {
    report.artifact_license_evidence_schema_version = '3';
    report.artifact_license_review_schema_version = '1';
  }
  report.decisions = report.decisions.map((decision) => {
    const source = evidenceByArtifact.get(decision.artifact_sha256);
    return {
      ...decision,
      exact_artifact_license_evidence: source.exact_artifact_license_evidence,
      reviewed_license_assertion: source.reviewed_license_assertion,
      review_resolution: source.review_resolution,
    };
  });
  const usageByHash = new Map();
  for (const evaluation of usageEvaluations) {
    if (usageByHash.has(evaluation.artifact_sha256)) {
      throw new Error(`duplicate artifact usage evaluation: ${evaluation.artifact_sha256}`);
    }
    usageByHash.set(evaluation.artifact_sha256, evaluation);
  }
  const evidenceByHash = new Map(evidence.map((entry) => [entry.artifact_sha256, entry]));
  for (const hash of usageByHash.keys()) {
    if (!evidenceByHash.has(hash)) {
      throw new Error(`artifact usage evaluation has no matching wheel evidence: ${hash}`);
    }
  }
  if (usageByHash.size > 0) {
    report.schema_version = '3';
    report.decisions = report.decisions.map((decision) => {
      const usage = usageByHash.get(decision.artifact_sha256);
      if (!usage) return decision;
      if (
        decision.artifact_role !== 'PYTHON_BUILD_DEPENDENCY' ||
        decision.distribution_role !== 'BUILD_ONLY_USE'
      ) {
        throw new Error(
          `${decision.artifact_sha256}: usage evaluation cannot replace a non-build-dependency decision`,
        );
      }
      assertApprovedBuildToolUsage(usage, evidenceByHash.get(decision.artifact_sha256));
      return {
        ...decision,
        policy_result: usage.policy_result,
        reason: usage.reason,
        license_policy_version: usage.license_policy_version,
        license_policy_sha256: usage.license_policy_sha256,
        manual_review_required: usage.policy_result === 'MANUAL_REVIEW',
        functional_role: usage.functional_role,
        usage_distribution_role: usage.distribution_role,
        usage_binding_id: usage.usage_binding_id,
        build_context_id: usage.build_context_id,
        context_bound_evaluation_schema_version: usage.schema_version,
        usage_binding_identity_sha256: usage.usage_binding_identity_sha256,
        context_free_policy_result: decision.policy_result,
      };
    });
    report.summary = {
      artifacts: report.decisions.length,
      passed: report.decisions.filter((entry) => entry.policy_result === 'PASS').length,
      manual_review: report.decisions.filter((entry) => entry.policy_result === 'MANUAL_REVIEW')
        .length,
      failed: report.decisions.filter((entry) => entry.policy_result === 'FAIL').length,
    };
    report.usage_binding_evaluations = usageEvaluations;
  }
  report.mode = release ? 'RELEASE' : 'PR_FIRST_PASS';
  report.evidence = evidence;
  report.policy_result_changes = previousReport
    ? compareLicenseDecisionReports(previousReport, report)
    : [];
  const failures = report.decisions.filter(
    (entry) =>
      entry.policy_result === 'FAIL' || (release && entry.policy_result === 'MANUAL_REVIEW'),
  );
  if (failures.length > 0) {
    throw new Error(
      failures
        .map(
          (entry) =>
            `${entry.package}@${entry.version} (${entry.artifact_sha256}): ${entry.policy_result}: ${entry.reason}`,
        )
        .join('\n'),
    );
  }
  return report;
}
