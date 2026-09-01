import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson } from '../python-supply-chain/inventory.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const provenanceRoot = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-approval-provenance/v1',
);

export const approvalSchemaPath = resolve(provenanceRoot, 'approval.schema.json');
export const reviewSnapshotSchemaPath = resolve(provenanceRoot, 'review-snapshot.schema.json');
export const revocationSchemaPath = resolve(provenanceRoot, 'revocation.schema.json');
export const authorityPolicySchemaPath = resolve(provenanceRoot, 'authority-policy.schema.json');
export const authorityPolicyPath = resolve(
  repositoryRoot,
  'compliance/approval/authority-policy-v1.json',
);

const subjectScopes = {
  PYTHON_ARTIFACT_INVENTORY: 'PYTHON_ARTIFACT_INVENTORY_PROVENANCE',
  TOOLCHAIN_EVIDENCE: 'TOOLCHAIN_PROVENANCE_APPROVAL',
};
const subjectRoles = {
  PYTHON_ARTIFACT_INVENTORY: new Set(['RUNTIME', 'WORKER_BUILD']),
  TOOLCHAIN_EVIDENCE: new Set(['TOOLCHAIN']),
};

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path}: ${error.message}`, { cause: error });
  }
}

function compileSchema(path) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(loadJson(path));
}

const validators = {
  approval: compileSchema(approvalSchemaPath),
  reviewSnapshot: compileSchema(reviewSnapshotSchemaPath),
  revocation: compileSchema(revocationSchemaPath),
  authorityPolicy: compileSchema(authorityPolicySchemaPath),
};

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function assertSchema(value, validator, label) {
  if (!validator(value)) throw new Error(`${label} schema invalid: ${schemaErrors(validator)}`);
  return value;
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

export function canonicalSha256(value) {
  return sha256Bytes(canonicalBytes(value));
}

export function readApprovalPolicy(path = authorityPolicyPath) {
  const document = assertSchema(loadJson(path), validators.authorityPolicy, 'Authority policy');
  return { document, sha256: canonicalSha256(document) };
}

export function validateAuthorityPolicy(policy) {
  return assertSchema(policy, validators.authorityPolicy, 'Authority policy');
}

function assertSha256File(path, expected, label) {
  const actual = sha256Bytes(readFileSync(path));
  if (actual !== expected) throw new Error(`${label} hash mismatch (${expected} != ${actual})`);
}

function subjectKey(record) {
  return [
    record.subject_type,
    record.subject_id,
    record.subject_schema_version,
    record.subject_sha256,
    record.subject_role,
    record.target_descriptor_id,
    record.target_descriptor_sha256,
  ].join('|');
}

function snapshotSubjectKey(subject) {
  return [
    subject.subject_type,
    subject.subject_id,
    subject.subject_schema_version,
    subject.subject_sha256,
    subject.subject_role,
    subject.target_descriptor_id,
    subject.target_descriptor_sha256,
  ].join('|');
}

function assertTargetBinding(record, targetDescriptorPath) {
  if (targetDescriptorPath)
    assertSha256File(targetDescriptorPath, record.target_descriptor_sha256, 'Target descriptor');
}

function assertAuthority(record, loadedPolicy) {
  const { document, sha256 } = loadedPolicy;
  if (
    record.authority_policy_version !== document.policy_version ||
    record.authority_policy_sha256 !== sha256
  ) {
    throw new Error(`${record.approval_id}: authority policy identity mismatch`);
  }
  const authority = document.authorities.find(
    (entry) =>
      entry.reviewer === record.reviewer &&
      entry.reviewer_role === record.reviewer_role &&
      entry.reviewer_authority === record.reviewer_authority,
  );
  if (!authority || !authority.scopes.includes(record.approval_scope)) {
    throw new Error(`${record.approval_id}: reviewer authority is not authorized for scope`);
  }
}

function assertScopeAndRole(record) {
  const expectedScope = subjectScopes[record.subject_type];
  if (record.approval_scope !== expectedScope) {
    throw new Error(`${record.approval_id}: approval scope does not match subject type`);
  }
  if (!subjectRoles[record.subject_type].has(record.subject_role)) {
    throw new Error(`${record.approval_id}: subject role does not match subject type`);
  }
}

function assertSnapshotBinding(record, snapshot) {
  if (snapshot.approval_contract_version !== '1') {
    throw new Error(`${record.approval_id}: unsupported approval contract version in snapshot`);
  }
  const match = snapshot.subjects.find((entry) => snapshotSubjectKey(entry) === subjectKey(record));
  if (!match)
    throw new Error(`${record.approval_id}: exact subject is absent from review snapshot`);
  if (snapshot.authority_policy_version !== record.authority_policy_version) {
    throw new Error(`${record.approval_id}: snapshot authority policy version mismatch`);
  }
  if (snapshot.authority_policy_sha256 !== record.authority_policy_sha256) {
    throw new Error(`${record.approval_id}: snapshot authority policy hash mismatch`);
  }
}

export function validateReviewSnapshot(snapshot) {
  return assertSchema(snapshot, validators.reviewSnapshot, 'Review snapshot');
}

export function validateApprovalRecord(
  record,
  {
    subjectPath,
    targetDescriptorPath,
    reviewSnapshotPath,
    authorityPolicy = readApprovalPolicy(),
    approvalContractSha256 = sha256Bytes(readFileSync(approvalSchemaPath)),
  } = {},
) {
  assertSchema(record, validators.approval, 'Approval record');
  assertScopeAndRole(record);
  assertAuthority(record, authorityPolicy);
  if (subjectPath) assertSha256File(subjectPath, record.subject_sha256, 'Subject');
  assertTargetBinding(record, targetDescriptorPath);
  if (reviewSnapshotPath) {
    const snapshotBytes = readFileSync(reviewSnapshotPath);
    assertSha256File(reviewSnapshotPath, record.review_evidence_snapshot_sha256, 'Review snapshot');
    const snapshot = validateReviewSnapshot(loadJson(reviewSnapshotPath));
    if (sha256Bytes(snapshotBytes) !== canonicalSha256(snapshot)) {
      throw new Error(`${record.approval_id}: review snapshot is not canonical json-utf8-lf-v1`);
    }
    assertSnapshotBinding(record, snapshot);
    if (snapshot.approval_contract_sha256 !== approvalContractSha256) {
      throw new Error(`${record.approval_id}: snapshot approval contract identity mismatch`);
    }
  }
  if (
    record.decision === 'APPROVED' &&
    record.decision_reason.toLowerCase().includes('automatic')
  ) {
    throw new Error(`${record.approval_id}: automatic approval issuance is forbidden`);
  }
  return record;
}

export function validateRevocationRecord(
  revocation,
  { authorityPolicy = readApprovalPolicy() } = {},
) {
  assertSchema(revocation, validators.revocation, 'Revocation record');
  const authority = authorityPolicy.document.authorities.find(
    (entry) =>
      entry.reviewer === revocation.reviewer &&
      entry.reviewer_role === revocation.reviewer_role &&
      entry.reviewer_authority === revocation.reviewer_authority,
  );
  if (
    !authority ||
    (!authority.scopes.includes('PYTHON_ARTIFACT_INVENTORY_PROVENANCE') &&
      !authority.scopes.includes('TOOLCHAIN_PROVENANCE_APPROVAL'))
  ) {
    throw new Error(`${revocation.revocation_id}: revocation authority is not authorized`);
  }
  if (
    revocation.authority_policy_version !== authorityPolicy.document.policy_version ||
    revocation.authority_policy_sha256 !== authorityPolicy.sha256
  ) {
    throw new Error(`${revocation.revocation_id}: revocation authority policy identity mismatch`);
  }
  return revocation;
}

export function verifyApprovalRecordFile(path, options = {}) {
  const actualSha256 = sha256Bytes(readFileSync(path));
  if (options.expectedSha256 && options.expectedSha256 !== actualSha256) {
    throw new Error(
      `Approval record file hash mismatch (${options.expectedSha256} != ${actualSha256})`,
    );
  }
  const record = validateApprovalRecord(loadJson(path), options);
  if (actualSha256 !== canonicalSha256(record)) {
    throw new Error(`Approval record is not canonical json-utf8-lf-v1 (${actualSha256})`);
  }
  return { record, sha256: actualSha256 };
}

export function verifyRevocationRecordFile(path, options = {}) {
  const actualSha256 = sha256Bytes(readFileSync(path));
  if (options.expectedSha256 && options.expectedSha256 !== actualSha256) {
    throw new Error(
      `Revocation record file hash mismatch (${options.expectedSha256} != ${actualSha256})`,
    );
  }
  const revocation = validateRevocationRecord(loadJson(path), options);
  if (actualSha256 !== canonicalSha256(revocation)) {
    throw new Error(`Revocation record is not canonical json-utf8-lf-v1 (${actualSha256})`);
  }
  return { revocation, sha256: actualSha256 };
}

export function assertScopeAllowed(approvalScope, requestedScope) {
  if (approvalScope !== requestedScope) {
    throw new Error(`approval scope ${approvalScope} cannot authorize ${requestedScope}`);
  }
}

function isExpired(record, now) {
  return (
    record.expires_at !== null && new Date(now).getTime() >= new Date(record.expires_at).getTime()
  );
}

function hasRecheckTrigger(record, triggered) {
  return record.recheck_triggers.some((trigger) => triggered.includes(trigger));
}

function isSuperseded(record, approvalSha256, approvals) {
  return approvals.some(({ record: successor }) => {
    if (successor.approval_id === record.approval_id || successor.decision !== 'APPROVED')
      return false;
    return (
      successor.supersedes?.approval_id === record.approval_id &&
      successor.supersedes.approval_sha256 === approvalSha256 &&
      new Date(successor.created_at).getTime() >= new Date(record.created_at).getTime()
    );
  });
}

export function evaluateEffectiveState(
  record,
  {
    approvalSha256,
    approvals = [{ record, sha256: approvalSha256 }],
    revocations = [],
    now = new Date().toISOString(),
    triggeredRecheckTriggers = [],
  } = {},
) {
  if (!approvalSha256 || !/^[a-f0-9]{64}$/u.test(approvalSha256)) {
    throw new Error(`${record.approval_id}: exact approval record hash is required`);
  }
  if (canonicalSha256(record) !== approvalSha256) {
    throw new Error(
      `${record.approval_id}: approval record hash does not match canonical record bytes`,
    );
  }
  for (const candidate of approvals) {
    if (!candidate.sha256 || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) {
      throw new Error(`${candidate.record.approval_id}: exact approval record hash is required`);
    }
    if (
      candidate.record.approval_id === record.approval_id &&
      subjectKey(candidate.record) !== subjectKey(record)
    ) {
      throw new Error(`${record.approval_id}: approval ID is bound to a different exact subject`);
    }
  }
  const sameSubjectApprovals = approvals.filter(
    ({ record: candidate }) =>
      candidate.decision === 'APPROVED' && subjectKey(candidate) === subjectKey(record),
  );
  const hasSupersessionRelation = sameSubjectApprovals.every(({ record: candidate }) => {
    if (candidate.approval_id === record.approval_id) return true;
    return (
      candidate.supersedes?.approval_id === record.approval_id ||
      record.supersedes?.approval_id === candidate.approval_id
    );
  });
  if (sameSubjectApprovals.length > 1 && !hasSupersessionRelation) {
    throw new Error(`${record.approval_id}: conflicting active approvals for exact subject`);
  }
  for (const revocation of revocations) {
    validateRevocationRecord(revocation);
    if (
      revocation.approval_id === record.approval_id &&
      revocation.approval_sha256 !== approvalSha256
    ) {
      throw new Error(`${record.approval_id}: revocation points to a different approval hash`);
    }
  }
  if (
    revocations.some(
      (entry) =>
        entry.approval_id === record.approval_id && entry.approval_sha256 === approvalSha256,
    )
  )
    return 'REVOKED';
  if (isSuperseded(record, approvalSha256, approvals)) return 'SUPERSEDED';
  if (record.decision !== 'APPROVED') return 'REJECTED';
  if (isExpired(record, now)) return 'EXPIRED';
  if (hasRecheckTrigger(record, triggeredRecheckTriggers)) return 'RECHECK_REQUIRED';
  return 'ACTIVE';
}

export function verifyContract() {
  for (const [name, validator] of Object.entries(validators)) {
    if (typeof validator !== 'function') throw new Error(`${name} validator unavailable`);
  }
  const policy = readApprovalPolicy();
  return {
    status: 'PASS',
    approval_schema_sha256: sha256Bytes(readFileSync(approvalSchemaPath)),
    review_snapshot_schema_sha256: sha256Bytes(readFileSync(reviewSnapshotSchemaPath)),
    revocation_schema_sha256: sha256Bytes(readFileSync(revocationSchemaPath)),
    authority_policy_schema_sha256: sha256Bytes(readFileSync(authorityPolicySchemaPath)),
    authority_policy_sha256: policy.sha256,
    approval_policy_version: policy.document.policy_version,
    canonicalization: 'json-utf8-lf-v1',
    ci_approval_issuance: 'FORBIDDEN',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'verify-contract') {
    console.error('Usage: node tools/compliance/approval-provenance.mjs verify-contract');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(verifyContract(), null, 2));
  }
}
