import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalSchemaPath,
  approvalSchemaV2Path,
  assertScopeAllowed,
  assertApprovalIssuanceAllowed,
  canonicalBytes,
  evaluateEffectiveState,
  getTrustedSubjectSchemaIdentity,
  readApprovalPolicy,
  trustedSubjectSchemaBindings,
  validateApprovalRecord,
  validateRevocationRecord,
  verifyApprovalRecordFile,
  verifyContract,
  verifyRevocationRecordFile,
} from '../../tools/compliance/approval-provenance.mjs';

const temporaryDirectories: string[] = [];

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, canonicalBytes(value), 'utf8');
}

function makeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'approval-provenance-'));
  temporaryDirectories.push(directory);
  const subjectPath = join(directory, 'subject.json');
  const targetPath = join(directory, 'target.json');
  const snapshotPath = join(directory, 'snapshot.json');
  const approvalPath = join(directory, 'approval.json');
  const subject = { inventory_id: 'fixture-subject-001', schema_version: '3', fact: 'immutable' };
  const target = {
    target_descriptor_id: 'fixture-target-001',
    os: 'linux',
    architecture: 'x86_64',
  };
  writeJson(subjectPath, subject);
  writeJson(targetPath, target);
  const policy = readApprovalPolicy();
  const snapshot = {
    snapshot_id: 'snapshot-001',
    schema_version: '1',
    code_c_head_sha: 'a'.repeat(40),
    main_quality_baseline: 'b'.repeat(40),
    review_bundle_id: 'review-bundle-001',
    review_bundle_sha256: 'c'.repeat(64),
    subjects: [
      {
        subject_type: 'PYTHON_ARTIFACT_INVENTORY',
        subject_id: 'fixture-subject-001',
        subject_schema_version: '3',
        subject_sha256: sha256(readFileSync(subjectPath)),
        subject_role: 'RUNTIME',
        target_descriptor_id: 'fixture-target-001',
        target_descriptor_sha256: sha256(readFileSync(targetPath)),
        artifact_graph_digest: 'd'.repeat(64),
        dependency_graph_digest: 'e'.repeat(64),
        resolver_provenance_digest: 'f'.repeat(64),
        toolchain_evidence_sha256: '1'.repeat(64),
      },
    ],
    inventory_schema_identity: {
      schema_id:
        'https://local.app/schemas/compliance/python-artifact-inventory/v3/inventory.schema.json',
      schema_version: '3',
      schema_sha256: '2'.repeat(64),
    },
    approval_contract_version: '1',
    approval_contract_sha256: sha256(readFileSync(approvalSchemaPath)),
    authority_policy_version: policy.document.policy_version,
    authority_policy_sha256: policy.sha256,
    created_at: '2026-09-01T00:00:00Z',
    canonicalization_version: 'json-utf8-lf-v1',
  };
  writeJson(snapshotPath, snapshot);
  const approval = {
    approval_id: 'approval-001',
    schema_version: '1',
    subject_type: 'PYTHON_ARTIFACT_INVENTORY',
    subject_id: 'fixture-subject-001',
    subject_schema_version: '3',
    subject_sha256: sha256(readFileSync(subjectPath)),
    subject_role: 'RUNTIME',
    target_descriptor_id: 'fixture-target-001',
    target_descriptor_sha256: sha256(readFileSync(targetPath)),
    approval_scope: 'PYTHON_ARTIFACT_INVENTORY_PROVENANCE',
    review_evidence_snapshot_id: 'snapshot-001',
    review_evidence_snapshot_sha256: sha256(readFileSync(snapshotPath)),
    reviewer: 'Code F',
    reviewer_role: 'Quality, Release & Compliance Continuous Owner',
    reviewer_authority: 'CODE_F_QUALITY_RELEASE_COMPLIANCE_OWNER',
    authority_policy_version: policy.document.policy_version,
    authority_policy_sha256: policy.sha256,
    decision: 'APPROVED',
    decision_reason: 'Explicit Code F provenance review',
    created_at: '2026-09-01T00:01:00Z',
    expires_at: null,
    recheck_triggers: ['SUBJECT_BYTES_CHANGED', 'TARGET_DESCRIPTOR_CHANGED'],
    supersedes: null,
    canonicalization_version: 'json-utf8-lf-v1',
  };
  writeJson(approvalPath, approval);
  return { directory, subjectPath, targetPath, snapshotPath, approvalPath, approval };
}

function makeV2Fixture({
  subjectType = 'PYTHON_ARTIFACT_INVENTORY',
  subjectSchemaVersion = '3',
  subjectRole = 'RUNTIME',
  approvalScope = 'PYTHON_ARTIFACT_INVENTORY_PROVENANCE',
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'approval-provenance-v2-'));
  temporaryDirectories.push(directory);
  const subjectPath = join(directory, 'subject.json');
  const targetPath = join(directory, 'target.json');
  const snapshotPath = join(directory, 'snapshot.json');
  const approvalPath = join(directory, 'approval.json');
  const subject = {
    inventory_id: 'fixture-v2-subject-001',
    schema_version: subjectSchemaVersion,
    graph_complete: true,
    components: [{ component_id: 'component-001' }],
  };
  const target = {
    target_descriptor_id: 'fixture-v2-target-001',
    os: 'linux',
    architecture: 'x86_64',
  };
  writeJson(subjectPath, subject);
  writeJson(targetPath, target);
  const policy = readApprovalPolicy();
  const trusted = getTrustedSubjectSchemaIdentity(subjectType, subjectSchemaVersion);
  const subjectSha256 = sha256(readFileSync(subjectPath));
  const targetDescriptorSha256 = sha256(readFileSync(targetPath));
  const snapshot = {
    snapshot_id: 'snapshot-v2-001',
    schema_version: '2',
    code_c_head_sha: 'a'.repeat(40),
    main_quality_baseline: 'b'.repeat(40),
    review_bundle_id: 'review-bundle-v2-001',
    review_bundle_sha256: 'c'.repeat(64),
    subjects: [
      {
        subject_type: subjectType,
        subject_id: subject.inventory_id,
        subject_schema_id: trusted.schema_id,
        subject_schema_version: trusted.schema_version,
        subject_schema_sha256: trusted.schema_sha256,
        subject_sha256: subjectSha256,
        subject_role: subjectRole,
        target_descriptor_id: target.target_descriptor_id,
        target_descriptor_sha256: targetDescriptorSha256,
        artifact_graph_digest: 'd'.repeat(64),
        dependency_graph_digest: 'e'.repeat(64),
        resolver_provenance_digest: 'f'.repeat(64),
        toolchain_evidence_sha256: '1'.repeat(64),
      },
    ],
    approval_contract_version: '2',
    approval_contract_sha256: sha256(readFileSync(approvalSchemaV2Path)),
    authority_policy_version: policy.document.policy_version,
    authority_policy_sha256: policy.sha256,
    created_at: '2026-09-01T00:00:00Z',
    canonicalization_version: 'json-utf8-lf-v1',
  };
  writeJson(snapshotPath, snapshot);
  const approval = {
    approval_id: 'approval-v2-001',
    schema_version: '2',
    subject_type: subjectType,
    subject_id: subject.inventory_id,
    subject_schema_id: trusted.schema_id,
    subject_schema_version: trusted.schema_version,
    subject_schema_sha256: trusted.schema_sha256,
    subject_sha256: subjectSha256,
    subject_role: subjectRole,
    target_descriptor_id: target.target_descriptor_id,
    target_descriptor_sha256: targetDescriptorSha256,
    approval_scope: approvalScope,
    review_evidence_snapshot_id: snapshot.snapshot_id,
    review_evidence_snapshot_sha256: sha256(readFileSync(snapshotPath)),
    reviewer: 'Code F',
    reviewer_role: 'Quality, Release & Compliance Continuous Owner',
    reviewer_authority: 'CODE_F_QUALITY_RELEASE_COMPLIANCE_OWNER',
    authority_policy_version: policy.document.policy_version,
    authority_policy_sha256: policy.sha256,
    decision: 'APPROVED',
    decision_reason: 'Explicit Code F v2 provenance review',
    created_at: '2026-09-01T00:01:00Z',
    expires_at: null,
    recheck_triggers: ['SUBJECT_BYTES_CHANGED', 'SCHEMA_CHANGED'],
    supersedes: null,
    canonicalization_version: 'json-utf8-lf-v1',
  };
  writeJson(approvalPath, approval);
  return { directory, subjectPath, targetPath, snapshotPath, approvalPath, approval, trusted };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('approval provenance contract v1', () => {
  it('publishes a strict Inventory v3 schema with factual and review state separated', () => {
    const schemaPath = join(
      import.meta.dirname,
      '../../schemas/compliance/python-artifact-inventory/v3/inventory.schema.json',
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(() => ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')))).not.toThrow();
  });

  it('compiles the contract and verifies an exact subject-bound approval', () => {
    const fixture = makeFixture();
    expect(verifyContract().status).toBe('PASS');
    const result = verifyApprovalRecordFile(fixture.approvalPath, {
      subjectPath: fixture.subjectPath,
      targetDescriptorPath: fixture.targetPath,
      reviewSnapshotPath: fixture.snapshotPath,
    });
    expect(result.record.subject_sha256).toBe(sha256(readFileSync(fixture.subjectPath)));
    expect(evaluateEffectiveState(result.record, { approvalSha256: result.sha256 })).toBe('ACTIVE');
  });

  it('fails closed when the subject or approval bytes are mutated', () => {
    const fixture = makeFixture();
    const originalApprovalSha = sha256(readFileSync(fixture.approvalPath));
    writeJson(fixture.subjectPath, {
      inventory_id: 'fixture-subject-001',
      schema_version: '3',
      fact: 'changed',
    });
    expect(() =>
      verifyApprovalRecordFile(fixture.approvalPath, {
        subjectPath: fixture.subjectPath,
        targetDescriptorPath: fixture.targetPath,
        reviewSnapshotPath: fixture.snapshotPath,
      }),
    ).toThrow(/Subject hash mismatch/);
    writeFileSync(fixture.approvalPath, `${readFileSync(fixture.approvalPath, 'utf8')} `, 'utf8');
    expect(() =>
      verifyApprovalRecordFile(fixture.approvalPath, { expectedSha256: originalApprovalSha }),
    ).toThrow(/Approval record file hash mismatch/);
  });

  it('supports revocation, expiry, recheck and supersession without editing history', () => {
    const fixture = makeFixture();
    const { record, sha256: recordSha } = verifyApprovalRecordFile(fixture.approvalPath, {
      subjectPath: fixture.subjectPath,
      targetDescriptorPath: fixture.targetPath,
      reviewSnapshotPath: fixture.snapshotPath,
    });
    const policy = readApprovalPolicy();
    const revocation = {
      revocation_id: 'revocation-001',
      schema_version: '1',
      approval_id: record.approval_id,
      approval_sha256: recordSha,
      reason: 'Evidence recheck requested',
      reviewer: 'Code F',
      reviewer_role: 'Quality, Release & Compliance Continuous Owner',
      reviewer_authority: 'CODE_F_QUALITY_RELEASE_COMPLIANCE_OWNER',
      authority_policy_version: policy.document.policy_version,
      authority_policy_sha256: policy.sha256,
      created_at: '2026-09-01T01:00:00Z',
      canonicalization_version: 'json-utf8-lf-v1',
    };
    expect(validateRevocationRecord(revocation)).toEqual(revocation);
    const revocationPath = join(fixture.directory, 'revocation.json');
    writeJson(revocationPath, revocation);
    expect(verifyRevocationRecordFile(revocationPath).revocation).toEqual(revocation);
    expect(
      evaluateEffectiveState(record, { approvalSha256: recordSha, revocations: [revocation] }),
    ).toBe('REVOKED');
    const expired = { ...record, expires_at: '2026-09-01T00:00:00Z' };
    expect(
      evaluateEffectiveState(expired, {
        approvalSha256: sha256(canonicalBytes(expired)),
        now: '2026-09-01T00:00:01Z',
      }),
    ).toBe('EXPIRED');
    expect(
      evaluateEffectiveState(record, {
        approvalSha256: recordSha,
        triggeredRecheckTriggers: ['SECURITY_REVIEW_REQUIRED'],
      }),
    ).toBe('ACTIVE');
    const recheck = { ...record, recheck_triggers: ['SECURITY_REVIEW_REQUIRED'] };
    expect(
      evaluateEffectiveState(recheck, {
        approvalSha256: sha256(canonicalBytes(recheck)),
        triggeredRecheckTriggers: ['SECURITY_REVIEW_REQUIRED'],
      }),
    ).toBe('RECHECK_REQUIRED');
    const successor = {
      ...record,
      approval_id: 'approval-002',
      created_at: '2026-09-01T02:00:00Z',
      supersedes: { approval_id: record.approval_id, approval_sha256: recordSha },
    };
    expect(
      evaluateEffectiveState(record, {
        approvalSha256: recordSha,
        approvals: [
          { record, sha256: recordSha },
          { record: successor, sha256: sha256(canonicalBytes(successor)) },
        ],
      }),
    ).toBe('SUPERSEDED');
  });

  it('rejects wrong revocation hashes, conflicting approvals and scope reuse', () => {
    const fixture = makeFixture();
    const { record, sha256: recordSha } = verifyApprovalRecordFile(fixture.approvalPath, {
      subjectPath: fixture.subjectPath,
      targetDescriptorPath: fixture.targetPath,
      reviewSnapshotPath: fixture.snapshotPath,
    });
    const policy = readApprovalPolicy();
    const wrongRevocation = {
      revocation_id: 'revocation-002',
      schema_version: '1',
      approval_id: record.approval_id,
      approval_sha256: '4'.repeat(64),
      reason: 'Wrong hash',
      reviewer: 'Code F',
      reviewer_role: 'Quality, Release & Compliance Continuous Owner',
      reviewer_authority: 'CODE_F_QUALITY_RELEASE_COMPLIANCE_OWNER',
      authority_policy_version: policy.document.policy_version,
      authority_policy_sha256: policy.sha256,
      created_at: '2026-09-01T03:00:00Z',
      canonicalization_version: 'json-utf8-lf-v1',
    };
    expect(() =>
      evaluateEffectiveState(record, { approvalSha256: recordSha, revocations: [wrongRevocation] }),
    ).toThrow(/different approval hash/);
    const conflicting = { ...record, approval_id: 'approval-003' };
    expect(() =>
      evaluateEffectiveState(record, {
        approvalSha256: recordSha,
        approvals: [
          { record, sha256: recordSha },
          { record: conflicting, sha256: sha256(canonicalBytes(conflicting)) },
        ],
      }),
    ).toThrow(/conflicting active approvals/);
    const sameIdDifferentSubject = {
      ...record,
      subject_sha256: '6'.repeat(64),
    };
    expect(() =>
      evaluateEffectiveState(record, {
        approvalSha256: recordSha,
        approvals: [
          { record, sha256: recordSha },
          {
            record: sameIdDifferentSubject,
            sha256: sha256(canonicalBytes(sameIdDifferentSubject)),
          },
        ],
      }),
    ).toThrow(/different exact subject/);
    expect(() => assertScopeAllowed('TOOLCHAIN_PROVENANCE_APPROVAL', 'LICENSE_APPROVAL')).toThrow(
      /cannot authorize/,
    );
    expect(() =>
      validateApprovalRecord({ ...record, approval_scope: 'TOOLCHAIN_PROVENANCE_APPROVAL' }),
    ).toThrow(/scope does not match/);
  });
});

describe('approval provenance contract v2 subject schema binding', () => {
  it('requires exact schema identity and verifies Inventory and Toolchain subjects', () => {
    const inventory = makeV2Fixture();
    expect(verifyContract()).toMatchObject({
      status: 'PASS',
      approval_schema_version: '2',
      subject_schema_binding_model: 'SINGLE_SELF_CONTAINED_SCHEMA',
      trusted_schema_identity_source: 'SHARED_MAIN_CONTRACT',
      approval_v1_new_issuance: 'FORBIDDEN',
      approval_v1_historical_replay: 'SUPPORTED',
    });
    const result = verifyApprovalRecordFile(inventory.approvalPath, {
      subjectPath: inventory.subjectPath,
      targetDescriptorPath: inventory.targetPath,
      reviewSnapshotPath: inventory.snapshotPath,
    });
    expect(result.record.subject_schema_sha256).toBe(inventory.trusted.schema_sha256);
    expect(evaluateEffectiveState(result.record, { approvalSha256: result.sha256 })).toBe('ACTIVE');
    expect(assertApprovalIssuanceAllowed(result.record)).toBe(result.record);

    const toolchain = makeV2Fixture({
      subjectType: 'TOOLCHAIN_EVIDENCE',
      subjectSchemaVersion: '1',
      subjectRole: 'TOOLCHAIN',
      approvalScope: 'TOOLCHAIN_PROVENANCE_APPROVAL',
    });
    expect(
      verifyApprovalRecordFile(toolchain.approvalPath, {
        subjectPath: toolchain.subjectPath,
        targetDescriptorPath: toolchain.targetPath,
        reviewSnapshotPath: toolchain.snapshotPath,
      }).record.subject_schema_id,
    ).toBe(toolchain.trusted.schema_id);
  });

  it('fails closed for wrong, malformed, missing, or self-asserted schema identities', () => {
    const fixture = makeV2Fixture();
    expect(() =>
      validateApprovalRecord({ ...fixture.approval, subject_schema_sha256: 'a'.repeat(64) }),
    ).toThrow(/trusted subject schema identity mismatch/);
    const missing = { ...fixture.approval };
    delete missing.subject_schema_sha256;
    expect(() => validateApprovalRecord(missing)).toThrow(/schema invalid/);
    expect(() =>
      validateApprovalRecord({ ...fixture.approval, subject_schema_sha256: 'A'.repeat(64) }),
    ).toThrow(/schema invalid/);
    const v1 = makeFixture();
    expect(() =>
      validateApprovalRecord({ ...v1.approval, subject_schema_sha256: 'a'.repeat(64) }),
    ).toThrow(/schema invalid/);
  });

  it('rejects same-version and same-ID trusted schemas with different bytes', () => {
    const fixture = makeV2Fixture();
    const alteredSchemaPath = join(fixture.directory, 'altered-inventory.schema.json');
    const alteredBytes = `${readFileSync(trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY['3'].path, 'utf8')}\n`;
    writeFileSync(alteredSchemaPath, alteredBytes, 'utf8');
    const alteredSha256 = sha256(alteredBytes);
    const alteredBinding = {
      ...trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY['3'],
      path: alteredSchemaPath,
      sha256: alteredSha256,
    };
    const alteredBindings = {
      ...trustedSubjectSchemaBindings,
      PYTHON_ARTIFACT_INVENTORY: {
        ...trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY,
        '3': alteredBinding,
      },
    };
    expect(() =>
      verifyApprovalRecordFile(fixture.approvalPath, {
        subjectPath: fixture.subjectPath,
        targetDescriptorPath: fixture.targetPath,
        reviewSnapshotPath: fixture.snapshotPath,
        trustedSubjectSchemaBindings: alteredBindings,
      }),
    ).toThrow(/trusted subject schema identity mismatch/);
  });

  it('rejects a trusted manifest whose expected hash does not match its bytes', () => {
    const fixture = makeV2Fixture();
    const alteredSchemaPath = join(fixture.directory, 'altered-inventory.schema.json');
    writeFileSync(
      alteredSchemaPath,
      `${readFileSync(trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY['3'].path, 'utf8')}\n`,
      'utf8',
    );
    const alteredBindings = {
      ...trustedSubjectSchemaBindings,
      PYTHON_ARTIFACT_INVENTORY: {
        ...trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY,
        '3': {
          ...trustedSubjectSchemaBindings.PYTHON_ARTIFACT_INVENTORY['3'],
          path: alteredSchemaPath,
        },
      },
    };
    expect(() =>
      validateApprovalRecord(fixture.approval, {
        trustedSubjectSchemaBindings: alteredBindings,
      }),
    ).toThrow(/Trusted subject schema hash mismatch/);
  });

  it('fails closed when the subject bytes or snapshot schema identity changes', () => {
    const fixture = makeV2Fixture();
    writeJson(fixture.subjectPath, {
      inventory_id: 'fixture-v2-subject-001',
      schema_version: '3',
      graph_complete: true,
      components: [{ component_id: 'changed' }],
    });
    expect(() =>
      verifyApprovalRecordFile(fixture.approvalPath, {
        subjectPath: fixture.subjectPath,
        targetDescriptorPath: fixture.targetPath,
        reviewSnapshotPath: fixture.snapshotPath,
      }),
    ).toThrow(/Subject hash mismatch/);

    const second = makeV2Fixture();
    const snapshot = JSON.parse(readFileSync(second.snapshotPath, 'utf8'));
    snapshot.subjects[0].subject_schema_sha256 = 'a'.repeat(64);
    writeJson(second.snapshotPath, snapshot);
    expect(() =>
      verifyApprovalRecordFile(second.approvalPath, {
        subjectPath: second.subjectPath,
        targetDescriptorPath: second.targetPath,
        reviewSnapshotPath: second.snapshotPath,
      }),
    ).toThrow(/Review snapshot hash mismatch/);
  });
});
