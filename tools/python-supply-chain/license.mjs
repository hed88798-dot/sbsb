import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePythonName, repositoryRoot } from './inventory.mjs';

const policy = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'config/dependency-license-policy.json'), 'utf8'),
);

function matchesPattern(value, patterns) {
  return patterns.some((pattern) => new RegExp(pattern, 'iu').test(value));
}

function classify(expression) {
  const normalized = /^\([^()]+\)$/u.test(expression) ? expression.slice(1, -1).trim() : expression;
  if (!normalized || normalized.toUpperCase() === 'UNKNOWN') return 'REJECT';
  if (matchesPattern(normalized, policy.blocked_patterns)) return 'REJECT';
  if (policy.allowed.includes(normalized)) return 'ALLOW';
  if (policy.manual_review.includes(normalized)) return 'REVIEW';
  return 'REJECT';
}

export function auditPythonLicenses(verifiedArtifacts, { release = false } = {}) {
  const packages = [];
  const failures = [];
  for (const { inventory, artifact, inspected } of verifiedArtifacts) {
    const metadataExpression = inspected.license_expression?.trim() || null;
    const legacyLicense = inspected.legacy_license?.trim() || null;
    let metadataSource = 'License-Expression';
    let metadataDecision = 'MATCH';
    if (metadataExpression && metadataExpression !== artifact.license_expression) {
      metadataDecision = 'CONFLICT';
      failures.push(
        `${artifact.purl}: wheel License-Expression ${metadataExpression} conflicts with inventory ${artifact.license_expression}`,
      );
    } else if (!metadataExpression) {
      metadataSource = 'License';
      if (!legacyLicense || legacyLicense !== artifact.license_expression) {
        metadataDecision = 'MANUAL_REVIEW';
      }
    }
    const decision = classify(artifact.license_expression);
    if (decision === 'REJECT') failures.push(`${artifact.purl}: rejected/unknown license`);
    if (artifact.license_files.length === 0) {
      metadataDecision = 'MANUAL_REVIEW';
    }
    if (release && (decision === 'REVIEW' || metadataDecision === 'MANUAL_REVIEW')) {
      failures.push(`${artifact.purl}: license manual review is unresolved for release`);
    }
    packages.push({
      package_name: normalizePythonName(artifact.package_name),
      version: artifact.version,
      purl: artifact.purl,
      scope: inventory.scope,
      artifact_sha256: artifact.sha256,
      license_expression: artifact.license_expression,
      metadata_license_source: metadataSource,
      metadata_license_value: metadataExpression ?? legacyLicense ?? 'UNKNOWN',
      metadata_decision: metadataDecision,
      policy_decision: decision,
      license_files: artifact.license_files,
    });
  }
  const report = {
    schema_version: '1',
    mode: release ? 'RELEASE' : 'PR_FIRST_PASS',
    summary: {
      packages: packages.length,
      allowed: packages.filter((entry) => entry.policy_decision === 'ALLOW').length,
      manual_review: packages.filter(
        (entry) =>
          entry.policy_decision === 'REVIEW' || entry.metadata_decision === 'MANUAL_REVIEW',
      ).length,
      rejected: packages.filter(
        (entry) => entry.policy_decision === 'REJECT' || entry.metadata_decision === 'CONFLICT',
      ).length,
    },
    packages,
  };
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return report;
}
