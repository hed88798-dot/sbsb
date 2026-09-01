import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  approvalSchemaV2Path,
  canonicalSha256,
  evaluateEffectiveState,
  getTrustedSubjectSchemaIdentity,
  readApprovalPolicy,
  trustedSubjectSchemaBindings,
  verifyRevocationRecordFile,
  verifyApprovalRecordFile,
} from '../compliance/approval-provenance.mjs';

export const INVENTORY_SUBJECT_TYPE = 'PYTHON_ARTIFACT_INVENTORY';
export const TOOLCHAIN_SUBJECT_TYPE = 'TOOLCHAIN_EVIDENCE';
export const INVENTORY_SCHEMA_VERSION = '3';
export const TOOLCHAIN_SCHEMA_VERSION = '1';
export const REQUIRED_INVENTORY_SLOTS = Object.freeze([
  'linux/runtime',
  'linux/worker-build',
  'windows/runtime',
  'windows/worker-build',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function exactPathByHash(paths, expected, label) {
  const matches = paths.filter((path) => sha256File(path) === expected);
  if (matches.length !== 1) {
    throw new Error(
      `${label}: expected one exact subject file for ${expected}, got ${matches.length}`,
    );
  }
  return matches[0];
}

function compileSubjectSchema(subjectType, version) {
  const binding = trustedSubjectSchemaBindings[subjectType]?.[version];
  if (!binding) throw new Error(`unsupported ${subjectType} subject schema ${version}`);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(binding.path, 'utf8')));
}

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

function validateExactSubject(record, subjectPath, targetDescriptorPath) {
  const subject = readJson(subjectPath);
  const version = String(record.subject_schema_version);
  const identity = getTrustedSubjectSchemaIdentity(record.subject_type, version);
  if (
    record.subject_schema_id !== identity.schema_id ||
    record.subject_schema_version !== identity.schema_version ||
    record.subject_schema_sha256 !== identity.schema_sha256
  ) {
    throw new Error(`${record.approval_id}: exact subject schema identity mismatch`);
  }
  const target = readJson(targetDescriptorPath);
  if (record.subject_type === INVENTORY_SUBJECT_TYPE) {
    const validator = compileSubjectSchema(record.subject_type, version);
    if (!validator(subject)) {
      throw new Error(`${record.approval_id}: subject schema invalid: ${schemaErrors(validator)}`);
    }
    if (target.os !== subject.target?.os) {
      throw new Error(`${record.approval_id}: subject target does not match target descriptor`);
    }
    if (subject.inventory_id !== record.subject_id) {
      throw new Error(`${record.approval_id}: inventory subject_id does not match subject bytes`);
    }
    const expectedRole =
      subject.scope === 'PRODUCTION_WORKER_RUNTIME'
        ? 'RUNTIME'
        : subject.scope === 'WORKER_BUILD'
          ? 'WORKER_BUILD'
          : null;
    if (expectedRole !== record.subject_role) {
      throw new Error(`${record.approval_id}: inventory subject role does not match scope`);
    }
    return { subject, target, schema_identity: identity };
  }
  if (record.subject_type === TOOLCHAIN_SUBJECT_TYPE) {
    // Toolchain intake evidence is an approved v1 subject, but its historical
    // intake shape predates the formal toolchain inventory document.  Its
    // immutable schema identity and bytes are verified by Approval v2; retain
    // the existing intake fields here instead of reinterpreting them as an
    // Inventory v3 graph.
    if (
      subject.schema_version !== TOOLCHAIN_SCHEMA_VERSION ||
      record.subject_role !== 'TOOLCHAIN' ||
      subject.target !== target.os
    ) {
      throw new Error(`${record.approval_id}: toolchain subject role/target mismatch`);
    }
    return { subject, target, schema_identity: identity };
  }
  throw new Error(`${record.approval_id}: unsupported current subject type`);
}

function inventorySlot(entry) {
  const role = entry.record.subject_role === 'RUNTIME' ? 'runtime' : 'worker-build';
  return `${entry.target.os}/${role}`;
}

function currentSchemaDisposition(record) {
  if (record.subject_type === INVENTORY_SUBJECT_TYPE) {
    const version = String(record.subject_schema_version);
    if (version === '2' || version === '1') return 'HISTORICAL_V2';
    if (version !== INVENTORY_SCHEMA_VERSION) return 'UNSUPPORTED';
    return 'CURRENT';
  }
  if (record.subject_type === TOOLCHAIN_SUBJECT_TYPE) {
    return String(record.subject_schema_version) === TOOLCHAIN_SCHEMA_VERSION
      ? 'CURRENT'
      : 'UNSUPPORTED';
  }
  return 'UNSUPPORTED';
}

/**
 * Resolve the current License Target subject set from exact active approvals.
 * Paths are only candidate locations; immutable subject and approval bytes are
 * authoritative. Historical v2 inventory approvals are deliberately ignored.
 */
export function resolveActiveApprovedSubjects({
  approvalPaths,
  subjectPaths,
  targetDescriptorPaths,
  reviewSnapshotPath,
  approvalContractPath = approvalSchemaV2Path,
  authorityPolicyPath,
  revocationPaths = [],
  now = new Date().toISOString(),
}) {
  if (!Array.isArray(approvalPaths) || approvalPaths.length < 6) {
    throw new Error(
      'current License Target requires approval records for 4 inventories and 2 toolchains',
    );
  }
  if (!Array.isArray(subjectPaths) || subjectPaths.length === 0) {
    throw new Error('current License Target requires exact subject candidates');
  }
  if (!Array.isArray(targetDescriptorPaths) || targetDescriptorPaths.length === 0) {
    throw new Error('current License Target requires exact target descriptor candidates');
  }
  if (resolve(approvalContractPath) !== resolve(approvalSchemaV2Path)) {
    throw new Error('current License Target must use the shared Approval Provenance v2 contract');
  }
  const contractSha256 = sha256File(approvalContractPath);
  const authority = readApprovalPolicy(authorityPolicyPath);
  const revocations = revocationPaths.map(
    (path) => verifyRevocationRecordFile(path, { authorityPolicy: authority }).revocation,
  );
  const records = approvalPaths.map((path) => ({
    path,
    raw: readJson(path),
    sha256: sha256File(path),
  }));
  const currentRecords = [];
  let historicalV2Ignored = 0;
  for (const entry of records) {
    const disposition = currentSchemaDisposition(entry.raw);
    if (disposition === 'HISTORICAL_V2') {
      historicalV2Ignored += 1;
      continue;
    }
    if (disposition === 'UNSUPPORTED') {
      throw new Error(
        `${entry.path}: unsupported current subject schema ${entry.raw.subject_type}/${entry.raw.subject_schema_version}`,
      );
    }
    currentRecords.push(entry);
  }
  const verified = currentRecords.map((entry) => {
    const subjectPath = exactPathByHash(
      subjectPaths,
      entry.raw.subject_sha256,
      entry.raw.approval_id,
    );
    const targetDescriptorPath = exactPathByHash(
      targetDescriptorPaths,
      entry.raw.target_descriptor_sha256,
      `${entry.raw.approval_id}: target descriptor`,
    );
    const approval = verifyApprovalRecordFile(entry.path, {
      reviewSnapshotPath,
      authorityPolicy: authority,
      approvalContractSha256: contractSha256,
      subjectPath,
      targetDescriptorPath,
    });
    const exact = validateExactSubject(approval.record, subjectPath, targetDescriptorPath);
    return {
      record: approval.record,
      approval_sha256: approval.sha256,
      approval_path: entry.path,
      subject_path: subjectPath,
      subject_sha256: entry.raw.subject_sha256,
      target_descriptor_path: targetDescriptorPath,
      target_descriptor_sha256: entry.raw.target_descriptor_sha256,
      target: exact.target,
      subject: exact.subject,
      schema_identity: exact.schema_identity,
    };
  });
  const states = verified.map((entry) =>
    evaluateEffectiveState(entry.record, {
      approvalSha256: entry.approval_sha256,
      approvals: verified.map((candidate) => ({
        record: candidate.record,
        sha256: candidate.approval_sha256,
      })),
      revocations,
      now,
    }),
  );
  if (states.some((state) => state !== 'ACTIVE')) {
    throw new Error(`current License Target approval is not ACTIVE: ${states.join(', ')}`);
  }
  for (const [index, entry] of verified.entries()) entry.effective_state = states[index];
  const inventory = verified.filter(
    (entry) => entry.record.subject_type === INVENTORY_SUBJECT_TYPE,
  );
  const toolchain = verified.filter(
    (entry) => entry.record.subject_type === TOOLCHAIN_SUBJECT_TYPE,
  );
  if (inventory.length !== 4 || toolchain.length !== 2) {
    throw new Error(
      `expected 4 current inventory and 2 toolchain approvals, got ${inventory.length}/${toolchain.length}`,
    );
  }
  const slotCounts = new Map();
  for (const entry of inventory)
    slotCounts.set(inventorySlot(entry), (slotCounts.get(inventorySlot(entry)) ?? 0) + 1);
  const missingSlots = REQUIRED_INVENTORY_SLOTS.filter((slot) => !slotCounts.has(slot));
  const duplicateSlots = [...slotCounts.entries()].filter(([, count]) => count !== 1);
  if (missingSlots.length > 0 || duplicateSlots.length > 0) {
    throw new Error(
      `current inventory slot coverage invalid (missing=${missingSlots.join(',') || 'none'}; duplicates=${JSON.stringify(duplicateSlots)})`,
    );
  }
  const targetSet = new Set(inventory.map((entry) => entry.target.os));
  if (!targetSet.has('linux') || !targetSet.has('windows')) {
    throw new Error('current inventory approvals do not cover both target platforms');
  }
  const subjectSet = {
    inventories: inventory
      .map((entry) => ({
        slot: inventorySlot(entry),
        subject_id: entry.record.subject_id,
        subject_sha256: entry.subject_sha256,
        subject_schema_id: entry.record.subject_schema_id,
        subject_schema_version: entry.record.subject_schema_version,
        subject_schema_sha256: entry.record.subject_schema_sha256,
        subject_type: entry.record.subject_type,
        subject_role: entry.record.subject_role,
        target_descriptor_id: entry.record.target_descriptor_id,
        target_descriptor_sha256: entry.target_descriptor_sha256,
        approval_id: entry.record.approval_id,
        approval_sha256: entry.approval_sha256,
      }))
      .sort((left, right) => left.slot.localeCompare(right.slot)),
    toolchains: toolchain
      .map((entry) => ({
        target: entry.target.os,
        subject_id: entry.record.subject_id,
        subject_sha256: entry.subject_sha256,
        subject_schema_id: entry.record.subject_schema_id,
        subject_schema_version: entry.record.subject_schema_version,
        subject_schema_sha256: entry.record.subject_schema_sha256,
        subject_type: entry.record.subject_type,
        subject_role: entry.record.subject_role,
        target_descriptor_id: entry.record.target_descriptor_id,
        target_descriptor_sha256: entry.target_descriptor_sha256,
        approval_id: entry.record.approval_id,
        approval_sha256: entry.approval_sha256,
      }))
      .sort((left, right) => left.target.localeCompare(right.target)),
  };
  return {
    status: 'PASS',
    current_inventory_discovery_model: 'ACTIVE_EXACT_SUBJECT_APPROVALS',
    filesystem_filename_is_subject_authority: false,
    approval_discovery_index_is_authority: false,
    license_consumer_uses_shared_approval_verifier: true,
    active_inventory_approvals: inventory.length,
    active_toolchain_provenance_approvals: toolchain.length,
    historical_v2_ignored: historicalV2Ignored,
    inventory,
    toolchain,
    all: verified,
    subject_set: subjectSet,
    subject_set_sha256: canonicalSha256(subjectSet),
    approval_contract_sha256: contractSha256,
    authority_policy_sha256: authority.sha256,
    review_snapshot_sha256: sha256File(reviewSnapshotPath),
    inventory_schema_identity: getTrustedSubjectSchemaIdentity(INVENTORY_SUBJECT_TYPE, '3'),
    toolchain_schema_identity: getTrustedSubjectSchemaIdentity(TOOLCHAIN_SUBJECT_TYPE, '1'),
  };
}

export const resolveActiveApprovedSubject = resolveActiveApprovedSubjects;
