import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  loadArtifactLicenseReviewPolicy,
  validateArtifactLicenseEvidenceV3,
  validateArtifactLicenseReviewV1,
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
const defaultReviewDirectory = resolve(
  repositoryRoot,
  'compliance/license-reviews/current-python-2026-09-02',
);
const assessmentSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-license-review-assessment/v1/assessment.schema.json',
);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function schemaError(validate) {
  return (validate.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function makeAssessmentValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(loadJson(assessmentSchemaPath));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} != ${expected}`);
}

function verifyCoverage(bundleDirectory, artifact) {
  if (artifact.package !== 'sentencepiece') return null;
  const target = artifact.targets[0];
  const root = resolve(bundleDirectory, 'production-coverage', `sentencepiece-${target}`);
  const coverageRecords = loadJson(resolve(root, 'coverage.json'));
  const coverage = coverageRecords.find(
    (entry) => entry.covered_subject.sha256 === artifact.sha256,
  );
  if (!coverage) throw new Error(`${artifact.sha256}: production coverage record missing`);
  validateLicenseCoverageRecord(coverage);
  assertEqual(
    licenseCoverageRecordHash(coverage),
    coverage.coverage_record_sha256,
    `${artifact.sha256}: coverage hash`,
  );
  const binding = loadJson(resolve(root, 'upstream-binding.json'));
  validateUpstreamReleaseBinding(binding);
  assertEqual(
    upstreamReleaseBindingRecordHash(binding),
    binding.binding_record_sha256,
    `${artifact.sha256}: upstream binding hash`,
  );
  const evaluation = evaluateLicenseCoverage({
    artifact: loadJson(resolve(root, 'artifact.json')),
    members: loadJson(resolve(root, 'members.json')),
    records: coverageRecords,
    upstreamBinding: binding,
  });
  if (evaluation.status !== 'PASS')
    throw new Error(`${artifact.sha256}: production coverage evaluation failed`);
  if (coverage.review_provenance.review_status !== 'REQUIRES_REVIEW')
    throw new Error(`${artifact.sha256}: coverage was treated as approval`);
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

function reviewEvidenceSnapshotHash(evidence, coverage) {
  if (!coverage) return evidence.evidence_snapshot_sha256;
  return licenseIdentityHash({
    coverage_record_id: coverage.coverage_record_id,
    coverage_record_sha256: [coverage.coverage_record_sha256],
    upstream_binding_id: coverage.upstream_binding_id,
    upstream_binding_record_sha256: coverage.upstream_binding_record_sha256,
    member_manifest_sha256: coverage.member_manifest_sha256,
  });
}

function main() {
  const bundleDirectory = resolve(argument('--bundle-dir', defaultBundleDirectory));
  const reviewDirectory = resolve(argument('--review-dir', defaultReviewDirectory));
  const bundlePath = resolve(bundleDirectory, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.json');
  const bundle = loadJson(bundlePath);
  const bundleSha = sha256File(bundlePath);
  const sidecar = readFileSync(
    resolve(bundleDirectory, 'CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.sha256'),
    'utf8',
  ).trim();
  if (!sidecar.startsWith(`${bundleSha}  `))
    throw new Error('review bundle sidecar does not match archived bytes');
  const expectedIdentity = licenseIdentityHash({
    graph_binding: bundle.graph_binding,
    auto_approved_artifacts: bundle.auto_approved_artifacts,
    required_review_artifacts: bundle.required_review_artifacts,
    hard_blocked_artifacts: bundle.hard_blocked_artifacts,
  });
  assertEqual(expectedIdentity, bundle.bundle_identity_sha256, 'bundle identity');
  assertEqual(bundle.license_review_bundle_status, 'READY_FOR_CODE_F_REVIEW', 'bundle status');
  assertEqual(
    bundle.graph_binding.code_c_head_sha,
    '81582dc91f5e72be6fa8ac41065f31794516d099',
    'Code C HEAD',
  );
  assertEqual(
    bundle.graph_binding.main_quality_baseline_sha,
    '3609d6349bc0f4e78a5270db0e6ae2da583bb26e',
    'main baseline',
  );
  assertEqual(bundle.policy.version, '2026.09.02.1', 'license policy version');
  assertEqual(
    bundle.policy.sha256,
    '9239adf47e2607b9404dd60fd7266ab628dd3d27a4715885b20a9834d8494518',
    'license policy hash',
  );
  const sourceSnapshotPath = resolve(
    repositoryRoot,
    'tests/fixtures/license-policy/current-universe-v1.json',
  );
  assertEqual(
    sha256File(sourceSnapshotPath),
    bundle.diagnostics.usage_policy_context_replay.source_snapshot_sha256,
    'source snapshot hash',
  );

  const policy = loadArtifactLicenseReviewPolicy();
  const evidenceBySha = new Map();
  for (const artifact of [...bundle.auto_approved_artifacts, ...bundle.required_review_artifacts]) {
    const evidencePath = resolve(bundleDirectory, 'evidence-v3', `${artifact.sha256}.json`);
    const evidence = validateArtifactLicenseEvidenceV3(loadJson(evidencePath));
    assertEqual(
      evidence.artifact.sha256,
      artifact.sha256,
      `${artifact.sha256}: evidence artifact SHA`,
    );
    evidenceBySha.set(artifact.sha256, evidence);
  }
  assertEqual(
    evidenceBySha.size,
    bundle.count_domains.unique_license_artifact_count,
    'unique evidence count',
  );

  const coverageBySha = new Map();
  for (const artifact of bundle.required_review_artifacts) {
    const coverage = verifyCoverage(bundleDirectory, artifact);
    if (coverage) coverageBySha.set(artifact.sha256, coverage);
  }
  for (const artifact of [...bundle.auto_approved_artifacts, ...bundle.required_review_artifacts]) {
    const evidence = evidenceBySha.get(artifact.sha256);
    assertEqual(
      artifact.evidence_snapshot_sha256,
      reviewEvidenceSnapshotHash(evidence, coverageBySha.get(artifact.sha256)),
      `${artifact.sha256}: review evidence snapshot`,
    );
  }

  const recordDirectory = resolve(reviewDirectory, 'records');
  const recordPaths = readdirSync(recordDirectory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const reviews = recordPaths.map((name) =>
    validateArtifactLicenseReviewV1(loadJson(resolve(recordDirectory, name)), { policy }),
  );
  assertEqual(
    reviews.length,
    bundle.count_domains.new_required_review_unique_artifact_count,
    'review record count',
  );
  const requiredBySha = new Map(
    bundle.required_review_artifacts.map((entry) => [entry.sha256, entry]),
  );
  const seenReviewArtifacts = new Set();
  for (const review of reviews) {
    const requested = requiredBySha.get(review.artifact.sha256);
    if (!requested)
      throw new Error(`${review.review_id}: review is not requested by current bundle`);
    if (seenReviewArtifacts.has(review.artifact.sha256))
      throw new Error(`${review.artifact.sha256}: duplicate active review record`);
    seenReviewArtifacts.add(review.artifact.sha256);
    for (const key of ['package', 'version', 'filename'])
      assertEqual(review.artifact[key], requested[key], `${review.review_id}: ${key}`);
    assertEqual(
      review.evidence_snapshot_sha256,
      requested.evidence_snapshot_sha256,
      `${review.review_id}: evidence snapshot`,
    );
    assertEqual(
      review.reviewer.approval_reference.repository,
      'hed88798-dot/ai-video-platform',
      `${review.review_id}: repository`,
    );
    if (review.reviewer.approval_reference.approval_event_id.startsWith('github-review:') === false)
      throw new Error(`${review.review_id}: approval event is not a GitHub review`);
  }
  assertEqual(seenReviewArtifacts.size, 18, 'required review artifact set');

  const assessmentValidator = makeAssessmentValidator();
  const assessmentDocument = loadJson(resolve(reviewDirectory, 'assessments.json'));
  if (assessmentDocument.schema_version !== '1' || !Array.isArray(assessmentDocument.assessments))
    throw new Error('assessment document must contain schema_version 1 and an assessments array');
  const assessmentByReview = new Map();
  for (const assessment of assessmentDocument.assessments) {
    if (!assessmentValidator(assessment))
      throw new Error(`assessment schema invalid: ${schemaError(assessmentValidator)}`);
    assertEqual(
      licenseIdentityHash(withoutKey(assessment, 'assessment_sha256')),
      assessment.assessment_sha256,
      `${assessment.assessment_id}: assessment hash`,
    );
    if (
      assessment.review_decision !== 'APPROVED' ||
      assessment.review_trigger_resolution !== 'RESOLVED'
    )
      throw new Error(`${assessment.assessment_id}: trigger is not resolved with approval`);
    const review = reviews.find((entry) => entry.review_id === assessment.review_id);
    if (!review) throw new Error(`${assessment.assessment_id}: review record missing`);
    assertEqual(
      assessment.review_record_sha256,
      review.review_record_sha256,
      `${assessment.assessment_id}: review record binding`,
    );
    assertEqual(
      assessment.evidence_snapshot_sha256,
      review.evidence_snapshot_sha256,
      `${assessment.assessment_id}: evidence binding`,
    );
    assertEqual(
      assessment.artifact.sha256,
      review.artifact.sha256,
      `${assessment.assessment_id}: artifact binding`,
    );
    if (assessmentByReview.has(assessment.review_id))
      throw new Error(`${assessment.review_id}: duplicate assessment`);
    assessmentByReview.set(assessment.review_id, assessment);
  }
  assertEqual(assessmentByReview.size, 18, 'assessment count');

  const snapshot = loadJson(resolve(reviewDirectory, 'REVIEW_EVIDENCE_SNAPSHOT.json'));
  assertEqual(
    licenseIdentityHash(withoutKey(snapshot, 'snapshot_sha256')),
    snapshot.snapshot_sha256,
    'review evidence snapshot hash',
  );
  assertEqual(snapshot.review_bundle.sha256, bundleSha, 'snapshot bundle hash');
  assertEqual(
    snapshot.code_c_head_sha,
    bundle.graph_binding.code_c_head_sha,
    'snapshot Code C HEAD',
  );
  assertEqual(
    snapshot.main_quality_baseline_sha,
    bundle.graph_binding.main_quality_baseline_sha,
    'snapshot main baseline',
  );
  assertEqual(snapshot.license_policy.sha256, bundle.policy.sha256, 'snapshot license policy');
  assertEqual(
    snapshot.source_snapshot.sha256,
    bundle.diagnostics.usage_policy_context_replay.source_snapshot_sha256,
    'snapshot source hash',
  );
  assertEqual(snapshot.unique_artifact_universe.length, 26, 'snapshot unique artifact universe');
  assertEqual(snapshot.usage_universe.length, 37, 'snapshot usage universe');
  assertEqual(
    snapshot.reviewed_artifact_bindings.length,
    18,
    'snapshot reviewed artifact bindings',
  );
  assertEqual(snapshot.counts.auto_policy_pass_usage, 16, 'snapshot auto usage count');
  assertEqual(snapshot.counts.review_usage, 21, 'snapshot review usage count');
  for (const binding of snapshot.reviewed_artifact_bindings) {
    const review = reviews.find((entry) => entry.review_id === binding.review_id);
    const assessment = assessmentByReview.get(binding.review_id);
    assertEqual(
      binding.review_record_sha256,
      review.review_record_sha256,
      `${binding.artifact_sha256}: snapshot review hash`,
    );
    assertEqual(
      binding.assessment_sha256,
      assessment.assessment_sha256,
      `${binding.artifact_sha256}: snapshot assessment hash`,
    );
  }

  const distribution = loadJson(
    resolve(reviewDirectory, 'DISTRIBUTION_OBLIGATION_EVALUATION.json'),
  );
  assertEqual(distribution.snapshot_id, snapshot.snapshot_id, 'distribution snapshot id');
  assertEqual(distribution.snapshot_sha256, snapshot.snapshot_sha256, 'distribution snapshot hash');
  assertEqual(
    distribution.build_only_artifacts_excluded_from_distribution_notice,
    'PASS',
    'build-only notice exclusion',
  );
  if (distribution.status !== 'BLOCKED_PENDING_FINAL_DISTRIBUTION_BINDING')
    throw new Error(
      'distribution evaluation must remain fail-closed until Code C binds final artifacts',
    );

  const result = loadJson(resolve(reviewDirectory, 'PYTHON_LICENSE_FINAL_REVIEW_RESULT.json'));
  assertEqual(result.review_bundle_sha256, bundleSha, 'result bundle hash');
  assertEqual(result.total_usage_reevaluated, 37, 'result usage count');
  assertEqual(result.auto_policy_pass_usage_count, 16, 'result auto usage count');
  assertEqual(result.review_approved_usage_count, 21, 'result approved usage count');
  assertEqual(result.required_review_usage_count_after_review, 0, 'result pending review count');
  assertEqual(result.hard_blocked_usage_count, 0, 'result hard-block count');
  assertEqual(result.non_target_policy_disposition_drift_count, 0, 'result non-target drift');
  assertEqual(result.license_disposition_partition, 'PASS', 'result disposition partition');
  assertEqual(result.all_review_triggers_resolved, 'PASS', 'result trigger resolution');
  console.log(
    `current-python-license-review: PASS (${reviews.length} exact review records; 37 usages; distribution gate remains fail-closed pending Code C final binding)`,
  );
}

try {
  main();
} catch (error) {
  console.error(`current-python-license-review: FAIL\n${error.message}`);
  process.exitCode = 1;
}
