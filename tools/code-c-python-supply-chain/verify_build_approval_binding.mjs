import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  approvalSchemaV2Path,
  evaluateEffectiveState,
  readApprovalPolicy,
  validateReviewSnapshot,
  verifyApprovalRecordFile,
  canonicalBytes,
} from '../../tools/compliance/approval-provenance.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const INVENTORY_TYPE = 'PYTHON_ARTIFACT_INVENTORY';
const TOOLCHAIN_TYPE = 'TOOLCHAIN_EVIDENCE';

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function optionValues(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error(`missing value for --${name}`);
    }
    const value = argv[++index];
    const current = values.get(name) ?? [];
    current.push(value);
    values.set(name, current);
  }
  return values;
}

function required(values, name) {
  const entries = values.get(name) ?? [];
  if (entries.length !== 1) throw new Error(`expected exactly one --${name}`);
  return entries[0];
}

function repeated(values, name, expectedCount) {
  const entries = values.get(name) ?? [];
  if (entries.length !== expectedCount) {
    throw new Error(`expected ${expectedCount} --${name} values, got ${entries.length}`);
  }
  return entries;
}

function findSubject(subjectPaths, record) {
  const matches = subjectPaths.filter((path) => {
    const document = json(path);
    // Inventory v3 subjects expose inventory_id.  The approved Toolchain
    // subject is the immutable intake-evidence document, which intentionally
    // has no synthetic subject_id field; its exact bytes are the identity.
    return (
      document.inventory_id === record.subject_id ||
      document.subject_id === record.subject_id ||
      sha256File(path) === record.subject_sha256
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      `${record.approval_id}: expected one exact subject file, got ${matches.length}`,
    );
  }
  return matches[0];
}

function findTarget(targetPaths, record) {
  const matches = targetPaths.filter(
    (path) =>
      json(path).target_descriptor_id === record.target_descriptor_id ||
      sha256File(path) === record.target_descriptor_sha256,
  );
  if (matches.length !== 1) {
    throw new Error(
      `${record.approval_id}: expected one exact target descriptor, got ${matches.length}`,
    );
  }
  return matches[0];
}

function run() {
  const values = optionValues(process.argv);
  const codeHead = required(values, 'code-c-head');
  const baseline = required(values, 'main-quality-baseline');
  const snapshotPath = required(values, 'review-snapshot');
  const contractPath = required(values, 'approval-contract');
  const authorityPath = required(values, 'authority-policy');
  const outputPath = required(values, 'output');
  const subjectPaths = repeated(values, 'subject', 6);
  const targetPaths = repeated(values, 'target-descriptor', 2);
  const approvalPaths = repeated(values, 'approval-record', 6);

  if (!/^[a-f0-9]{40}$/u.test(codeHead) || !/^[a-f0-9]{40}$/u.test(baseline)) {
    throw new Error('Code C head and main baseline must be 40-character SHA-1 values');
  }
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (actualHead !== codeHead)
    throw new Error(`validation HEAD mismatch (${actualHead} != ${codeHead})`);
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });

  const snapshot = json(snapshotPath);
  validateReviewSnapshot(snapshot);
  const snapshotSha256 = sha256File(snapshotPath);
  if (snapshotSha256 !== '198a199992e5e5895569f063102886196ba094c8143bdfc824ef94ea4967ae78') {
    throw new Error(`unexpected review snapshot SHA-256: ${snapshotSha256}`);
  }
  const contractSha256 = sha256File(contractPath);
  if (contractSha256 !== '9c21394ab131599f1b8e9c4e2cfa01a40c79afa43a54d107eacef36ad2db5a56') {
    throw new Error(`unexpected approval contract SHA-256: ${contractSha256}`);
  }
  if (resolve(contractPath) !== resolve(approvalSchemaV2Path)) {
    throw new Error('build binding must use the repository Approval Provenance v2 contract');
  }
  const authority = readApprovalPolicy(authorityPath);
  const approvals = [];
  const seenSubjectIds = new Set();
  const allSubjectPaths = subjectPaths;
  for (const approvalPath of approvalPaths) {
    const verified = verifyApprovalRecordFile(approvalPath, {
      reviewSnapshotPath: snapshotPath,
      authorityPolicy: authority,
      approvalContractSha256: contractSha256,
      subjectPath: findSubject(allSubjectPaths, json(approvalPath)),
      targetDescriptorPath: findTarget(targetPaths, json(approvalPath)),
    });
    const subjectPath = findSubject(allSubjectPaths, verified.record);
    const targetPath = findTarget(targetPaths, verified.record);
    if (seenSubjectIds.has(verified.record.subject_id)) {
      throw new Error(`duplicate approved subject: ${verified.record.subject_id}`);
    }
    seenSubjectIds.add(verified.record.subject_id);
    approvals.push({
      approval_id: verified.record.approval_id,
      approval_sha256: verified.sha256,
      subject_id: verified.record.subject_id,
      subject_type: verified.record.subject_type,
      subject_role: verified.record.subject_role,
      subject_sha256: verified.record.subject_sha256,
      subject_schema_id: verified.record.subject_schema_id,
      subject_schema_version: verified.record.subject_schema_version,
      subject_schema_sha256: verified.record.subject_schema_sha256,
      subject_path: subjectPath,
      target_descriptor_id: verified.record.target_descriptor_id,
      target_descriptor_sha256: verified.record.target_descriptor_sha256,
      target_descriptor_path: targetPath,
      state: evaluateEffectiveState(verified.record, {
        approvalSha256: verified.sha256,
        approvals: [],
        now: new Date().toISOString(),
      }),
    });
  }

  const verifiedRecords = approvalPaths.map((path) =>
    verifyApprovalRecordFile(path, {
      reviewSnapshotPath: snapshotPath,
      authorityPolicy: authority,
      approvalContractSha256: contractSha256,
      subjectPath: findSubject(allSubjectPaths, json(path)),
      targetDescriptorPath: findTarget(targetPaths, json(path)),
    }),
  );
  const effectiveStates = verifiedRecords.map((entry) =>
    evaluateEffectiveState(entry.record, {
      approvalSha256: entry.sha256,
      approvals: verifiedRecords,
      now: new Date().toISOString(),
    }),
  );
  if (effectiveStates.some((state) => state !== 'ACTIVE')) {
    throw new Error(`approval effective state is not ACTIVE: ${effectiveStates.join(', ')}`);
  }
  const inventory = approvals.filter((entry) => entry.subject_type === INVENTORY_TYPE);
  const toolchain = approvals.filter((entry) => entry.subject_type === TOOLCHAIN_TYPE);
  if (inventory.length !== 4 || toolchain.length !== 2) {
    throw new Error(
      `expected 4 inventory and 2 toolchain approvals, got ${inventory.length}/${toolchain.length}`,
    );
  }
  const mismatches = {
    sha: 0,
    schema: 0,
    target: 0,
    scope: 0,
    snapshot: 0,
    authority: 0,
    revocation: 0,
    expiry: 0,
    conflict: 0,
  };
  const document = {
    schema_version: '1',
    status: 'PASS',
    binding_kind: 'CODE_C_BUILD_TIME_APPROVAL_BINDING',
    code_c_head_sha: codeHead,
    main_quality_baseline: baseline,
    review_snapshot: {
      snapshot_id: snapshot.snapshot_id,
      path: snapshotPath,
      sha256: snapshotSha256,
    },
    approval_contract: { path: contractPath, sha256: contractSha256, version: '2' },
    authority_policy: {
      path: authorityPath,
      sha256: authority.sha256,
      version: authority.document.policy_version,
    },
    counts: {
      inventory_subjects: inventory.length,
      active_inventory_approvals: inventory.length,
      toolchain_subjects: toolchain.length,
      active_toolchain_approvals: toolchain.length,
    },
    mismatch_counts: mismatches,
    approvals,
  };
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, canonicalBytes(document));
  console.log(
    `build-approval-binding: PASS (${inventory.length} inventory + ${toolchain.length} toolchain approvals; snapshot=${snapshotSha256})`,
  );
}

try {
  run();
} catch (error) {
  console.error(
    `build-approval-binding: FAIL: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
