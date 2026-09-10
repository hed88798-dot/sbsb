import type { Database } from 'better-sqlite3';
import { type TimelinePlanningRequestV1 } from '@app/contracts';
import { canonicalJson, sha256 } from '@app/domain-media-index';
import {
  computeTimelineDurationPlanHash,
  computeTimelineDurationPolicyHash,
  computeTimelinePlanningFactsHash,
  parseTimelineDurationPolicyV1,
  parseTimelinePlanningRequestV1,
  validateTimelineDurationPlanV1,
  type TimelineDurationPlanV1,
  type TimelineDurationPolicyV1,
  type TimelinePlanningFactsV1,
} from '@app/timeline';

const IDENTITY_MAX_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface TimelinePlanCommitInputV1 {
  timeline_id: string;
  expected_parent_version: number | null;
  planning_request: TimelinePlanningRequestV1;
  planning_facts: TimelinePlanningFactsV1;
  duration_policy: TimelineDurationPolicyV1;
  duration_plan: TimelineDurationPlanV1;
}

export interface TimelinePlanCommitReceiptV1 {
  schema_version: '1.0';
  timeline_id: string;
  version: number;
  parent_version: number | null;
  planning_request_id: string;
  timeline_request_hash: string;
  planning_facts_hash: string;
  policy_snapshot_hash: string;
  duration_plan_hash: string;
  committed_at: string;
  commit_receipt_hash: string;
}

export interface CommittedTimelinePlanVersionV1 {
  timeline_id: string;
  version: number;
  parent_version: number | null;
  planning_request: TimelinePlanningRequestV1;
  planning_facts: TimelinePlanningFactsV1;
  duration_policy: TimelineDurationPolicyV1;
  duration_plan: TimelineDurationPlanV1;
  commit_receipt: TimelinePlanCommitReceiptV1;
}

interface TimelinePlanRow {
  timeline_id: string;
  version: number;
  parent_version: number | null;
  planning_request_id: string;
  timeline_request_hash: string;
  shot_plan_id: string;
  shot_plan_hash: string;
  timing_snapshot_id: string;
  timing_snapshot_hash: string;
  planning_facts_hash: string;
  policy_id: string;
  policy_version: string;
  policy_snapshot_hash: string;
  duration_plan_hash: string;
  planning_request_json: string;
  planning_facts_json: string;
  duration_policy_json: string;
  duration_plan_json: string;
  commit_receipt_hash: string;
  commit_receipt_json: string;
  committed_at: string;
}

interface ValidatedArtifacts {
  planningRequest: TimelinePlanningRequestV1;
  planningFacts: TimelinePlanningFactsV1;
  durationPolicy: TimelineDurationPolicyV1;
  durationPlan: TimelineDurationPlanV1;
  planningRequestJson: string;
  planningFactsJson: string;
  durationPolicyJson: string;
  durationPlanJson: string;
}

type TimelinePlanCommitReceiptHashInput =
  | TimelinePlanCommitReceiptV1
  | Omit<TimelinePlanCommitReceiptV1, 'commit_receipt_hash'>;

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identity(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > IDENTITY_MAX_LENGTH ||
    value.trim() !== value
  ) {
    fail(code);
  }
  return value;
}

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(code);
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function parseExpectedParent(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('TIMELINE_PLAN_COMMIT_INPUT_INVALID');
  }
  return value;
}

function parseCanonicalJson(bytes: string, code: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return fail(code);
  }
  if (canonicalJson(value) !== bytes) fail(code);
  return value;
}

function parsePlanningRequest(value: unknown): TimelinePlanningRequestV1 {
  try {
    return parseTimelinePlanningRequestV1(value);
  } catch (error) {
    if (error instanceof Error && error.message === 'TIMELINE_PLANNING_REQUEST_HASH_MISMATCH') {
      fail('TIMELINE_REQUEST_HASH_MISMATCH');
    }
    throw error;
  }
}

export function computeTimelinePlanCommitReceiptHash(
  value: TimelinePlanCommitReceiptHashInput,
): string {
  const preimage = Object.fromEntries(
    Object.entries(value).filter(([field]) => field !== 'commit_receipt_hash'),
  );
  return sha256(canonicalJson(preimage));
}

function parseCommitReceipt(value: unknown): TimelinePlanCommitReceiptV1 {
  if (!isRecord(value)) fail('TIMELINE_PLAN_COMMIT_RECEIPT_INVALID');
  const expectedKeys = new Set([
    'schema_version',
    'timeline_id',
    'version',
    'parent_version',
    'planning_request_id',
    'timeline_request_hash',
    'planning_facts_hash',
    'policy_snapshot_hash',
    'duration_plan_hash',
    'committed_at',
    'commit_receipt_hash',
  ]);
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key)) ||
    value.schema_version !== '1.0'
  ) {
    fail('TIMELINE_PLAN_COMMIT_RECEIPT_INVALID');
  }
  const version = positiveInteger(value.version, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID');
  const parentVersion =
    value.parent_version === null
      ? null
      : positiveInteger(value.parent_version, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID');
  if ((version === 1 && parentVersion !== null) || (version > 1 && parentVersion !== version - 1)) {
    fail('TIMELINE_PLAN_COMMIT_RECEIPT_INVALID');
  }
  const parsed: TimelinePlanCommitReceiptV1 = {
    schema_version: '1.0',
    timeline_id: identity(value.timeline_id, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
    version,
    parent_version: parentVersion,
    planning_request_id: identity(
      value.planning_request_id,
      'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID',
    ),
    timeline_request_hash: hash(
      value.timeline_request_hash,
      'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID',
    ),
    planning_facts_hash: hash(value.planning_facts_hash, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
    policy_snapshot_hash: hash(value.policy_snapshot_hash, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
    duration_plan_hash: hash(value.duration_plan_hash, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
    committed_at: identity(value.committed_at, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
    commit_receipt_hash: hash(value.commit_receipt_hash, 'TIMELINE_PLAN_COMMIT_RECEIPT_INVALID'),
  };
  if (computeTimelinePlanCommitReceiptHash(parsed) !== parsed.commit_receipt_hash) {
    fail('TIMELINE_PLAN_COMMIT_RECEIPT_HASH_MISMATCH');
  }
  return parsed;
}

function validateArtifactChain(input: {
  planning_request: unknown;
  planning_facts: unknown;
  duration_policy: unknown;
  duration_plan: unknown;
}): ValidatedArtifacts {
  const planningRequest = parsePlanningRequest(input.planning_request);
  if (!isRecord(input.planning_facts)) fail('TIMELINE_PLANNING_FACTS_INVALID');
  const planningFacts = input.planning_facts as unknown as TimelinePlanningFactsV1;
  if (
    typeof planningFacts.planning_facts_hash !== 'string' ||
    computeTimelinePlanningFactsHash(planningFacts) !== planningFacts.planning_facts_hash
  ) {
    fail('TIMELINE_PLANNING_FACTS_HASH_MISMATCH');
  }
  const durationPolicy = parseTimelineDurationPolicyV1(input.duration_policy);
  const durationPlan = validateTimelineDurationPlanV1(input.duration_plan);

  if (
    planningFacts.planning_request_id !== planningRequest.planning_request_id ||
    planningFacts.timeline_request_hash !== planningRequest.timeline_request_hash ||
    planningFacts.shot_plan_id !== planningRequest.confirmed_shot_plan.shot_plan_id ||
    planningFacts.shot_plan_hash !== planningRequest.confirmed_shot_plan.shot_plan_hash ||
    planningFacts.timing_snapshot_id !==
      planningRequest.narration_timing_snapshot.timing_snapshot_id ||
    planningFacts.timing_snapshot_hash !==
      planningRequest.narration_timing_snapshot.timing_snapshot_hash
  ) {
    fail('TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH');
  }
  if (
    planningFacts.timeline_policy_id !== planningRequest.timeline_policy_id ||
    planningFacts.timeline_policy_version !== planningRequest.timeline_policy_version ||
    planningFacts.timeline_policy_snapshot_hash !== planningRequest.timeline_policy_snapshot_hash ||
    durationPolicy.policy_id !== planningFacts.timeline_policy_id ||
    durationPolicy.policy_version !== planningFacts.timeline_policy_version ||
    durationPolicy.policy_snapshot_hash !== planningFacts.timeline_policy_snapshot_hash
  ) {
    fail('TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH');
  }
  if (
    durationPlan.planning_request_id !== planningRequest.planning_request_id ||
    durationPlan.planning_facts_hash !== planningFacts.planning_facts_hash ||
    durationPlan.policy_id !== durationPolicy.policy_id ||
    durationPlan.policy_version !== durationPolicy.policy_version ||
    durationPlan.policy_snapshot_hash !== durationPolicy.policy_snapshot_hash ||
    computeTimelineDurationPolicyHash(durationPolicy) !== durationPolicy.policy_snapshot_hash ||
    computeTimelineDurationPlanHash(durationPlan) !== durationPlan.duration_plan_hash
  ) {
    fail('TIMELINE_PLAN_IMMUTABLE_INPUT_CHAIN_MISMATCH');
  }

  return {
    planningRequest,
    planningFacts,
    durationPolicy,
    durationPlan,
    planningRequestJson: canonicalJson(planningRequest),
    planningFactsJson: canonicalJson(planningFacts),
    durationPolicyJson: canonicalJson(durationPolicy),
    durationPlanJson: canonicalJson(durationPlan),
  };
}

function assertRowMatchesArtifacts(row: TimelinePlanRow, artifacts: ValidatedArtifacts): void {
  const { planningRequest, planningFacts, durationPolicy, durationPlan } = artifacts;
  if (
    row.planning_request_id !== planningRequest.planning_request_id ||
    row.timeline_request_hash !== planningRequest.timeline_request_hash ||
    row.shot_plan_id !== planningRequest.confirmed_shot_plan.shot_plan_id ||
    row.shot_plan_hash !== planningRequest.confirmed_shot_plan.shot_plan_hash ||
    row.timing_snapshot_id !== planningRequest.narration_timing_snapshot.timing_snapshot_id ||
    row.timing_snapshot_hash !== planningRequest.narration_timing_snapshot.timing_snapshot_hash ||
    row.planning_facts_hash !== planningFacts.planning_facts_hash ||
    row.policy_id !== durationPolicy.policy_id ||
    row.policy_version !== durationPolicy.policy_version ||
    row.policy_snapshot_hash !== durationPolicy.policy_snapshot_hash ||
    row.duration_plan_hash !== durationPlan.duration_plan_hash ||
    row.planning_request_json !== artifacts.planningRequestJson ||
    row.planning_facts_json !== artifacts.planningFactsJson ||
    row.duration_policy_json !== artifacts.durationPolicyJson ||
    row.duration_plan_json !== artifacts.durationPlanJson
  ) {
    fail('TIMELINE_PLAN_STORED_INTEGRITY_MISMATCH');
  }
}

function assertReceiptMatchesRow(row: TimelinePlanRow, receipt: TimelinePlanCommitReceiptV1): void {
  if (
    receipt.timeline_id !== row.timeline_id ||
    receipt.version !== row.version ||
    receipt.parent_version !== row.parent_version ||
    receipt.planning_request_id !== row.planning_request_id ||
    receipt.timeline_request_hash !== row.timeline_request_hash ||
    receipt.planning_facts_hash !== row.planning_facts_hash ||
    receipt.policy_snapshot_hash !== row.policy_snapshot_hash ||
    receipt.duration_plan_hash !== row.duration_plan_hash ||
    receipt.committed_at !== row.committed_at ||
    receipt.commit_receipt_hash !== row.commit_receipt_hash
  ) {
    fail('TIMELINE_PLAN_STORED_INTEGRITY_MISMATCH');
  }
}

function loadCommittedRow(row: TimelinePlanRow): CommittedTimelinePlanVersionV1 {
  const planningRequest = parseCanonicalJson(
    row.planning_request_json,
    'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
  );
  const planningFacts = parseCanonicalJson(
    row.planning_facts_json,
    'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
  );
  const durationPolicy = parseCanonicalJson(
    row.duration_policy_json,
    'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
  );
  const durationPlan = parseCanonicalJson(
    row.duration_plan_json,
    'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
  );
  const receiptValue = parseCanonicalJson(
    row.commit_receipt_json,
    'TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID',
  );
  const artifacts = validateArtifactChain({
    planning_request: planningRequest,
    planning_facts: planningFacts,
    duration_policy: durationPolicy,
    duration_plan: durationPlan,
  });
  assertRowMatchesArtifacts(row, artifacts);
  const receipt = parseCommitReceipt(receiptValue);
  if (canonicalJson(receipt) !== row.commit_receipt_json) {
    fail('TIMELINE_PLAN_STORED_CANONICAL_JSON_INVALID');
  }
  assertReceiptMatchesRow(row, receipt);
  return {
    timeline_id: row.timeline_id,
    version: row.version,
    parent_version: row.parent_version,
    planning_request: artifacts.planningRequest,
    planning_facts: artifacts.planningFacts,
    duration_policy: artifacts.durationPolicy,
    duration_plan: artifacts.durationPlan,
    commit_receipt: receipt,
  };
}

function preflightInput(value: TimelinePlanCommitInputV1): {
  timelineId: string;
  expectedParentVersion: number | null;
  planningRequestId: string;
} {
  if (!isRecord(value) || !isRecord(value.planning_request)) {
    fail('TIMELINE_PLAN_COMMIT_INPUT_INVALID');
  }
  return {
    timelineId: identity(value.timeline_id, 'TIMELINE_PLAN_COMMIT_INPUT_INVALID'),
    expectedParentVersion: parseExpectedParent(value.expected_parent_version),
    planningRequestId: identity(
      value.planning_request.planning_request_id,
      'TIMELINE_PLAN_COMMIT_INPUT_INVALID',
    ),
  };
}

function exactReplayMatches(
  timelineId: string,
  row: TimelinePlanRow,
  artifacts: ValidatedArtifacts,
): boolean {
  return (
    timelineId === row.timeline_id &&
    artifacts.planningRequest.planning_request_id === row.planning_request_id &&
    artifacts.planningRequest.timeline_request_hash === row.timeline_request_hash &&
    artifacts.planningFacts.planning_facts_hash === row.planning_facts_hash &&
    artifacts.durationPolicy.policy_snapshot_hash === row.policy_snapshot_hash &&
    artifacts.durationPlan.duration_plan_hash === row.duration_plan_hash &&
    artifacts.planningRequestJson === row.planning_request_json &&
    artifacts.planningFactsJson === row.planning_facts_json &&
    artifacts.durationPolicyJson === row.duration_policy_json &&
    artifacts.durationPlanJson === row.duration_plan_json
  );
}

export class TimelinePlanRepository {
  readonly #db: Database;
  readonly #clock: () => string;

  constructor(db: Database, options: { clock?: () => string } = {}) {
    this.#db = db;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  commitVersion(input: TimelinePlanCommitInputV1): CommittedTimelinePlanVersionV1 {
    const preflight = preflightInput(input);
    const operation = this.#db.transaction(() => {
      const existingRow = this.#getRowByPlanningRequestId(preflight.planningRequestId);

      if (existingRow) {
        const existing = loadCommittedRow(existingRow);
        let incomingBytes: {
          planningRequestJson: string;
          planningFactsJson: string;
          durationPolicyJson: string;
          durationPlanJson: string;
        };
        try {
          incomingBytes = {
            planningRequestJson: canonicalJson(input.planning_request),
            planningFactsJson: canonicalJson(input.planning_facts),
            durationPolicyJson: canonicalJson(input.duration_policy),
            durationPlanJson: canonicalJson(input.duration_plan),
          };
        } catch {
          return fail('TIMELINE_PLAN_IDEMPOTENCY_CONFLICT');
        }
        if (
          preflight.timelineId !== existingRow.timeline_id ||
          incomingBytes.planningRequestJson !== existingRow.planning_request_json ||
          incomingBytes.planningFactsJson !== existingRow.planning_facts_json ||
          incomingBytes.durationPolicyJson !== existingRow.duration_policy_json ||
          incomingBytes.durationPlanJson !== existingRow.duration_plan_json
        ) {
          fail('TIMELINE_PLAN_IDEMPOTENCY_CONFLICT');
        }
        const artifacts = validateArtifactChain(input);
        if (!exactReplayMatches(preflight.timelineId, existingRow, artifacts)) {
          fail('TIMELINE_PLAN_IDEMPOTENCY_CONFLICT');
        }
        return existing;
      }

      const artifacts = validateArtifactChain(input);
      const latestRow = this.#getLatestRow(preflight.timelineId);
      if (latestRow) loadCommittedRow(latestRow);
      const latestVersion = latestRow?.version ?? null;
      if (preflight.expectedParentVersion !== latestVersion) {
        fail('TIMELINE_PLAN_VERSION_CONFLICT');
      }
      const version = latestVersion === null ? 1 : latestVersion + 1;
      const parentVersion = latestVersion;
      const committedAt = this.#clock();
      if (
        typeof committedAt !== 'string' ||
        Number.isNaN(Date.parse(committedAt)) ||
        new Date(committedAt).toISOString() !== committedAt
      ) {
        fail('TIMELINE_PLAN_COMMITTED_AT_INVALID');
      }
      const receiptPreimage: Omit<TimelinePlanCommitReceiptV1, 'commit_receipt_hash'> = {
        schema_version: '1.0',
        timeline_id: preflight.timelineId,
        version,
        parent_version: parentVersion,
        planning_request_id: artifacts.planningRequest.planning_request_id,
        timeline_request_hash: artifacts.planningRequest.timeline_request_hash,
        planning_facts_hash: artifacts.planningFacts.planning_facts_hash,
        policy_snapshot_hash: artifacts.durationPolicy.policy_snapshot_hash,
        duration_plan_hash: artifacts.durationPlan.duration_plan_hash,
        committed_at: committedAt,
      };
      const receipt: TimelinePlanCommitReceiptV1 = {
        ...receiptPreimage,
        commit_receipt_hash: computeTimelinePlanCommitReceiptHash(receiptPreimage),
      };
      const receiptJson = canonicalJson(receipt);
      const insertSql =
        'INSERT INTO timeline_plan_versions(' +
        'timeline_id, version, parent_version, planning_request_id, timeline_request_hash, ' +
        'shot_plan_id, shot_plan_hash, timing_snapshot_id, timing_snapshot_hash, ' +
        'planning_facts_hash, policy_id, policy_version, policy_snapshot_hash, ' +
        'duration_plan_hash, planning_request_json, planning_facts_json, duration_policy_json, ' +
        'duration_plan_json, commit_receipt_hash, commit_receipt_json, committed_at' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

      this.#db
        .prepare(insertSql)
        .run(
          preflight.timelineId,
          version,
          parentVersion,
          artifacts.planningRequest.planning_request_id,
          artifacts.planningRequest.timeline_request_hash,
          artifacts.planningRequest.confirmed_shot_plan.shot_plan_id,
          artifacts.planningRequest.confirmed_shot_plan.shot_plan_hash,
          artifacts.planningRequest.narration_timing_snapshot.timing_snapshot_id,
          artifacts.planningRequest.narration_timing_snapshot.timing_snapshot_hash,
          artifacts.planningFacts.planning_facts_hash,
          artifacts.durationPolicy.policy_id,
          artifacts.durationPolicy.policy_version,
          artifacts.durationPolicy.policy_snapshot_hash,
          artifacts.durationPlan.duration_plan_hash,
          artifacts.planningRequestJson,
          artifacts.planningFactsJson,
          artifacts.durationPolicyJson,
          artifacts.durationPlanJson,
          receipt.commit_receipt_hash,
          receiptJson,
          committedAt,
        );
      const committedRow = this.#getRow(preflight.timelineId, version);
      if (!committedRow) fail('TIMELINE_PLAN_COMMIT_MISSING_AFTER_INSERT');
      return loadCommittedRow(committedRow);
    });
    return operation.immediate();
  }

  getVersion(timelineId: string, version: number): CommittedTimelinePlanVersionV1 | null {
    const row = this.#getRow(
      identity(timelineId, 'TIMELINE_PLAN_READ_IDENTITY_INVALID'),
      positiveInteger(version, 'TIMELINE_PLAN_READ_IDENTITY_INVALID'),
    );
    return row ? loadCommittedRow(row) : null;
  }

  getLatest(timelineId: string): CommittedTimelinePlanVersionV1 | null {
    const row = this.#getLatestRow(identity(timelineId, 'TIMELINE_PLAN_READ_IDENTITY_INVALID'));
    return row ? loadCommittedRow(row) : null;
  }

  getByPlanningRequestId(planningRequestId: string): CommittedTimelinePlanVersionV1 | null {
    const row = this.#getRowByPlanningRequestId(
      identity(planningRequestId, 'TIMELINE_PLAN_READ_IDENTITY_INVALID'),
    );
    return row ? loadCommittedRow(row) : null;
  }

  listVersions(timelineId: string): CommittedTimelinePlanVersionV1[] {
    const rows = this.#db
      .prepare('SELECT * FROM timeline_plan_versions WHERE timeline_id = ? ORDER BY version')
      .all(identity(timelineId, 'TIMELINE_PLAN_READ_IDENTITY_INVALID')) as TimelinePlanRow[];
    return rows.map(loadCommittedRow);
  }

  #getRow(timelineId: string, version: number): TimelinePlanRow | undefined {
    return this.#db
      .prepare('SELECT * FROM timeline_plan_versions WHERE timeline_id = ? AND version = ?')
      .get(timelineId, version) as TimelinePlanRow | undefined;
  }

  #getLatestRow(timelineId: string): TimelinePlanRow | undefined {
    return this.#db
      .prepare(
        'SELECT * FROM timeline_plan_versions WHERE timeline_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(timelineId) as TimelinePlanRow | undefined;
  }

  #getRowByPlanningRequestId(planningRequestId: string): TimelinePlanRow | undefined {
    return this.#db
      .prepare('SELECT * FROM timeline_plan_versions WHERE planning_request_id = ?')
      .get(planningRequestId) as TimelinePlanRow | undefined;
  }
}
