import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson } from '../python-supply-chain/inventory.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const provenanceRootV1 = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-approval-provenance/v1',
);
const provenanceRootV2 = resolve(
  repositoryRoot,
  'schemas/compliance/artifact-approval-provenance/v2',
);

export const approvalSchemaPath = resolve(provenanceRootV1, 'approval.schema.json');
export const reviewSnapshotSchemaPath = resolve(provenanceRootV1, 'review-snapshot.schema.json');
export const approvalSchemaV2Path = resolve(provenanceRootV2, 'approval.schema.json');
export const reviewSnapshotSchemaV2Path = resolve(provenanceRootV2, 'review-snapshot.schema.json');
export const revocationSchemaPath = resolve(provenanceRootV1, 'revocation.schema.json');
export const authorityPolicySchemaPath = resolve(provenanceRootV1, 'authority-policy.schema.json');
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

/**
 * Trusted subject-schema bindings are part of the shared main contract. The
 * verifier recomputes each raw schema file hash and refuses a changed file,
 * even when a subject or approval self-asserts the changed identity.
 */
export const trustedSubjectSchemaBindings = Object.freeze({
  PYTHON_ARTIFACT_INVENTORY: Object.freeze({
    3: Object.freeze({
      schema_id:
        'https://local.app/schemas/compliance/python-artifact-inventory/v3/inventory.schema.json',
      schema_version: '3',
      path: resolve(
        repositoryRoot,
        'schemas/compliance/python-artifact-inventory/v3/inventory.schema.json',
      ),
      sha256: '7a4999d4e31c83f3691ad69be6dc49822c4d0eebd77330964401ae349ae64e0e',
      validator_id: 'AJV2020@8.18.0+ajv-formats@3.0.1',
    }),
  }),
  TOOLCHAIN_EVIDENCE: Object.freeze({
    1: Object.freeze({
      schema_id:
        'https://local.app/schemas/compliance/python-toolchain-inventory/v1/inventory.schema.json',
      schema_version: '1',
      path: resolve(
        repositoryRoot,
        'schemas/compliance/python-toolchain-inventory/v1/inventory.schema.json',
      ),
      sha256: 'b5e1035ccde3adcdffc1dbf1d73418c1585d0e292669020622b9b42acb3e9bd2',
      validator_id: 'AJV2020@8.18.0+ajv-formats@3.0.1',
    }),
  }),
});

export const subjectSchemaBindingModel = 'SINGLE_SELF_CONTAINED_SCHEMA';

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
  approvalV2: compileSchema(approvalSchemaV2Path),
  reviewSnapshotV2: compileSchema(reviewSnapshotSchemaV2Path),
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

function visitSchemaRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const entry of value) visitSchemaRefs(entry, refs);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') refs.push(entry);
      else visitSchemaRefs(entry, refs);
    }
  }
  return refs;
}

function assertSelfContainedSchema(path, document, label) {
  const externalRefs = visitSchemaRefs(document).filter((ref) => !ref.startsWith('#/'));
  if (externalRefs.length > 0) {
    throw new Error(`${label} has external schema references: ${externalRefs.join(', ')}`);
  }
  if (document.$id === undefined) throw new Error(`${label} is missing $id`);
  return path;
}

export function getTrustedSubjectSchemaIdentity(
  subjectType,
  subjectSchemaVersion,
  { bindings = trustedSubjectSchemaBindings } = {},
) {
  const binding = bindings?.[subjectType]?.[subjectSchemaVersion];
  if (!binding) {
    throw new Error(
      `No trusted subject schema binding for ${subjectType} schema ${subjectSchemaVersion}`,
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(binding.sha256)) {
    throw new Error(`Trusted subject schema binding has malformed hash for ${subjectType}`);
  }
  if (binding.schema_version !== subjectSchemaVersion) {
    throw new Error(`Trusted subject schema version mismatch for ${subjectType}`);
  }
  const bytes = readFileSync(binding.path);
  const document = loadJson(binding.path);
  assertSelfContainedSchema(binding.path, document, `${subjectType} schema`);
  if (document.$id !== binding.schema_id) {
    throw new Error(`Trusted subject schema ID mismatch (${binding.schema_id} != ${document.$id})`);
  }
  const actualSha256 = sha256Bytes(bytes);
  if (actualSha256 !== binding.sha256) {
    throw new Error(`Trusted subject schema hash mismatch (${binding.sha256} != ${actualSha256})`);
  }
  return {
    schema_id: binding.schema_id,
    schema_version: binding.schema_version,
    schema_sha256: actualSha256,
    validator_id: binding.validator_id,
    binding_model: subjectSchemaBindingModel,
  };
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
  const key = [
    record.subject_type,
    record.subject_id,
    record.subject_schema_version,
    record.subject_sha256,
    record.subject_role,
    record.target_descriptor_id,
    record.target_descriptor_sha256,
  ];
  if (record.schema_version === '2') {
    key.splice(3, 0, record.subject_schema_id, record.subject_schema_sha256);
  }
  return key.join('|');
}

function snapshotSubjectKey(subject) {
  const key = [
    subject.subject_type,
    subject.subject_id,
    subject.subject_schema_version,
    subject.subject_sha256,
    subject.subject_role,
    subject.target_descriptor_id,
    subject.target_descriptor_sha256,
  ];
  if (subject.subject_schema_id !== undefined || subject.subject_schema_sha256 !== undefined) {
    key.splice(3, 0, subject.subject_schema_id, subject.subject_schema_sha256);
  }
  return key.join('|');
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

function assertTrustedSubjectSchemaBinding(record, bindings) {
  if (record.schema_version !== '2') return undefined;
  const trusted = getTrustedSubjectSchemaIdentity(
    record.subject_type,
    record.subject_schema_version,
    { bindings },
  );
  if (
    record.subject_schema_id !== trusted.schema_id ||
    record.subject_schema_version !== trusted.schema_version ||
    record.subject_schema_sha256 !== trusted.schema_sha256
  ) {
    throw new Error(`${record.approval_id}: trusted subject schema identity mismatch`);
  }
  return trusted;
}

function assertSnapshotBinding(record, snapshot, trustedSchema) {
  const expectedContractVersion = record.schema_version;
  if (snapshot.approval_contract_version !== expectedContractVersion) {
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
  if (record.schema_version === '2') {
    if (
      match.subject_schema_id !== trustedSchema.schema_id ||
      match.subject_schema_version !== trustedSchema.schema_version ||
      match.subject_schema_sha256 !== trustedSchema.schema_sha256
    ) {
      throw new Error(`${record.approval_id}: snapshot subject schema identity mismatch`);
    }
  }
}

export function validateReviewSnapshot(snapshot) {
  const validator =
    snapshot?.schema_version === '2' ? validators.reviewSnapshotV2 : validators.reviewSnapshot;
  return assertSchema(
    snapshot,
    validator,
    `Review snapshot v${snapshot?.schema_version ?? 'unknown'}`,
  );
}

export function validateApprovalRecord(
  record,
  {
    subjectPath,
    targetDescriptorPath,
    reviewSnapshotPath,
    authorityPolicy = readApprovalPolicy(),
    approvalContractSha256,
    trustedSubjectSchemaBindings: suppliedTrustedSubjectSchemaBindings,
  } = {},
) {
  const validator = record?.schema_version === '2' ? validators.approvalV2 : validators.approval;
  const contractPath = record?.schema_version === '2' ? approvalSchemaV2Path : approvalSchemaPath;
  assertSchema(record, validator, `Approval record v${record?.schema_version ?? 'unknown'}`);
  assertScopeAndRole(record);
  assertAuthority(record, authorityPolicy);
  const trustedSchema = assertTrustedSubjectSchemaBinding(
    record,
    suppliedTrustedSubjectSchemaBindings ?? trustedSubjectSchemaBindings,
  );
  if (subjectPath) assertSha256File(subjectPath, record.subject_sha256, 'Subject');
  assertTargetBinding(record, targetDescriptorPath);
  if (reviewSnapshotPath) {
    const snapshotBytes = readFileSync(reviewSnapshotPath);
    assertSha256File(reviewSnapshotPath, record.review_evidence_snapshot_sha256, 'Review snapshot');
    const snapshot = validateReviewSnapshot(loadJson(reviewSnapshotPath));
    if (sha256Bytes(snapshotBytes) !== canonicalSha256(snapshot)) {
      throw new Error(`${record.approval_id}: review snapshot is not canonical json-utf8-lf-v1`);
    }
    assertSnapshotBinding(record, snapshot, trustedSchema);
    const expectedApprovalContractSha256 =
      approvalContractSha256 ?? sha256Bytes(readFileSync(contractPath));
    if (snapshot.approval_contract_sha256 !== expectedApprovalContractSha256) {
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

/** New issuance is v2-only; v1 remains available to verify historical records. */
export function assertApprovalIssuanceAllowed(record) {
  if (record?.schema_version !== '2') {
    throw new Error('Approval Provenance v1 is legacy verify-only; new issuance requires v2');
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
  const inventorySchema = getTrustedSubjectSchemaIdentity('PYTHON_ARTIFACT_INVENTORY', '3');
  const toolchainSchema = getTrustedSubjectSchemaIdentity('TOOLCHAIN_EVIDENCE', '1');
  return {
    status: 'PASS',
    approval_schema_version: '2',
    approval_contract_sha256: sha256Bytes(readFileSync(approvalSchemaV2Path)),
    approval_schema_sha256: sha256Bytes(readFileSync(approvalSchemaV2Path)),
    old_approval_contract_sha256: sha256Bytes(readFileSync(approvalSchemaPath)),
    approval_schema_v1_sha256: sha256Bytes(readFileSync(approvalSchemaPath)),
    approval_schema_v2_sha256: sha256Bytes(readFileSync(approvalSchemaV2Path)),
    review_snapshot_schema_sha256: sha256Bytes(readFileSync(reviewSnapshotSchemaV2Path)),
    review_snapshot_schema_v1_sha256: sha256Bytes(readFileSync(reviewSnapshotSchemaPath)),
    review_snapshot_schema_v2_sha256: sha256Bytes(readFileSync(reviewSnapshotSchemaV2Path)),
    revocation_schema_sha256: sha256Bytes(readFileSync(revocationSchemaPath)),
    authority_policy_schema_sha256: sha256Bytes(readFileSync(authorityPolicySchemaPath)),
    authority_policy_sha256: policy.sha256,
    approval_policy_version: policy.document.policy_version,
    canonicalization: 'json-utf8-lf-v1',
    ci_approval_issuance: 'FORBIDDEN',
    approval_v1_new_issuance: 'FORBIDDEN',
    approval_v1_historical_replay: 'SUPPORTED',
    revocation_schema_migration_required: 'NO',
    subject_schema_binding_model: subjectSchemaBindingModel,
    trusted_schema_identity_source: 'SHARED_MAIN_CONTRACT',
    inventory_v3_schema_sha256: inventorySchema.schema_sha256,
    toolchain_subject_schema_sha256: toolchainSchema.schema_sha256,
    trusted_subject_schemas: [inventorySchema, toolchainSchema],
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
