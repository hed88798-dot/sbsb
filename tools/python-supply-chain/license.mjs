import {
  compareLicenseDecisionReports,
  evaluateLicenseCollection,
} from '../license-policy/evaluator.mjs';
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

export function buildWheelLicenseEvidence(verifiedArtifacts) {
  return verifiedArtifacts.map(({ inventory, artifact, inspected }) => {
    const metadataExpression = inspected.license_expression?.trim() || null;
    const legacyLicense = inspected.legacy_license?.trim() || null;
    const { artifactRole, distributionRole } = wheelRoles(inventory.scope);
    let evidenceStatus = 'PASS';
    if (metadataExpression && metadataExpression !== artifact.license_expression) {
      evidenceStatus = 'CONFLICT';
    } else if (!metadataExpression) {
      evidenceStatus =
        legacyLicense && legacyLicense === artifact.license_expression ? 'PASS' : 'MANUAL_REVIEW';
    }
    if (artifact.license_files.length === 0 && evidenceStatus === 'PASS') {
      evidenceStatus = 'MANUAL_REVIEW';
    }
    return {
      artifact_sha256: artifact.sha256,
      package: normalizePythonName(artifact.package_name),
      version: artifact.version,
      artifact_type: 'PYTHON_WHEEL',
      artifact_role: artifactRole,
      distribution_role: distributionRole,
      detected_license_expression: artifact.license_expression,
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
          evidence_type: metadataExpression ? 'METADATA_LICENSE_EXPRESSION' : 'METADATA_LICENSE',
          value: metadataExpression ?? legacyLicense ?? 'MISSING',
        },
        ...artifact.license_files.map((entry) => ({
          evidence_type: 'LICENSE_FILE',
          relative_path: entry.relative_path,
          sha256: entry.sha256,
        })),
      ],
      exception_evidence: [],
    };
  });
}

export function auditPythonLicenses(
  verifiedArtifacts,
  { release = false, previousReport = null, usageEvaluations = [] } = {},
) {
  const evidence = buildWheelLicenseEvidence(verifiedArtifacts);
  const report = evaluateLicenseCollection(evidence);
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
