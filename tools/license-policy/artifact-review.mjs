import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalLicenseJson, licenseIdentityHash } from './evaluator.mjs';
import { parseSpdxExpression } from './spdx-parser.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const artifactLicenseEvidenceSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/license-artifact-evidence/v3/evidence.schema.json',
);
export const artifactLicenseReviewSchemaPath = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-license-review/v1/review.schema.json',
);
export const artifactLicenseReviewPolicyPath = resolve(
  repositoryRoot,
  'compliance/license-review-policy/v1/policy.json',
);

function validator(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, 'utf8')));
}

const validateEvidenceSchema = validator(artifactLicenseEvidenceSchemaPath);
const validateReviewSchema = validator(artifactLicenseReviewSchemaPath);

function schemaErrors(validate) {
  return (validate.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

export function artifactLicenseEvidenceSnapshotHash(evidence) {
  return licenseIdentityHash({
    schema_version: evidence.schema_version,
    artifact: evidence.artifact,
    raw_license_evidence: evidence.raw_license_evidence,
    extractor: evidence.extractor,
  });
}

export function artifactLicenseReviewRecordHash(review) {
  return licenseIdentityHash(withoutKey(review, 'review_record_sha256'));
}

export function createArtifactLicenseEvidenceV3({
  artifact,
  inspected,
  evidenceStatus,
  bundledLicenseEvidenceIdentitySha256 = null,
  machineSuggestion = null,
}) {
  const evidence = {
    schema_version: '3',
    artifact: {
      package: artifact.package,
      version: artifact.version,
      filename: artifact.filename,
      sha256: artifact.sha256,
      purl: artifact.purl,
      artifact_type: 'PYTHON_WHEEL',
    },
    raw_license_evidence: {
      metadata_sha256: inspected.metadata_sha256,
      reported_license_expression: inspected.license_expression ?? null,
      legacy_license_value: inspected.legacy_license ?? null,
      classifiers: [...(inspected.license_classifiers ?? [])].sort(),
      license_files: inspected.license_files.map((entry) => ({
        relative_path: entry.relative_path,
        kind: entry.kind ?? 'OTHER_LICENSE_EVIDENCE',
        sha256: entry.sha256,
        size: entry.size,
      })),
      bundled_license_evidence_identity_sha256: bundledLicenseEvidenceIdentitySha256,
    },
    extractor: { name: 'inspect-wheel.py', version: '2' },
    machine_suggestion: machineSuggestion,
    evidence_status: evidenceStatus,
    evidence_snapshot_sha256: '0'.repeat(64),
  };
  evidence.evidence_snapshot_sha256 = artifactLicenseEvidenceSnapshotHash(evidence);
  return validateArtifactLicenseEvidenceV3(evidence);
}

export function validateArtifactLicenseEvidenceV3(evidence) {
  if (!validateEvidenceSchema(evidence)) {
    throw new Error(
      `Artifact License Evidence v3 schema invalid: ${schemaErrors(validateEvidenceSchema)}`,
    );
  }
  const expected = artifactLicenseEvidenceSnapshotHash(evidence);
  if (expected !== evidence.evidence_snapshot_sha256) {
    throw new Error(
      `${evidence.artifact.sha256}: evidence snapshot hash mismatch (${evidence.evidence_snapshot_sha256} != ${expected})`,
    );
  }
  return evidence;
}

export function loadArtifactLicenseReviewPolicy(path = artifactLicenseReviewPolicyPath) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (
    document.schema_version !== '1' ||
    document.ci_may_create_approved_records !== false ||
    document.unknown_authority !== 'FAIL_CLOSED'
  ) {
    throw new Error('Artifact License Review authority policy is not fail closed');
  }
  return { document, sha256: licenseIdentityHash(document) };
}

function assertReviewAction(review) {
  if (review.action === 'APPROVE') {
    if (
      !review.reviewed_spdx_expression ||
      review.supersedes_review_id ||
      review.revokes_review_id
    ) {
      throw new Error(`${review.review_id}: APPROVE must contain one assertion and no predecessor`);
    }
  } else if (review.action === 'SUPERSEDE') {
    if (
      !review.reviewed_spdx_expression ||
      !review.supersedes_review_id ||
      review.revokes_review_id
    ) {
      throw new Error(`${review.review_id}: SUPERSEDE must contain an assertion and predecessor`);
    }
  } else if (
    review.reviewed_spdx_expression !== null ||
    review.supersedes_review_id !== null ||
    !review.revokes_review_id
  ) {
    throw new Error(
      `${review.review_id}: REVOKE must identify one review and contain no assertion`,
    );
  }
  if (review.reviewed_spdx_expression) {
    parseSpdxExpression(review.reviewed_spdx_expression);
  }
}

function assertReviewAuthority(review, loadedPolicy) {
  const policy = loadedPolicy.document ?? loadedPolicy;
  if (
    review.review_policy.policy_id !== policy.policy_id ||
    review.review_policy.version !== policy.version ||
    review.review_policy.policy_sha256 !== loadedPolicy.sha256
  ) {
    throw new Error(`${review.review_id}: review authority policy identity mismatch`);
  }
  if (!policy.allowed_approval_methods.includes(review.reviewer.approval_method)) {
    throw new Error(`${review.review_id}: approval method is not authorized`);
  }
  const authority = policy.authorities.find(
    (entry) => entry.authority_id === review.reviewer.authority_id,
  );
  if (
    !authority ||
    authority.role !== review.reviewer.role ||
    !authority.allowed_identities.includes(review.reviewer.identity) ||
    authority.repository !== review.reviewer.approval_reference.repository
  ) {
    throw new Error(`${review.review_id}: reviewer identity/role/authority is not authorized`);
  }
  if (
    review.reviewer.approval_method === 'CONTROLLED_PULL_REQUEST_REQUIRED_REVIEW' &&
    !review.reviewer.approval_reference.approval_event_id.startsWith('github-review:')
  ) {
    throw new Error(`${review.review_id}: controlled PR approval lacks a review event identity`);
  }
}

export function validateArtifactLicenseReviewV1(
  review,
  { policy = loadArtifactLicenseReviewPolicy() } = {},
) {
  if (!validateReviewSchema(review)) {
    throw new Error(
      `Artifact License Review v1 schema invalid: ${schemaErrors(validateReviewSchema)}`,
    );
  }
  const expected = artifactLicenseReviewRecordHash(review);
  if (expected !== review.review_record_sha256) {
    throw new Error(
      `${review.review_id}: review record hash mismatch (${review.review_record_sha256} != ${expected})`,
    );
  }
  assertReviewAction(review);
  assertReviewAuthority(review, policy);
  return review;
}

export function loadArtifactLicenseReviews(paths, options = {}) {
  return paths.flatMap((path) => {
    const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records.map((record) => validateArtifactLicenseReviewV1(record, options));
  });
}

function sameArtifact(left, right) {
  return (
    left.package === right.package &&
    left.version === right.version &&
    left.filename === right.filename &&
    left.sha256 === right.sha256
  );
}

export function resolveArtifactLicenseReview(
  evidenceValue,
  reviewValues,
  { policy = loadArtifactLicenseReviewPolicy() } = {},
) {
  const evidence = validateArtifactLicenseEvidenceV3(evidenceValue);
  const reviews = reviewValues.map((review) => validateArtifactLicenseReviewV1(review, { policy }));
  const reviewIds = new Set();
  for (const review of reviews) {
    if (reviewIds.has(review.review_id))
      throw new Error(`duplicate review id: ${review.review_id}`);
    reviewIds.add(review.review_id);
  }

  const sameCoordinates = reviews.filter(
    (review) =>
      review.artifact.package === evidence.artifact.package &&
      review.artifact.version === evidence.artifact.version &&
      review.artifact.filename === evidence.artifact.filename,
  );
  const mismatchedHash = sameCoordinates.find(
    (review) => review.artifact.sha256 !== evidence.artifact.sha256,
  );
  if (mismatchedHash) {
    throw new Error(
      `${mismatchedHash.review_id}: review artifact SHA-256 does not match exact wheel`,
    );
  }
  const candidates = reviews.filter((review) => sameArtifact(review.artifact, evidence.artifact));
  const mismatchedSnapshot = candidates.find(
    (review) => review.evidence_snapshot_sha256 !== evidence.evidence_snapshot_sha256,
  );
  if (mismatchedSnapshot) {
    throw new Error(`${mismatchedSnapshot.review_id}: reviewed evidence snapshot has drifted`);
  }
  if (candidates.length === 0) {
    return {
      status: 'MISSING',
      active_review: null,
      review_states: [],
      machine_suggestion_is_approval: false,
    };
  }

  const byId = new Map(candidates.map((review) => [review.review_id, review]));
  const states = new Map(
    candidates
      .filter((review) => review.action !== 'REVOKE')
      .map((review) => [review.review_id, 'ACTIVE']),
  );
  for (const review of candidates) {
    const referencedId = review.supersedes_review_id ?? review.revokes_review_id;
    if (!referencedId) continue;
    const referenced = byId.get(referencedId);
    if (!referenced || referenced.action === 'REVOKE') {
      throw new Error(`${review.review_id}: referenced review does not exist as an assertion`);
    }
    if (review.action === 'SUPERSEDE') states.set(referencedId, 'SUPERSEDED');
    else states.set(referencedId, 'REVOKED');
  }
  const active = candidates.filter(
    (review) => review.action !== 'REVOKE' && states.get(review.review_id) === 'ACTIVE',
  );
  if (active.length > 1) {
    throw new Error(
      `${evidence.artifact.sha256}: conflicting ACTIVE license reviews (${active
        .map((entry) => entry.review_id)
        .sort()
        .join(', ')})`,
    );
  }
  const reviewStates = candidates.map((review) => ({
    review_id: review.review_id,
    action: review.action,
    state: review.action === 'REVOKE' ? 'REVOCATION_RECORD' : states.get(review.review_id),
    review_record_sha256: review.review_record_sha256,
  }));
  if (active.length === 0) {
    return {
      status: [...states.values()].includes('REVOKED') ? 'REVOKED' : 'MISSING',
      active_review: null,
      review_states: reviewStates,
      machine_suggestion_is_approval: false,
    };
  }
  return {
    status: 'ACTIVE',
    active_review: active[0],
    review_states: reviewStates,
    machine_suggestion_is_approval: false,
  };
}

export function canonicalArtifactLicenseEvidence(evidence) {
  return `${canonicalLicenseJson(evidence)}\n`;
}
