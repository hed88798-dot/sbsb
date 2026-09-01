import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalSchemaV2Path,
  canonicalBytes,
  getTrustedSubjectSchemaIdentity,
  readApprovalPolicy,
} from '../../tools/compliance/approval-provenance.mjs';
import { resolveActiveApprovedSubjects } from '../../tools/code-c-python-supply-chain/approved-subject-resolver.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const snapshotTemplatePath = join(
  repositoryRoot,
  'compliance/approval/review-snapshot-v2/review-snapshot-code-c-python-inventory-v3-v2-20260901.json',
);
const approvalTemplatePath = join(
  repositoryRoot,
  'compliance/approval/records/approval-code-c-linux-runtime-py31315.json',
);
const toolchainApprovalTemplatePath = join(
  repositoryRoot,
  'compliance/approval/records/approval-code-c-linux-toolchain-intake-evidence.json',
);
const temporaryDirectories: string[] = [];

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, canonicalBytes(value));
}

function makeInventory(id: string, target: 'linux' | 'windows', scope: string) {
  return {
    graph_complete: true,
    inventory_id: id,
    packages: [
      {
        artifact_path: 'example-1.0.0-py3-none-any.whl',
        artifact_type: 'wheel',
        compatibility: { matched_tags: ['py3-none-any'], status: 'COMPATIBLE' },
        dependencies: [],
        dependency_declarations: [],
        direct: true,
        filename: 'example-1.0.0-py3-none-any.whl',
        license_expression: 'MIT',
        license_files: [],
        native_artifacts: [],
        package_name: 'example',
        provenance: { download_url: 'https://files.example.test/example.whl', supplier: 'fixture' },
        purl: 'pkg:pypi/example@1.0.0',
        sha256: '1'.repeat(64),
        source: 'https://pypi.org/project/example/1.0.0/',
        source_index: 'https://pypi.org/simple',
        version: '1.0.0',
        wheel_tags: ['py3-none-any'],
      },
    ],
    schema_version: '3',
    scope,
    subject_state: 'CANDIDATE',
    target: {
      architecture: 'x86_64',
      compatibility: {
        compatibility_engine: 'pypa-packaging',
        compatibility_engine_version: '1',
        compatible_tags: ['py3-none-any'],
        compatible_tags_sha256: '2'.repeat(64),
        packaging_version: '25.0',
        tag_source: 'packaging.tags.sys_tags',
        wheel_tag_parser: 'packaging.utils.parse_wheel_filename',
        wheel_tag_parser_version: '25.0',
      },
      implementation: 'cpython',
      os: target,
      python_version: '3.13.15',
      target_descriptor_version: '1',
    },
  };
}

function makeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'code-c-approved-subjects-'));
  temporaryDirectories.push(directory);
  const policy = readApprovalPolicy();
  const snapshot = JSON.parse(readFileSync(snapshotTemplatePath, 'utf8')) as Record<
    string,
    unknown
  > & {
    subjects: Record<string, unknown>[];
    snapshot_id: string;
  };
  const inventorySchema = getTrustedSubjectSchemaIdentity('PYTHON_ARTIFACT_INVENTORY', '3');
  const toolchainSchema = getTrustedSubjectSchemaIdentity('TOOLCHAIN_EVIDENCE', '1');
  const subjects: string[] = [];
  const approvals: string[] = [];
  const targetDescriptors: string[] = [];
  const snapshotSubjects: Record<string, unknown>[] = [];
  const targetDescriptorByTarget = new Map<string, string>();
  for (const target of ['linux', 'windows'] as const) {
    const targetPath = join(directory, `target-${target}.json`);
    writeJson(targetPath, { target_descriptor_id: `fixture-target-${target}`, os: target });
    targetDescriptors.push(targetPath);
    targetDescriptorByTarget.set(target, targetPath);
  }
  const roles = [
    ['runtime', 'RUNTIME', 'PRODUCTION_WORKER_RUNTIME'],
    ['worker-build', 'WORKER_BUILD', 'WORKER_BUILD'],
  ] as const;
  for (const target of ['linux', 'windows'] as const) {
    for (const [shortRole, role, scope] of roles) {
      const id = `fixture-${target}-${shortRole}`;
      const subjectPath = join(directory, `arbitrary-name-${target}-${shortRole}.json`);
      writeJson(subjectPath, makeInventory(id, target, scope));
      subjects.push(subjectPath);
      snapshotSubjects.push({
        artifact_graph_digest: '3'.repeat(64),
        dependency_graph_digest: '4'.repeat(64),
        resolver_provenance_digest: '5'.repeat(64),
        subject_id: id,
        subject_role: role,
        subject_schema_id: inventorySchema.schema_id,
        subject_schema_sha256: inventorySchema.schema_sha256,
        subject_schema_version: '3',
        subject_sha256: sha256(readFileSync(subjectPath)),
        subject_type: 'PYTHON_ARTIFACT_INVENTORY',
        target_descriptor_id: `fixture-target-${target}`,
        target_descriptor_sha256: sha256(readFileSync(targetDescriptorByTarget.get(target)!)),
        toolchain_evidence_sha256: '6'.repeat(64),
      });
    }
    const toolchainPath = join(directory, `renamed-toolchain-${target}.json`);
    writeJson(toolchainPath, { schema_version: '1', target });
    subjects.push(toolchainPath);
    const toolchainId = `fixture-${target}-toolchain`;
    snapshotSubjects.push({
      artifact_graph_digest: '3'.repeat(64),
      dependency_graph_digest: '4'.repeat(64),
      resolver_provenance_digest: '5'.repeat(64),
      subject_id: toolchainId,
      subject_role: 'TOOLCHAIN',
      subject_schema_id: toolchainSchema.schema_id,
      subject_schema_sha256: toolchainSchema.schema_sha256,
      subject_schema_version: '1',
      subject_sha256: sha256(readFileSync(toolchainPath)),
      subject_type: 'TOOLCHAIN_EVIDENCE',
      target_descriptor_id: `fixture-target-${target}`,
      target_descriptor_sha256: sha256(readFileSync(targetDescriptorByTarget.get(target)!)),
      toolchain_evidence_sha256: '6'.repeat(64),
    });
  }
  snapshot.subjects = snapshotSubjects;
  snapshot.snapshot_id = 'fixture-current-v3-subjects';
  const snapshotPath = join(directory, 'snapshot.json');
  writeJson(snapshotPath, snapshot);
  const snapshotSha = sha256(readFileSync(snapshotPath));
  for (const subjectPath of subjects) {
    const subject = JSON.parse(readFileSync(subjectPath, 'utf8')) as Record<string, unknown>;
    const isToolchain = typeof subject.target === 'string';
    const target = isToolchain
      ? String(subject.target)
      : String((subject.target as Record<string, unknown>).os);
    const role = isToolchain
      ? 'TOOLCHAIN'
      : subject.scope === 'WORKER_BUILD'
        ? 'WORKER_BUILD'
        : 'RUNTIME';
    const subjectType = isToolchain ? 'TOOLCHAIN_EVIDENCE' : 'PYTHON_ARTIFACT_INVENTORY';
    const schema = isToolchain ? toolchainSchema : inventorySchema;
    const subjectId = isToolchain ? `fixture-${target}-toolchain` : String(subject.inventory_id);
    const template = JSON.parse(
      readFileSync(isToolchain ? toolchainApprovalTemplatePath : approvalTemplatePath, 'utf8'),
    );
    const record = {
      ...template,
      approval_id: `fixture-approval-${target}-${role.toLowerCase().replaceAll('_', '-')}`,
      subject_id: subjectId,
      subject_role: role,
      subject_type: subjectType,
      subject_schema_id: schema.schema_id,
      subject_schema_sha256: schema.schema_sha256,
      subject_schema_version: schema.schema_version,
      subject_sha256: sha256(readFileSync(subjectPath)),
      target_descriptor_id: `fixture-target-${target}`,
      target_descriptor_sha256: sha256(readFileSync(targetDescriptorByTarget.get(target)!)),
      approval_scope: isToolchain
        ? 'TOOLCHAIN_PROVENANCE_APPROVAL'
        : 'PYTHON_ARTIFACT_INVENTORY_PROVENANCE',
      review_evidence_snapshot_id: snapshot.snapshot_id,
      review_evidence_snapshot_sha256: snapshotSha,
      authority_policy_version: policy.document.policy_version,
      authority_policy_sha256: policy.sha256,
      schema_version: '2',
      decision: 'APPROVED',
      decision_reason: 'Explicit Code F current-subject regression approval',
      created_at: '2026-09-01T12:05:00Z',
      expires_at: null,
      recheck_triggers: ['SUBJECT_BYTES_CHANGED', 'SCHEMA_CHANGED'],
      supersedes: null,
      canonicalization_version: 'json-utf8-lf-v1',
      reviewer: 'Code F',
      reviewer_role: 'Quality, Release & Compliance Continuous Owner',
      reviewer_authority: 'CODE_F_QUALITY_RELEASE_COMPLIANCE_OWNER',
    };
    const approvalPath = join(directory, `${record.approval_id}.json`);
    writeJson(approvalPath, record);
    approvals.push(approvalPath);
  }
  return { directory, subjects, approvals, targetDescriptors, snapshotPath };
}

function resolveFixture(
  fixture: ReturnType<typeof makeFixture>,
  options: Record<string, unknown> = {},
) {
  return resolveActiveApprovedSubjects({
    approvalContractPath: approvalSchemaV2Path,
    approvalPaths: (options.approvalPaths as string[] | undefined) ?? fixture.approvals,
    authorityPolicyPath: join(repositoryRoot, 'compliance/approval/authority-policy-v1.json'),
    now: options.now as string | undefined,
    reviewSnapshotPath: fixture.snapshotPath,
    subjectPaths: (options.subjectPaths as string[] | undefined) ?? fixture.subjects,
    targetDescriptorPaths: fixture.targetDescriptors,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Code C current Inventory v3 License Target subject resolver', () => {
  it('resolves four active v3 inventory slots and two exact Toolchain v1 subjects', () => {
    const result = resolveFixture(makeFixture());
    expect(result.status).toBe('PASS');
    expect(result.active_inventory_approvals).toBe(4);
    expect(result.active_toolchain_provenance_approvals).toBe(2);
  });

  it('uses immutable subject bytes when filenames are arbitrary', () => {
    const result = resolveFixture(makeFixture());
    expect(result.filesystem_filename_is_subject_authority).toBe(false);
    expect(result.approval_discovery_index_is_authority).toBe(false);
  });

  it('ignores an old v2 approval for the same logical subject', () => {
    const fixture = makeFixture();
    const old = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    old.approval_id = 'fixture-old-v2-approval';
    old.subject_schema_version = '2';
    const oldPath = join(fixture.directory, 'old-v2.json');
    writeJson(oldPath, old);
    expect(
      resolveFixture(fixture, { approvalPaths: [...fixture.approvals, oldPath] })
        .historical_v2_ignored,
    ).toBe(1);
  });

  it('blocks a v3 subject SHA mismatch', () => {
    const fixture = makeFixture();
    writeJson(fixture.subjects[0], { broken: true });
    expect(() => resolveFixture(fixture)).toThrow(/expected one exact subject file/);
  });

  it('blocks a trusted v3 schema SHA mismatch', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    record.subject_schema_sha256 = 'a'.repeat(64);
    writeJson(fixture.approvals[0], record);
    expect(() => resolveFixture(fixture)).toThrow(/trusted subject schema identity mismatch/);
  });

  it('blocks a revoked approval', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    const revocation = {
      approval_id: record.approval_id,
      approval_sha256: sha256(readFileSync(fixture.approvals[0])),
      authority_policy_sha256: record.authority_policy_sha256,
      authority_policy_version: record.authority_policy_version,
      canonicalization_version: 'json-utf8-lf-v1',
      created_at: '2026-09-01T13:00:00Z',
      reason: 'Regression revocation',
      reviewer: record.reviewer,
      reviewer_authority: record.reviewer_authority,
      reviewer_role: record.reviewer_role,
      revocation_id: 'fixture-revocation-001',
      schema_version: '1',
    };
    const revocationPath = join(fixture.directory, 'revocation.json');
    writeJson(revocationPath, revocation);
    expect(() =>
      resolveActiveApprovedSubjects({
        approvalContractPath: approvalSchemaV2Path,
        approvalPaths: fixture.approvals,
        authorityPolicyPath: join(repositoryRoot, 'compliance/approval/authority-policy-v1.json'),
        revocationPaths: [revocationPath],
        reviewSnapshotPath: fixture.snapshotPath,
        subjectPaths: fixture.subjects,
        targetDescriptorPaths: fixture.targetDescriptors,
      }),
    ).toThrow(/not ACTIVE: REVOKED/);
  });

  it('blocks an expired approval at recheck time', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    record.expires_at = '2026-09-01T12:00:00Z';
    writeJson(fixture.approvals[0], record);
    expect(() => resolveFixture(fixture, { now: '2026-09-01T12:00:01Z' })).toThrow(
      /not ACTIVE: EXPIRED/,
    );
  });

  it('blocks conflicting active approvals for one exact subject', () => {
    const fixture = makeFixture();
    const duplicate = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    duplicate.approval_id = 'fixture-conflicting-approval';
    const duplicatePath = join(fixture.directory, 'conflict.json');
    writeJson(duplicatePath, duplicate);
    expect(() =>
      resolveFixture(fixture, { approvalPaths: [...fixture.approvals, duplicatePath] }),
    ).toThrow(/conflicting active approvals/);
  });

  it('blocks an unsupported future inventory schema', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    record.subject_schema_version = '4';
    const futurePath = join(fixture.directory, 'future.json');
    writeJson(futurePath, record);
    const paths = [...fixture.approvals.slice(1), futurePath];
    expect(() => resolveFixture(fixture, { approvalPaths: paths })).toThrow(
      /unsupported current subject schema/,
    );
  });

  it('keeps Toolchain v1 exact subject dispatch separate from Inventory v3', () => {
    const result = resolveFixture(makeFixture());
    expect(
      result.toolchain.every(
        (entry) =>
          (entry.record as { subject_schema_version: string }).subject_schema_version === '1',
      ),
    ).toBe(true);
    expect(
      result.inventory.every(
        (entry) =>
          (entry.record as { subject_schema_version: string }).subject_schema_version === '3',
      ),
    ).toBe(true);
  });

  it('blocks count-four coverage when a required target/role slot is missing', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    record.subject_role = 'WORKER_BUILD';
    const changedPath = join(fixture.directory, 'missing-slot.json');
    writeJson(changedPath, record);
    expect(() =>
      resolveFixture(fixture, { approvalPaths: [changedPath, ...fixture.approvals.slice(1)] }),
    ).toThrow();
  });

  it('blocks a subject left on disk without an active approval', () => {
    const fixture = makeFixture();
    expect(() => resolveFixture(fixture, { approvalPaths: fixture.approvals.slice(1) })).toThrow(
      /requires approval records/,
    );
  });

  it('blocks when an approval claims current but immutable subject lookup disagrees', () => {
    const fixture = makeFixture();
    const record = JSON.parse(readFileSync(fixture.approvals[0], 'utf8'));
    record.subject_sha256 = 'b'.repeat(64);
    const changedPath = join(fixture.directory, 'index-disagreement.json');
    writeJson(changedPath, record);
    expect(() =>
      resolveFixture(fixture, { approvalPaths: [changedPath, ...fixture.approvals.slice(1)] }),
    ).toThrow(/expected one exact subject file/);
  });
});
