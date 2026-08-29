import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artifactLicenseEvidenceSnapshotHash,
  artifactLicenseReviewRecordHash,
  loadArtifactLicenseReviewPolicy,
  resolveArtifactLicenseReview,
  validateArtifactLicenseEvidenceV3,
  validateArtifactLicenseReviewV1,
} from '../../tools/license-policy/artifact-review.mjs';
import { parseSpdxExpression } from '../../tools/license-policy/spdx-parser.mjs';
import { buildReviewedArtifactNoticeEntry } from '../../tools/license-policy/notices.mjs';
import { auditPythonLicenses } from '../../tools/python-supply-chain/license.mjs';
import { buildPythonSbomRecords } from '../../tools/python-supply-chain/sbom.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixtureRoot = join(
  repositoryRoot,
  'tests/fixtures/python-supply-chain/code-c-seven-wheel-license-qicr',
);
const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8'));
const baselineCommit = '1bd82edb2e22e5038e29c2df63df779f86df2716';
const reviewPolicy = loadArtifactLicenseReviewPolicy();

function loadEvidence(name = 'flatbuffers.evidence.v3.json') {
  return JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8'));
}

function review(
  evidence: ReturnType<typeof loadEvidence>,
  overrides: Record<string, unknown> = {},
) {
  const document = {
    schema_version: '1',
    review_id: `fixture-${evidence.artifact.package}-review`,
    action: 'APPROVE',
    artifact: {
      package: evidence.artifact.package,
      version: evidence.artifact.version,
      filename: evidence.artifact.filename,
      sha256: evidence.artifact.sha256,
    },
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    reviewed_spdx_expression: 'Apache-2.0',
    review_reason: 'Regression fixture for an exact artifact and immutable evidence snapshot.',
    evidence_references: ['raw:legacy-license'],
    supersedes_review_id: null,
    revokes_review_id: null,
    reviewer: {
      identity: 'github:hed88798-dot',
      role: 'LICENSE_COMPLIANCE_APPROVER',
      authority_id: 'code-f-quality-release-compliance',
      approval_method: 'CONTROLLED_PULL_REQUEST_REQUIRED_REVIEW',
      approval_timestamp: '2026-08-29T12:00:00Z',
      approval_reference: {
        repository: 'hed88798-dot/ai-video-platform',
        pull_request: 20,
        approved_commit_sha: baselineCommit,
        approval_event_id: 'github-review:regression-fixture-only',
      },
    },
    review_policy: {
      policy_id: 'artifact-license-review-authority',
      version: '2026.08.29.1',
      policy_sha256: reviewPolicy.sha256,
      tool_version: '1',
    },
    review_record_sha256: '0'.repeat(64),
    ...overrides,
  };
  document.review_record_sha256 = artifactLicenseReviewRecordHash(document);
  return document;
}

function verifiedArtifact(evidence: ReturnType<typeof loadEvidence>) {
  const raw = evidence.raw_license_evidence;
  const artifact = {
    package_name: evidence.artifact.package,
    version: evidence.artifact.version,
    filename: evidence.artifact.filename,
    sha256: evidence.artifact.sha256,
    purl: evidence.artifact.purl,
    source: `https://pypi.org/project/${evidence.artifact.package}/${evidence.artifact.version}/`,
    source_index: 'https://pypi.org/simple',
    license_expression: raw.reported_license_expression ?? raw.legacy_license_value ?? 'UNKNOWN',
    license_files: raw.license_files.map((entry: Record<string, unknown>) => ({
      relative_path: entry.relative_path,
      sha256: entry.sha256,
    })),
    native_artifacts: [],
    dependencies: [],
    python_version: '3.13',
    python_tag: 'cp313',
    abi_tag: 'cp313',
    platform_tag: 'manylinux_2_28_x86_64',
    provenance: {
      supplier: 'Python Package Index upstream project maintainers',
      download_url: `https://files.pythonhosted.org/${evidence.artifact.filename}`,
      review_status: 'APPROVED',
    },
  };
  return {
    inventory: {
      schema_version: '1',
      inventory_id: 'fixture-linux-runtime',
      scope: 'PRODUCTION_WORKER_RUNTIME',
      packages: [artifact],
    },
    artifact,
    inspected: {
      filename: evidence.artifact.filename,
      package_name: evidence.artifact.package,
      version: evidence.artifact.version,
      metadata_sha256: raw.metadata_sha256,
      license_expression: raw.reported_license_expression,
      legacy_license: raw.legacy_license_value,
      license_classifiers: raw.classifiers,
      license_files: raw.license_files,
    },
  };
}

describe('Generic exact-artifact reviewed wheel license contract', () => {
  it('uses a valid reported SPDX expression directly and does not let a review override it', () => {
    const evidence = loadEvidence();
    evidence.raw_license_evidence.reported_license_expression = 'Apache-2.0';
    evidence.raw_license_evidence.legacy_license_value = null;
    evidence.evidence_status = 'PASS';
    evidence.evidence_snapshot_sha256 = artifactLicenseEvidenceSnapshotHash(evidence);
    const verified = verifiedArtifact(evidence);
    const unnecessaryReview = review(evidence, { reviewed_spdx_expression: 'MIT' });
    unnecessaryReview.review_record_sha256 = artifactLicenseReviewRecordHash(unnecessaryReview);
    const report = auditPythonLicenses([verified], {
      release: true,
      licenseReviews: [unnecessaryReview],
    });
    expect(report.decisions[0]).toMatchObject({
      policy_result: 'PASS',
      normalized_expression: 'Apache-2.0',
      reviewed_license_assertion: null,
    });
  });

  it('preserves raw FlatBuffers evidence and only passes an authorized exact review', () => {
    const evidence = validateArtifactLicenseEvidenceV3(loadEvidence());
    const approvedReview = validateArtifactLicenseReviewV1(review(evidence));
    expect(evidence.raw_license_evidence.legacy_license_value).toBe('Apache 2.0');
    expect(evidence.raw_license_evidence.reported_license_expression).toBeNull();
    const report = auditPythonLicenses([verifiedArtifact(evidence)], {
      release: true,
      licenseReviews: [approvedReview],
    });
    expect(report.decisions[0]).toMatchObject({
      policy_result: 'PASS',
      normalized_expression: 'Apache-2.0',
      reviewed_license_assertion: {
        review_id: approvedReview.review_id,
        reviewed_spdx_expression: 'Apache-2.0',
      },
    });
    expect(report.decisions[0].exact_artifact_license_evidence.raw_license_evidence).toEqual(
      evidence.raw_license_evidence,
    );
  });

  it('blocks legacy evidence without review and never treats a machine suggestion as approval', () => {
    const evidence = loadEvidence();
    expect(() => auditPythonLicenses([verifiedArtifact(evidence)], { release: true })).toThrow(
      /FAIL|MANUAL_REVIEW/u,
    );
    evidence.machine_suggestion = {
      status: 'UNAPPROVED_MACHINE_SUGGESTION',
      suggested_spdx_expression: 'Apache-2.0',
      generator: 'fixture-classifier-mapper',
    };
    evidence.evidence_snapshot_sha256 = artifactLicenseEvidenceSnapshotHash(evidence);
    const resolution = resolveArtifactLicenseReview(evidence, []);
    expect(resolution).toMatchObject({ status: 'MISSING', machine_suggestion_is_approval: false });
  });

  it('fails closed on artifact hash, evidence snapshot, version, and evidence conflicts', () => {
    const evidence = loadEvidence();
    const wrongHashReview = review(evidence, {
      artifact: { ...review(evidence).artifact, sha256: 'a'.repeat(64) },
    });
    expect(() => resolveArtifactLicenseReview(evidence, [wrongHashReview])).toThrow(
      /SHA-256 does not match/u,
    );

    const wrongSnapshotReview = review(evidence, {
      evidence_snapshot_sha256: 'b'.repeat(64),
    });
    expect(() => resolveArtifactLicenseReview(evidence, [wrongSnapshotReview])).toThrow(
      /snapshot has drifted/u,
    );

    const nextVersion = structuredClone(evidence);
    nextVersion.artifact.version = '25.12.20';
    nextVersion.artifact.filename = 'flatbuffers-25.12.20-py2.py3-none-any.whl';
    nextVersion.artifact.sha256 = 'c'.repeat(64);
    nextVersion.artifact.purl = 'pkg:pypi/flatbuffers@25.12.20';
    nextVersion.evidence_snapshot_sha256 = artifactLicenseEvidenceSnapshotHash(nextVersion);
    expect(resolveArtifactLicenseReview(nextVersion, [review(evidence)]).status).toBe('MISSING');

    const conflicted = verifiedArtifact(evidence);
    conflicted.inspected.license_expression = 'MIT';
    expect(() => auditPythonLicenses([conflicted], { release: true })).toThrow(
      /conflict\/failure/u,
    );
  });

  it('requires authorized reviewers and rejects conflicting ACTIVE reviews', () => {
    const evidence = loadEvidence();
    const unauthorized = review(evidence);
    unauthorized.reviewer.identity = 'ci:automatic-license-normalizer';
    unauthorized.review_record_sha256 = artifactLicenseReviewRecordHash(unauthorized);
    expect(() => validateArtifactLicenseReviewV1(unauthorized)).toThrow(/not authorized/u);

    const wrongPolicy = review(evidence);
    wrongPolicy.review_policy.policy_sha256 = 'd'.repeat(64);
    wrongPolicy.review_record_sha256 = artifactLicenseReviewRecordHash(wrongPolicy);
    expect(() => validateArtifactLicenseReviewV1(wrongPolicy)).toThrow(
      /authority policy identity mismatch/u,
    );

    const tamperedRecord = review(evidence);
    tamperedRecord.review_reason = 'Changed after the authorized review was recorded.';
    expect(() => validateArtifactLicenseReviewV1(tamperedRecord)).toThrow(
      /review record hash mismatch/u,
    );

    const first = review(evidence, { review_id: 'fixture-flatbuffers-first' });
    first.review_record_sha256 = artifactLicenseReviewRecordHash(first);
    const second = review(evidence, {
      review_id: 'fixture-flatbuffers-second',
      reviewed_spdx_expression: 'MIT',
    });
    second.review_record_sha256 = artifactLicenseReviewRecordHash(second);
    expect(() => resolveArtifactLicenseReview(evidence, [first, second])).toThrow(
      /conflicting ACTIVE/u,
    );
  });

  it('derives supersession and revocation from explicit immutable review records', () => {
    const evidence = loadEvidence();
    const original = review(evidence, { review_id: 'fixture-flatbuffers-original' });
    original.review_record_sha256 = artifactLicenseReviewRecordHash(original);
    const successor = review(evidence, {
      review_id: 'fixture-flatbuffers-successor',
      action: 'SUPERSEDE',
      reviewed_spdx_expression: '(MIT OR Apache-2.0) AND BSD-2-Clause',
      supersedes_review_id: original.review_id,
    });
    successor.review_record_sha256 = artifactLicenseReviewRecordHash(successor);
    const superseded = resolveArtifactLicenseReview(evidence, [original, successor]);
    expect(superseded.active_review.review_id).toBe(successor.review_id);
    expect(superseded.review_states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ review_id: original.review_id, state: 'SUPERSEDED' }),
        expect.objectContaining({ review_id: successor.review_id, state: 'ACTIVE' }),
      ]),
    );
    expect(parseSpdxExpression(successor.reviewed_spdx_expression).normalized_expression).toBe(
      '(MIT OR Apache-2.0) AND BSD-2-Clause',
    );

    const revocation = review(evidence, {
      review_id: 'fixture-flatbuffers-revocation',
      action: 'REVOKE',
      reviewed_spdx_expression: null,
      revokes_review_id: successor.review_id,
      evidence_references: ['review:fixture-flatbuffers-successor'],
    });
    revocation.review_record_sha256 = artifactLicenseReviewRecordHash(revocation);
    const revoked = resolveArtifactLicenseReview(evidence, [original, successor, revocation]);
    expect(revoked).toMatchObject({ status: 'REVOKED', active_review: null });
    expect(() =>
      auditPythonLicenses([verifiedArtifact(evidence)], {
        release: true,
        licenseReviews: [original, successor, revocation],
      }),
    ).toThrow(/FAIL/u);
  });

  it('replays historical evidence/review deterministically and carries raw/reviewed facts to SBOM and NOTICE', () => {
    const evidence = loadEvidence();
    const approvedReview = review(evidence);
    const first = auditPythonLicenses([verifiedArtifact(evidence)], {
      release: true,
      licenseReviews: [approvedReview],
    });
    const replay = auditPythonLicenses([verifiedArtifact(evidence)], {
      release: true,
      licenseReviews: [approvedReview],
    });
    expect(replay.decisions).toEqual(first.decisions);

    const verified = verifiedArtifact(evidence);
    const records = buildPythonSbomRecords([{ document: verified.inventory }], [], first.decisions);
    const component = records.components.find(
      (entry: Record<string, unknown>) =>
        entry['bom-ref'] === `urn:python-wheel:sha256:${evidence.artifact.sha256}`,
    );
    expect(component.licenses).toEqual([{ expression: 'Apache-2.0' }]);
    expect(component.properties).toEqual(
      expect.arrayContaining([
        { name: 'com.company.license.raw.legacy_license_value', value: 'Apache 2.0' },
        { name: 'com.company.license.reviewed_spdx_expression', value: 'Apache-2.0' },
      ]),
    );
    expect(buildReviewedArtifactNoticeEntry(first.decisions[0])).toMatchObject({
      license_expression: 'Apache-2.0',
      raw_legacy_license_value: 'Apache 2.0',
      expression_source: 'AUTHORIZED_EXACT_ARTIFACT_REVIEW',
    });
  });

  it('preserves all seven exact Code C wheel fixtures without committing wheel binaries', () => {
    expect(manifest.artifacts).toHaveLength(7);
    const hashes = new Set<string>();
    for (const fixture of manifest.artifacts) {
      const evidence = validateArtifactLicenseEvidenceV3(loadEvidence(fixture.evidence));
      expect(hashes.has(evidence.artifact.sha256)).toBe(false);
      hashes.add(evidence.artifact.sha256);
      const assertion = review(evidence, {
        review_id: fixture.review_id,
        reviewed_spdx_expression: fixture.reviewed_spdx_expression,
        evidence_references: fixture.evidence_references,
      });
      assertion.review_record_sha256 = artifactLicenseReviewRecordHash(assertion);
      expect(resolveArtifactLicenseReview(evidence, [assertion]).status).toBe('ACTIVE');
      if (fixture.expected_review_outcome === 'EVIDENCE_INSUFFICIENT_FAIL_CLOSED') {
        expect(evidence.evidence_status).toBe('FAIL');
      }
    }
    expect(
      manifest.artifacts.find((entry: Record<string, string>) =>
        entry.evidence.startsWith('flatbuffers'),
      ).reviewed_spdx_expression,
    ).toBe('Apache-2.0');
  });
});
