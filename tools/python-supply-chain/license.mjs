import {
  compareLicenseDecisionReports,
  evaluateLicenseCollection,
} from '../license-policy/evaluator.mjs';
import { normalizePythonName } from './inventory.mjs';

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
  { release = false, previousReport = null } = {},
) {
  const evidence = buildWheelLicenseEvidence(verifiedArtifacts);
  const report = evaluateLicenseCollection(evidence);
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
