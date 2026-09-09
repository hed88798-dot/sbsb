import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalSchemaV2Path,
  canonicalBytes,
  readApprovalPolicy,
} from '../compliance/approval-provenance.mjs';
import { resolveActiveApprovedSubjects } from './approved-subject-resolver.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const reviewSnapshotPath = resolve(
  repositoryRoot,
  'compliance/approval/review-snapshot-v2/review-snapshot-code-c-python-inventory-v3-v2-20260901.json',
);
const authorityPolicyPath = resolve(repositoryRoot, 'compliance/approval/authority-policy-v1.json');
const subjectDefinitions = Object.freeze([
  {
    path: 'compliance/python-artifacts/linux/runtime.v3.json',
    sha256: 'b6397a493afb9c555dde18a5c44947aee88692cf837f84f226bb9cdab451e9f2',
    approval: 'compliance/approval/records/approval-code-c-linux-runtime-py31315.json',
  },
  {
    path: 'compliance/python-artifacts/linux/worker-build.v3.json',
    sha256: 'de1538e8753bbee056f238f6483d3f9d080eb018ec74b5f5926a58a078fcf56c',
    approval: 'compliance/approval/records/approval-code-c-linux-worker-build-py31315.json',
  },
  {
    path: 'compliance/python-artifacts/windows/runtime.v3.json',
    sha256: '5d7cd9e0e93af5606f33af97d54588f1fdfb9949089c658e62ad5b185f0cce8a',
    approval: 'compliance/approval/records/approval-code-c-windows-runtime-py31315.json',
  },
  {
    path: 'compliance/python-artifacts/windows/worker-build.v3.json',
    sha256: 'c7ed5092c627fdbad3d28c7cd85246a03c1cacbbb65664c377fce94d23de7cc7',
    approval: 'compliance/approval/records/approval-code-c-windows-worker-build-py31315.json',
  },
  {
    path: 'compliance/python-toolchain/linux.v1.json',
    sha256: '4e6a5e8a7b5ef245124ff188f8c2a74cba61a4ce37cfc8e4b2a6079f6fd4f95f',
    approval: 'compliance/approval/records/approval-code-c-linux-toolchain-intake-evidence.json',
  },
  {
    path: 'compliance/python-toolchain/windows.v1.json',
    sha256: 'f19a6ef7a06bcfe2f804afb0f61c2f04fa4bc8638d5af61e8262f8e7c4fa5f88',
    approval: 'compliance/approval/records/approval-code-c-windows-toolchain-intake-evidence.json',
  },
]);
const approvalSha256 = Object.freeze({
  'approval-code-c-linux-runtime-py31315.json':
    'af829ef0232f25c3e4130ae8384fe819a1d64e2458278a1da51460f7a5029d67',
  'approval-code-c-linux-worker-build-py31315.json':
    '2a768d3ecd93a5321558d1bcfcc9b6ab709adad308c9b247b021e0be19dffa79',
  'approval-code-c-windows-runtime-py31315.json':
    'd79169914111f50d439d1aa326bdea2c6af6964fe6519e693c076f72a99f76e8',
  'approval-code-c-windows-worker-build-py31315.json':
    '2ad1ba91864c094756f229c70400f316a120cc246de3855734e2226c07096563',
  'approval-code-c-linux-toolchain-intake-evidence.json':
    'cd7a10b79446af8b082767ac4c1d968022424e8b0712b330a921cf376a907c66',
  'approval-code-c-windows-toolchain-intake-evidence.json':
    '1941af69b1a92c051a8589df432ea2b11ba23552cc64055102cc6131b8c68e7c',
});
const expectedSnapshotSha256 = '198a199992e5e5895569f063102886196ba094c8143bdfc824ef94ea4967ae78';
const expectedApprovalContractSha256 =
  '9c21394ab131599f1b8e9c4e2cfa01a40c79afa43a54d107eacef36ad2db5a56';

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseOutput() {
  const index = process.argv.indexOf('--output');
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : null;
}

function canonicalTargetDescriptor(subjectPath) {
  const subject = JSON.parse(readFileSync(subjectPath, 'utf8'));
  if (!subject.target || typeof subject.target !== 'object' || Array.isArray(subject.target)) {
    throw new Error(`${subjectPath}: Inventory v3 target descriptor is missing`);
  }
  return subject.target;
}

function main() {
  const subjectPaths = subjectDefinitions.map((entry) => {
    const path = resolve(repositoryRoot, entry.path);
    const actual = sha256File(path);
    if (actual !== entry.sha256) {
      throw new Error(`${entry.path}: exact approved subject hash mismatch (${actual})`);
    }
    return path;
  });
  const approvalPaths = subjectDefinitions.map((entry) => {
    const path = resolve(repositoryRoot, entry.approval);
    const expected = approvalSha256[entry.approval.split('/').at(-1)];
    const actual = sha256File(path);
    if (actual !== expected) {
      throw new Error(`${entry.approval}: exact approval bytes changed (${actual})`);
    }
    return path;
  });
  const snapshotSha256 = sha256File(reviewSnapshotPath);
  if (snapshotSha256 !== expectedSnapshotSha256) {
    throw new Error(`review snapshot bytes changed (${snapshotSha256})`);
  }
  const approvalContractSha256 = sha256File(approvalSchemaV2Path);
  if (approvalContractSha256 !== expectedApprovalContractSha256) {
    throw new Error(`Approval Provenance v2 contract bytes changed (${approvalContractSha256})`);
  }

  // The approved target descriptor is the exact canonical `target` member of
  // its approved Inventory v3 subject.  Materialize it only in a temporary
  // runner directory so the verifier can hash-bind the approval's target
  // descriptor without publishing a second, independently editable copy.
  const temporaryParent = resolve(repositoryRoot, 'artifacts');
  mkdirSync(temporaryParent, { recursive: true });
  const temporaryRoot = mkdtempSync(join(temporaryParent, 'approved-subjects-'));
  try {
    const targetPaths = ['linux', 'windows'].map((target) => {
      const inventoryPath = resolve(
        repositoryRoot,
        `compliance/python-artifacts/${target}/runtime.v3.json`,
      );
      const path = join(temporaryRoot, `${target}-target-descriptor.json`);
      writeFileSync(path, canonicalBytes(canonicalTargetDescriptor(inventoryPath)));
      return path;
    });
    const authority = readApprovalPolicy(authorityPolicyPath);
    const resolved = resolveActiveApprovedSubjects({
      approvalPaths,
      subjectPaths,
      targetDescriptorPaths: targetPaths,
      reviewSnapshotPath,
      approvalContractPath: approvalSchemaV2Path,
      authorityPolicyPath,
    });
    const expectedSubjects = subjectDefinitions.map((entry) => entry.sha256).sort();
    const resolvedSubjects = resolved.all.map((entry) => entry.subject_sha256).sort();
    if (JSON.stringify(expectedSubjects) !== JSON.stringify(resolvedSubjects)) {
      throw new Error('resolved active approvals do not cover the exact approved subject set');
    }
    const output = {
      schema_version: '1',
      status: 'PASS',
      evidence_type: 'APPROVED_SUBJECT_PROVENANCE_BINDING',
      scope: 'C_D_ACCEPTED_BASELINE_INTEGRATION_CI_RECONCILIATION',
      subject_binding: {
        model: resolved.current_inventory_discovery_model,
        inventory_v3: resolved.inventory.map((entry) => ({
          path: entry.subject_path.replace(`${repositoryRoot}/`, ''),
          subject_id: entry.record.subject_id,
          subject_sha256: entry.subject_sha256,
          approval_id: entry.record.approval_id,
          approval_sha256: entry.approval_sha256,
        })),
        toolchain_intake_v1: resolved.toolchain.map((entry) => ({
          path: entry.subject_path.replace(`${repositoryRoot}/`, ''),
          subject_id: entry.record.subject_id,
          subject_sha256: entry.subject_sha256,
          approval_id: entry.record.approval_id,
          approval_sha256: entry.approval_sha256,
        })),
        subject_set_sha256: resolved.subject_set_sha256,
      },
      authority: {
        approval_contract_sha256: approvalContractSha256,
        authority_policy_sha256: authority.sha256,
        review_snapshot_sha256: snapshotSha256,
      },
      non_asserted_scopes: {
        license: 'NOT_ASSERTED',
        vulnerability: 'NOT_ASSERTED',
        native: 'NOT_ASSERTED',
        distribution: 'NOT_ASSERTED',
      },
    };
    const outputPath = parseOutput();
    if (outputPath) {
      writeFileSync(outputPath, canonicalBytes(output));
    }
    console.log(
      `approved-subject-binding: PASS (4 Inventory v3 + 2 Toolchain intake subjects; ${resolved.subject_set_sha256})`,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`approved-subject-binding: FAIL\n${error.message}`);
  process.exitCode = 1;
}
