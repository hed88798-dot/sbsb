import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBundledLicenseEvidence, loadBundledLicenseEvidence } from './bundled-license.mjs';
import { evaluateLicenseEvidence, licenseIdentityHash } from './evaluator.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function topLevelEvidenceFromScan(scan) {
  const licenseFiles = scan.license_evidence_files.map((entry) => ({
    evidence_type: 'LICENSE_FILE',
    relative_path: entry.relative_path,
    sha256: entry.sha256,
  }));
  return {
    artifact_sha256: scan.artifact.sha256,
    package: scan.artifact.package,
    version: scan.artifact.version,
    artifact_type: 'PYTHON_WHEEL',
    artifact_role: 'RUNTIME_WHEEL',
    distribution_role: 'RUNTIME_DISTRIBUTION',
    detected_license_expression: scan.metadata.license_expression,
    evidence_status: 'PASS',
    source_provenance: {
      source: scan.artifact.source,
      source_index: scan.artifact.source_index,
      download_url: scan.artifact.download_url,
      supplier: scan.artifact.supplier,
      review_status: scan.artifact.review_status,
    },
    evidence_sources: [
      { evidence_type: 'METADATA_LICENSE_EXPRESSION', value: scan.metadata.license_expression },
      ...licenseFiles,
    ],
    exception_evidence: [],
  };
}

export function buildThirdPartyNoticeBundle(
  scan,
  topLevelDecision,
  bundledEvaluation,
  licenseText,
) {
  const licenseFile = scan.license_evidence_files[0];
  const normalizedText = licenseText.replaceAll('\r\n', '\n');
  const materializedLicenseHash = sha256(normalizedText);
  const failures = [];
  if (materializedLicenseHash !== licenseFile.materialized_text_sha256) {
    failures.push('materialized license text differs from exact wheel evidence');
  }
  if (
    topLevelDecision.artifact_sha256 !== scan.artifact.sha256 ||
    topLevelDecision.detected_license_expression !== 'MIT-CMU' ||
    topLevelDecision.normalized_expression !== 'MIT-CMU' ||
    topLevelDecision.policy_result !== 'PASS' ||
    !topLevelDecision.notice_required ||
    !topLevelDecision.no_endorsement_required ||
    !topLevelDecision.no_publicity_name_use_without_permission
  ) {
    failures.push('top-level MIT-CMU decision lacks required approval/notice obligations');
  }
  if (
    bundledEvaluation.status !== 'PASS' ||
    bundledEvaluation.artifact_sha256 !== scan.artifact.sha256 ||
    !bundledEvaluation.notice_materialization_required
  ) {
    failures.push('bundled-license review is not approved for notice materialization');
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));

  const common = {
    parent_artifact_sha256: scan.artifact.sha256,
    parent_artifact_filename: scan.artifact.filename,
    source: scan.artifact.download_url,
    license_evidence_relative_path: licenseFile.relative_path,
    license_evidence_sha256: licenseFile.sha256,
    materialized_license_text_sha256: materializedLicenseHash,
  };
  const entries = [
    {
      ...common,
      entry_id: `${scan.artifact.sha256}:pillow`,
      package: scan.artifact.package,
      version: scan.artifact.version,
      component_id: null,
      license_expression: topLevelDecision.detected_license_expression,
      policy_rule_id: topLevelDecision.policy_rule_id,
      copyright_holders: topLevelDecision.copyright_holders,
      obligations: topLevelDecision.obligations,
    },
    ...bundledEvaluation.decisions.map((decision) => ({
      ...common,
      entry_id: `${scan.artifact.sha256}:${decision.component_id}`,
      package: decision.package,
      version: decision.version,
      component_id: decision.component_id,
      license_expression: decision.detected_license_expression,
      policy_rule_id: decision.review_id,
      obligations: decision.obligations,
    })),
  ];
  const bundle = {
    schema_version: '1',
    status: 'PASS',
    artifact_sha256: scan.artifact.sha256,
    evidence_identity_sha256: scan.evidence_identity_sha256,
    license_policy_version: topLevelDecision.license_policy_version,
    license_policy_sha256: topLevelDecision.license_policy_sha256,
    entries,
    license_texts: [
      {
        artifact_sha256: scan.artifact.sha256,
        source_relative_path: licenseFile.relative_path,
        source_sha256: licenseFile.sha256,
        materialized_sha256: materializedLicenseHash,
        text: normalizedText,
      },
    ],
  };
  bundle.notice_identity_sha256 = licenseIdentityHash(bundle);
  return bundle;
}

export function renderThirdPartyNotices(bundle) {
  const lines = [
    '# THIRD_PARTY_NOTICES',
    '',
    `Artifact SHA-256: ${bundle.artifact_sha256}`,
    `License policy: ${bundle.license_policy_version} (${bundle.license_policy_sha256})`,
    `Evidence identity: ${bundle.evidence_identity_sha256}`,
    `Notice identity: ${bundle.notice_identity_sha256}`,
    '',
    '## Components',
    '',
  ];
  for (const entry of bundle.entries) {
    lines.push(
      `- ${entry.package}${entry.version ? ` ${entry.version}` : ''} — ${entry.license_expression}`,
      `  - component: ${entry.component_id ?? 'TOP_LEVEL_ARTIFACT'}`,
      `  - artifact: ${entry.parent_artifact_sha256}`,
      `  - source: ${entry.source}`,
      `  - evidence: ${entry.license_evidence_relative_path} (${entry.license_evidence_sha256})`,
      ...(entry.copyright_holders?.length
        ? [`  - copyright holders: ${entry.copyright_holders.join('; ')}`]
        : []),
      `  - obligations: ${entry.obligations.join(', ')}`,
    );
  }
  for (const license of bundle.license_texts) {
    lines.push(
      '',
      '## Materialized License and Notice Text',
      '',
      `Source: ${license.source_relative_path}`,
      `Source SHA-256: ${license.source_sha256}`,
      `Materialized SHA-256: ${license.materialized_sha256}`,
      '',
      license.text.trimEnd(),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function materializeThirdPartyNotices(path, bundle) {
  const rendered = renderThirdPartyNotices(bundle);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rendered);
  return { path, sha256: sha256(rendered), bytes: Buffer.byteLength(rendered) };
}

export function buildReviewedArtifactNoticeEntry(decision) {
  const evidence = decision.exact_artifact_license_evidence;
  const review = decision.reviewed_license_assertion;
  if (
    !evidence ||
    !review ||
    decision.review_resolution?.status !== 'ACTIVE' ||
    decision.policy_result !== 'PASS' ||
    review.evidence_snapshot_sha256 !== evidence.evidence_snapshot_sha256
  ) {
    throw new Error('NOTICE requires an ACTIVE exact-artifact reviewed SPDX decision');
  }
  return {
    artifact_sha256: decision.artifact_sha256,
    package: decision.package,
    version: decision.version,
    license_expression: review.reviewed_spdx_expression,
    expression_source: 'AUTHORIZED_EXACT_ARTIFACT_REVIEW',
    raw_reported_license_expression: evidence.raw_license_evidence.reported_license_expression,
    raw_legacy_license_value: evidence.raw_license_evidence.legacy_license_value,
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    review_id: review.review_id,
    review_record_sha256: review.review_record_sha256,
    obligations: decision.obligations,
    license_files: evidence.raw_license_evidence.license_files,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (flag) => {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  try {
    const scanPath = value('--scan');
    const textPath = value('--license-text');
    const outputPath = value('--output');
    if (!scanPath || !textPath || !outputPath) {
      throw new Error('--scan, --license-text and --output are required');
    }
    const loaded = loadBundledLicenseEvidence(resolve(scanPath));
    const topLevel = evaluateLicenseEvidence(topLevelEvidenceFromScan(loaded.document));
    const bundled = evaluateBundledLicenseEvidence(loaded);
    const bundle = buildThirdPartyNoticeBundle(
      loaded.document,
      topLevel,
      bundled,
      readFileSync(resolve(textPath), 'utf8'),
    );
    const materialized = materializeThirdPartyNotices(resolve(outputPath), bundle);
    console.log(
      `third-party-notices: PASS (${bundle.entries.length} entries; ${materialized.sha256})`,
    );
  } catch (error) {
    console.error(`third-party-notices: FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}
