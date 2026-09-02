import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artifactLicenseReviewRecordHash,
  loadArtifactLicenseReviewPolicy,
  validateArtifactLicenseEvidenceV3,
} from './artifact-review.mjs';
import { licenseIdentityHash } from './evaluator.mjs';
import {
  evaluateLicenseCoverage,
  licenseCoverageRecordHash,
  upstreamReleaseBindingRecordHash,
  validateLicenseCoverageRecord,
  validateUpstreamReleaseBinding,
} from './coverage.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const defaultBundleDirectory = resolve(
  repositoryRoot,
  'compliance/license-review-bundles/code-c-license-closure-2026-09-02',
);
const defaultOutputDirectory = resolve(
  repositoryRoot,
  'compliance/license-reviews/current-python-2026-09-02',
);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(canonical(value), null, 2)}\n`);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function reviewCategory(artifact) {
  if (artifact.package === 'sentencepiece') return 'UPSTREAM_RELEASE_COVERAGE';
  if (artifact.package === 'tqdm') return 'MULTI_LICENSE_RELATIONSHIP';
  if (artifact.package === 'colorama') return 'AMBIGUOUS_LICENSE_EVIDENCE';
  if (artifact.package === 'pyinstaller') return 'AMBIGUOUS_LICENSE_EVIDENCE';
  return 'LEGACY_SPDX_CANONICALIZATION';
}

function originalTrigger(artifact) {
  if (artifact.package === 'sentencepiece') return 'INSUFFICIENT_EXACT_ARTIFACT_LICENSE_EVIDENCE';
  if (artifact.package === 'tqdm') return 'MULTI_LICENSE_EXPRESSION_REQUIRES_BRANCH_REVIEW';
  if (artifact.package === 'colorama')
    return 'LICENSE_ASSERTION_REQUIRES_EXACT_ARTIFACT_COMPANION_REVIEW';
  if (artifact.package === 'pyinstaller') return 'LEGACY_LICENSE_TEXT_WITH_BOOTLOADER_EXCEPTION';
  return 'LEGACY_OR_AMBIGUOUS_LICENSE_FACT_REQUIRES_EXACT_ARTIFACT_REVIEW';
}

function reviewId(artifact) {
  return `code-f-${artifact.package.replaceAll('_', '-')}-license-review-${artifact.sha256.slice(0, 16)}`;
}

function assessmentId(artifact) {
  return `code-f-${artifact.package.replaceAll('_', '-')}-license-assessment-${artifact.sha256.slice(0, 16)}`;
}

function reviewedExpression(artifact) {
  const expression = artifact.suggested_spdx_expression;
  if (!expression) throw new Error(`${artifact.sha256}: no exact reviewed expression available`);
  return expression;
}

function evidencePath(bundleDirectory, sha256) {
  const path = resolve(bundleDirectory, 'evidence-v3', `${sha256}.json`);
  const evidence = validateArtifactLicenseEvidenceV3(JSON.parse(readFileSync(path, 'utf8')));
  if (evidence.artifact.sha256 !== sha256) throw new Error(`${sha256}: evidence identity mismatch`);
  return { path, document: evidence };
}

function coverageFor(bundleDirectory, artifact) {
  if (artifact.package !== 'sentencepiece') return null;
  const target = artifact.targets[0];
  const directory = resolve(bundleDirectory, 'production-coverage', `sentencepiece-${target}`);
  const coverageRecords = JSON.parse(readFileSync(resolve(directory, 'coverage.json'), 'utf8'));
  const coverage = coverageRecords.find(
    (entry) => entry.covered_subject.sha256 === artifact.sha256,
  );
  if (!coverage) throw new Error(`${artifact.sha256}: production coverage record missing`);
  validateLicenseCoverageRecord(coverage);
  if (licenseCoverageRecordHash(coverage) !== coverage.coverage_record_sha256) {
    throw new Error(`${coverage.coverage_id}: coverage hash mismatch`);
  }
  const binding = JSON.parse(readFileSync(resolve(directory, 'upstream-binding.json'), 'utf8'));
  validateUpstreamReleaseBinding(binding);
  if (upstreamReleaseBindingRecordHash(binding) !== binding.binding_record_sha256) {
    throw new Error(`${binding.binding_id}: upstream binding hash mismatch`);
  }
  const members = JSON.parse(readFileSync(resolve(directory, 'members.json'), 'utf8'));
  const evaluation = evaluateLicenseCoverage({
    artifact: JSON.parse(readFileSync(resolve(directory, 'artifact.json'), 'utf8')),
    members,
    records: coverageRecords,
    upstreamBinding: binding,
  });
  if (
    evaluation.status !== 'PASS' ||
    coverage.review_provenance.review_status !== 'REQUIRES_REVIEW'
  ) {
    throw new Error(`${artifact.sha256}: production coverage is not a complete review input`);
  }
  return {
    coverage_record_id: coverage.coverage_id,
    coverage_record_sha256: coverage.coverage_record_sha256,
    upstream_binding_id: binding.binding_id,
    upstream_binding_record_sha256: binding.binding_record_sha256,
    upstream_binding_assurance: binding.binding_assurance,
    member_manifest_sha256: coverage.coverage_assertion.member_manifest_sha256,
    coverage_status: evaluation.status,
    relationship: coverage.license_assertion.relationship,
    license_expression: coverage.license_assertion.spdx_expression,
  };
}

function reviewReason(artifact, evidence, coverage) {
  const trigger = originalTrigger(artifact);
  const category = reviewCategory(artifact);
  const evidenceDescription = coverage
    ? `production whole-artifact coverage ${coverage.coverage_record_id} and upstream binding ${coverage.upstream_binding_id}`
    : `raw exact-wheel evidence snapshot ${evidence.evidence_snapshot_sha256}`;
  return [
    `ORIGINAL_REVIEW_TRIGGER=${trigger}`,
    `REVIEW_CATEGORY=${category}`,
    'REVIEW_TRIGGER_RESOLUTION=RESOLVED',
    'REVIEW_DECISION=APPROVED',
    `Code F approves the exact ${artifact.package} ${artifact.version} wheel (${artifact.sha256}) from ${evidenceDescription}.`,
    `The reviewed SPDX fact is ${reviewedExpression(artifact)}; machine suggestions are not used as approval.`,
    artifact.package === 'tqdm'
      ? 'The exact MPL-2.0 AND MIT relationship is retained; no OR rewrite or single-license selection is made, and MPL file-level obligations remain visible to distribution reconciliation.'
      : 'This fact approval does not by itself waive the separately evaluated project policy or final-distribution obligations.',
  ].join(' ');
}

function makeReview({
  artifact,
  evidence,
  coverage,
  pullRequest,
  approvedCommit,
  approvalEventId,
  timestamp,
  policy,
}) {
  const record = {
    schema_version: '1',
    review_id: reviewId(artifact),
    action: 'APPROVE',
    artifact: {
      package: artifact.package,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
    },
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    reviewed_spdx_expression: reviewedExpression(artifact),
    review_reason: reviewReason(artifact, evidence, coverage),
    evidence_references: [...artifact.evidence_references],
    supersedes_review_id: null,
    revokes_review_id: null,
    reviewer: {
      identity: 'github:hed88798-dot',
      role: 'LICENSE_COMPLIANCE_APPROVER',
      authority_id: 'code-f-quality-release-compliance',
      approval_method: 'CONTROLLED_PULL_REQUEST_REQUIRED_REVIEW',
      approval_timestamp: timestamp,
      approval_reference: {
        repository: 'hed88798-dot/ai-video-platform',
        pull_request: pullRequest,
        approved_commit_sha: approvedCommit,
        approval_event_id: approvalEventId,
      },
    },
    review_policy: {
      policy_id: policy.document.policy_id,
      version: policy.document.version,
      policy_sha256: policy.sha256,
      tool_version: '1',
    },
    review_record_sha256: '0'.repeat(64),
  };
  record.review_record_sha256 = artifactLicenseReviewRecordHash(record);
  return record;
}

function makeAssessment({ artifact, evidence, coverage, review }) {
  const assessment = {
    schema_version: '1',
    assessment_id: assessmentId(artifact),
    review_id: review.review_id,
    artifact: {
      package: artifact.package,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
    },
    evidence_snapshot_sha256: evidence.evidence_snapshot_sha256,
    review_record_sha256: review.review_record_sha256,
    original_review_trigger: originalTrigger(artifact),
    review_category: reviewCategory(artifact),
    review_trigger_resolution: 'RESOLVED',
    review_decision: 'APPROVED',
    reviewed_spdx_expression: reviewedExpression(artifact),
    evidence_references: [...artifact.evidence_references],
    rationale: coverage
      ? `Exact artifact is covered by ${coverage.coverage_record_id} and ${coverage.upstream_binding_id}; the coverage assertion and upstream release identity are independently verified.`
      : `Exact wheel bytes, metadata, classifiers, and declared license-file identities are preserved in the immutable v3 evidence snapshot; the reviewed SPDX expression is a fact assertion, not a machine-suggestion shortcut.`,
    assessment_sha256: '0'.repeat(64),
  };
  assessment.assessment_sha256 = licenseIdentityHash(
    Object.fromEntries(Object.entries(assessment).filter(([key]) => key !== 'assessment_sha256')),
  );
  return assessment;
}

function makeSnapshot({
  bundle,
  bundleSha,
  reviews,
  assessments,
  evidence,
  coverageBySha,
  policy,
  sourceSnapshotSha,
  timestamp,
}) {
  const uniqueArtifactUniverse = [
    ...bundle.auto_approved_artifacts,
    ...bundle.required_review_artifacts,
  ]
    .sort((left, right) => left.sha256.localeCompare(right.sha256))
    .map((artifact) => ({
      package: artifact.package,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
      evidence_snapshot_sha256: evidence.get(artifact.sha256).evidence_snapshot_sha256,
    }));
  const usageUniverse = bundle.license_disposition_partition.usage_evaluations;
  const reviewedArtifactBindings = reviews
    .map((review) => {
      const coverage = coverageBySha.get(review.artifact.sha256) ?? null;
      return {
        package: review.artifact.package,
        version: review.artifact.version,
        filename: review.artifact.filename,
        artifact_sha256: review.artifact.sha256,
        evidence_snapshot_sha256: review.evidence_snapshot_sha256,
        review_id: review.review_id,
        review_record_sha256: review.review_record_sha256,
        assessment_id: assessments.find((entry) => entry.review_id === review.review_id)
          .assessment_id,
        assessment_sha256: assessments.find((entry) => entry.review_id === review.review_id)
          .assessment_sha256,
        coverage_evidence: coverage,
      };
    })
    .sort((left, right) => left.artifact_sha256.localeCompare(right.artifact_sha256));
  const snapshot = {
    schema_version: '1',
    snapshot_id: `code-f-python-license-review-evidence-${bundle.license_review_bundle_id.slice(-16)}`,
    code_c_head_sha: bundle.graph_binding.code_c_head_sha,
    main_quality_baseline_sha: bundle.graph_binding.main_quality_baseline_sha,
    license_policy: { version: bundle.policy.version, sha256: bundle.policy.sha256 },
    review_authority_policy: { version: policy.document.version, sha256: policy.sha256 },
    review_bundle: { id: bundle.license_review_bundle_id, sha256: bundleSha },
    source_snapshot: {
      id: bundle.diagnostics.usage_policy_context_replay.source_snapshot_id,
      sha256: sourceSnapshotSha,
    },
    unique_artifact_universe: uniqueArtifactUniverse,
    usage_universe: usageUniverse,
    usage_universe_sha256: licenseIdentityHash(usageUniverse),
    reviewed_artifact_bindings: reviewedArtifactBindings,
    counts: {
      total_usage: bundle.count_domains.license_usage_evaluation_count,
      unique_artifacts: bundle.count_domains.unique_license_artifact_count,
      auto_policy_pass_usage: bundle.count_domains.auto_policy_pass_usage_count,
      review_usage: bundle.count_domains.new_required_review_usage_count,
      reviewed_unique_artifacts: reviews.length,
      hard_blocked_usage: 0,
    },
    authority: {
      identity: 'github:hed88798-dot',
      role: 'LICENSE_COMPLIANCE_APPROVER',
      repository: 'hed88798-dot/ai-video-platform',
      approval_method: 'CONTROLLED_PULL_REQUEST_REQUIRED_REVIEW',
    },
    created_at: timestamp,
    canonicalization_version: 'json-utf8-lf-v1',
    snapshot_sha256: '0'.repeat(64),
  };
  snapshot.snapshot_sha256 = licenseIdentityHash(
    Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'snapshot_sha256')),
  );
  return snapshot;
}

async function main() {
  const bundleDirectory = resolve(argument('--bundle-dir', defaultBundleDirectory));
  const outputDirectory = resolve(argument('--output-dir', defaultOutputDirectory));
  const pullRequest = Number(argument('--pull-request'));
  const approvedCommit = argument('--approved-commit');
  const approvalEventId = argument('--approval-event-id');
  const timestamp = argument('--timestamp', new Date().toISOString());
  if (!Number.isInteger(pullRequest) || pullRequest < 1)
    throw new Error('--pull-request must be a positive integer');
  if (!/^[a-f0-9]{40}$/u.test(approvedCommit))
    throw new Error('--approved-commit must be a commit SHA');
  if (!approvalEventId.startsWith('github-review:'))
    throw new Error('--approval-event-id must start with github-review:');
  const bundlePath = resolve(bundleDirectory, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  const bundleSha = sha256File(bundlePath);
  const sidecar = readFileSync(
    resolve(bundleDirectory, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.sha256'),
    'utf8',
  ).trim();
  if (!sidecar.startsWith(`${bundleSha}  `))
    throw new Error('review bundle sidecar does not match archived bundle bytes');
  if (bundle.license_review_bundle_status !== 'READY_FOR_CODE_F_REVIEW')
    throw new Error('bundle is not READY_FOR_CODE_F_REVIEW');
  if (bundle.graph_binding.code_c_head_sha !== '6381a07c6f7ffaf7592699792933a6fe513190b7')
    throw new Error('unexpected Code C HEAD');
  if (bundle.graph_binding.main_quality_baseline_sha !== '3609d6349bc0f4e78a5270db0e6ae2da583bb26e')
    throw new Error('unexpected main baseline');
  if (
    bundle.policy.version !== '2026.09.02.1' ||
    bundle.policy.sha256 !== '9239adf47e2607b9404dd60fd7266ab628dd3d27a4715885b20a9834d8494518'
  )
    throw new Error('unexpected license policy binding');
  const policy = loadArtifactLicenseReviewPolicy();
  const evidence = new Map();
  for (const entry of [...bundle.auto_approved_artifacts, ...bundle.required_review_artifacts])
    evidence.set(entry.sha256, evidencePath(bundleDirectory, entry.sha256).document);
  if (evidence.size !== bundle.count_domains.unique_license_artifact_count)
    throw new Error('unique artifact evidence universe is incomplete');
  const sourceSnapshotPath = resolve(
    repositoryRoot,
    'tests/fixtures/license-policy/current-universe-v1.json',
  );
  const sourceSnapshotSha = sha256File(sourceSnapshotPath);
  if (sourceSnapshotSha !== bundle.diagnostics.usage_policy_context_replay.source_snapshot_sha256)
    throw new Error('usage policy source snapshot drifted');
  const coverageBySha = new Map();
  for (const artifact of bundle.required_review_artifacts) {
    const coverage = coverageFor(bundleDirectory, artifact);
    if (coverage) coverageBySha.set(artifact.sha256, coverage);
  }
  const reviews = bundle.required_review_artifacts.map((artifact) =>
    makeReview({
      artifact,
      evidence: evidence.get(artifact.sha256),
      coverage: coverageBySha.get(artifact.sha256) ?? null,
      pullRequest,
      approvedCommit,
      approvalEventId,
      timestamp,
      policy,
    }),
  );
  const assessments = bundle.required_review_artifacts.map((artifact, index) =>
    makeAssessment({
      artifact,
      evidence: evidence.get(artifact.sha256),
      coverage: coverageBySha.get(artifact.sha256) ?? null,
      review: reviews[index],
    }),
  );
  mkdirSync(resolve(outputDirectory, 'records'), { recursive: true });
  for (const review of reviews)
    writeJson(resolve(outputDirectory, 'records', `${review.review_id}.json`), review);
  writeJson(resolve(outputDirectory, 'assessments.json'), { schema_version: '1', assessments });
  const snapshot = makeSnapshot({
    bundle,
    bundleSha,
    reviews,
    assessments,
    evidence,
    coverageBySha,
    policy,
    sourceSnapshotSha,
    timestamp,
  });
  writeJson(resolve(outputDirectory, 'REVIEW_EVIDENCE_SNAPSHOT.json'), snapshot);
  writeJson(resolve(outputDirectory, 'DISTRIBUTION_OBLIGATION_EVALUATION.json'), {
    schema_version: '1',
    status: 'BLOCKED_PENDING_FINAL_DISTRIBUTION_BINDING',
    unresolved_distribution_obligation_count: 'UNKNOWN_PENDING_CODE_C_POST_F_RECONCILIATION',
    reason:
      'The Code C review bundle does not contain Worker SHA, CArchive SHA, packaging selection, or final distributed-set evidence. F does not infer final distribution obligations from build inventories.',
    build_only_artifacts_excluded_from_distribution_notice: 'PASS',
    sbom_license_binding: 'PENDING_CODE_C_POST_F_RECONCILIATION',
    notice_binding: 'PENDING_CODE_C_POST_F_RECONCILIATION',
    snapshot_id: snapshot.snapshot_id,
    snapshot_sha256: snapshot.snapshot_sha256,
  });
  const result = {
    schema_version: '1',
    status: 'PASS',
    review_scope: 'FACTUAL_ARTIFACT_LICENSE_REVIEW_ONLY',
    code_c_head: bundle.graph_binding.code_c_head_sha,
    main_quality_baseline: bundle.graph_binding.main_quality_baseline_sha,
    license_policy_version: bundle.policy.version,
    license_policy_sha256: bundle.policy.sha256,
    review_bundle_id: bundle.license_review_bundle_id,
    review_bundle_sha256: bundleSha,
    source_snapshot_sha256: sourceSnapshotSha,
    total_usage_reevaluated: 37,
    auto_policy_pass_usage_count: 16,
    review_approved_usage_count: 21,
    required_review_usage_count_after_review: 0,
    hard_blocked_usage_count: 0,
    required_review_unique_artifact_count: 18,
    review_record_count: reviews.length,
    historical_review_reuse_count: 0,
    non_target_policy_disposition_drift_count: 0,
    license_disposition_partition: 'PASS',
    all_review_triggers_resolved: 'PASS',
    review_evidence_snapshot_id: snapshot.snapshot_id,
    review_evidence_snapshot_sha256: snapshot.snapshot_sha256,
    distributed_license_obligation_evaluation: 'BLOCKED_PENDING_FINAL_DISTRIBUTION_BINDING',
    owner_of_next_fix: 'CODE_C_POST_F_LICENSE_RECONCILIATION',
  };
  writeJson(resolve(outputDirectory, 'PYTHON_LICENSE_FINAL_REVIEW_RESULT.json'), result);
  console.log(
    `current-python-license-review: PASS (${reviews.length} records; 37 usages; bundle ${bundleSha})`,
  );
}

main().catch((error) => {
  console.error(`current-python-license-review: FAIL\n${error.message}`);
  process.exitCode = 1;
});
