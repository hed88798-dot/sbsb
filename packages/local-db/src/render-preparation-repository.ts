import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { canonicalJson, sha256 } from '@app/domain-media-index';
import {
  parseLogicalRenderPlanV1,
  parseRenderExecutionSnapshotV1,
  parseRenderReceiptV1,
  renderAcceptedTimelineRequestV1Schema,
  type LogicalRenderPlanV1,
  type RenderAcceptedTimelineRequestV1,
  type RenderExecutionSnapshotV1,
  type RenderReceiptV1,
} from '@app/render';

export type RenderPreparationStateV1 =
  | 'PREPARING'
  | 'ENTRY_VALIDATED'
  | 'SOURCES_RESOLVED'
  | 'STAGING'
  | 'READY_FOR_EXECUTION'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED';

export interface RenderPreparationRecordV1 {
  job_id: string;
  request_hash: string;
  request: RenderAcceptedTimelineRequestV1;
  logical_render_hash: string | null;
  logical_plan: LogicalRenderPlanV1 | null;
  state: RenderPreparationStateV1;
  attempt_number: number;
  current_execution_snapshot_hash: string | null;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  error_message: string | null;
}

export interface VerifiedStagedArtifactRecordV1 {
  artifact_record_id: string;
  artifact_role: 'STAGED_SOURCE' | 'STAGED_NARRATION';
  authority_sha256: string;
  artifact_sha256: string;
  size_bytes: number;
  managed_path: string;
  artifact_json: string;
}

interface RenderJobRow {
  job_id: string;
  request_hash: string;
  request_json: string;
  logical_render_hash: string | null;
  logical_plan_json: string | null;
  state: RenderPreparationStateV1;
  attempt_number: number;
  current_execution_snapshot_hash: string | null;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  error_message: string | null;
}

const activeStates: readonly RenderPreparationStateV1[] = [
  'PREPARING',
  'ENTRY_VALIDATED',
  'SOURCES_RESOLVED',
  'STAGING',
];

export class RenderPreparationRepository {
  readonly #db: Database;
  readonly #clock: () => string;
  readonly #id: () => string;

  constructor(db: Database, options: { clock?: () => string; id?: () => string } = {}) {
    this.#db = db;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#id = options.id ?? (() => randomUUID());
  }

  begin(requestValue: RenderAcceptedTimelineRequestV1): RenderPreparationRecordV1 {
    const request = renderAcceptedTimelineRequestV1Schema.parse(requestValue);
    const requestJson = canonicalJson(request);
    const requestHash = sha256(requestJson);
    const operation = this.#db.transaction(() => {
      const existing = this.#rowByRequestHash(requestHash);
      if (existing) {
        if (existing.request_json !== requestJson) {
          throw new Error('RENDER_REQUEST_HASH_COLLISION');
        }
        if (
          existing.state === 'FAILED' ||
          existing.state === 'CANCELLED' ||
          existing.state === 'INTERRUPTED'
        ) {
          const now = this.#clock();
          this.#db
            .prepare(
              `UPDATE render_jobs SET state = 'PREPARING', attempt_number = attempt_number + 1,
               current_execution_snapshot_hash = NULL, updated_at = ?, error_code = NULL,
               error_message = NULL WHERE job_id = ?`,
            )
            .run(now, existing.job_id);
          this.#db
            .prepare(
              `UPDATE jobs SET state = 'QUEUED', progress = 0, started_at = NULL, finished_at = NULL,
               error_code = NULL, error_message = NULL WHERE job_id = ?`,
            )
            .run(existing.job_id);
          return this.#requireRow(existing.job_id);
        }
        return existing;
      }
      const jobId = `render_job_${this.#id()}`;
      const now = this.#clock();
      this.#db
        .prepare(
          `INSERT INTO jobs(
            job_id, job_type, state, progress, created_at, started_at, finished_at,
            error_code, error_message, request_snapshot_hash
          ) VALUES (?, 'RENDER', 'QUEUED', 0, ?, NULL, NULL, NULL, NULL, ?)`,
        )
        .run(jobId, now, requestHash);
      this.#db
        .prepare(
          `INSERT INTO render_jobs(
            job_id, request_hash, request_json, timeline_id, timeline_version,
            timeline_commit_receipt_hash, render_policy_id, render_policy_version,
            render_policy_hash, logical_render_hash, logical_plan_json, state, attempt_number,
            current_execution_snapshot_hash, created_at, updated_at, error_code, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'PREPARING', 1, NULL, ?, ?, NULL, NULL)`,
        )
        .run(
          jobId,
          requestHash,
          requestJson,
          request.timeline_id,
          request.timeline_version,
          request.expected_timeline_commit_receipt_hash,
          request.render_policy_id,
          request.render_policy_version,
          request.render_policy_hash,
          now,
          now,
        );
      return this.#requireRow(jobId);
    });
    return this.#map(operation.immediate());
  }

  get(jobId: string): RenderPreparationRecordV1 | null {
    const row = this.#row(jobId);
    return row ? this.#map(row) : null;
  }

  require(jobId: string): RenderPreparationRecordV1 {
    const record = this.get(jobId);
    if (!record) throw new Error('RENDER_JOB_NOT_FOUND');
    return record;
  }

  markEntryValidated(jobId: string): RenderPreparationRecordV1 {
    return this.#transition(jobId, ['PREPARING'], 'ENTRY_VALIDATED');
  }

  recordLogicalPlan(jobId: string, planValue: LogicalRenderPlanV1): RenderPreparationRecordV1 {
    const plan = parseLogicalRenderPlanV1(planValue);
    const row = this.#requireRow(jobId);
    if (row.state !== 'ENTRY_VALIDATED') throw new Error('RENDER_JOB_STATE_CONFLICT');
    if (row.logical_render_hash && row.logical_render_hash !== plan.logical_render_hash) {
      throw new Error('RENDER_LOGICAL_IDEMPOTENCY_CONFLICT');
    }
    try {
      this.#db
        .prepare(
          `UPDATE render_jobs SET logical_render_hash = ?, logical_plan_json = ?,
           state = 'SOURCES_RESOLVED', updated_at = ? WHERE job_id = ? AND state = 'ENTRY_VALIDATED'`,
        )
        .run(plan.logical_render_hash, canonicalJson(plan), this.#clock(), jobId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error('RENDER_LOGICAL_IDEMPOTENCY_CONFLICT', { cause: error });
      }
      throw error;
    }
    return this.require(jobId);
  }

  markStaging(jobId: string): RenderPreparationRecordV1 {
    return this.#transition(jobId, ['SOURCES_RESOLVED'], 'STAGING');
  }

  recordReady(input: {
    job_id: string;
    snapshot: RenderExecutionSnapshotV1;
    artifacts: readonly VerifiedStagedArtifactRecordV1[];
  }): RenderPreparationRecordV1 {
    const snapshot = parseRenderExecutionSnapshotV1(input.snapshot);
    const expectedArtifacts = [
      ...snapshot.source_artifacts.map((artifact) => ({
        artifact_role: 'STAGED_SOURCE' as const,
        authority_sha256: artifact.authority_sha256,
        artifact_sha256: artifact.staged_sha256,
        size_bytes: artifact.size_bytes,
        managed_path: artifact.staged_path,
        artifact_json: canonicalJson(artifact),
      })),
      {
        artifact_role: 'STAGED_NARRATION' as const,
        authority_sha256: snapshot.narration_artifact.authority_sha256,
        artifact_sha256: snapshot.narration_artifact.staged_sha256,
        size_bytes: snapshot.narration_artifact.size_bytes,
        managed_path: snapshot.narration_artifact.staged_path,
        artifact_json: canonicalJson(snapshot.narration_artifact),
      },
    ];
    const actualArtifacts = input.artifacts.map((artifact) =>
      canonicalJson({
        artifact_role: artifact.artifact_role,
        authority_sha256: artifact.authority_sha256,
        artifact_sha256: artifact.artifact_sha256,
        size_bytes: artifact.size_bytes,
        managed_path: artifact.managed_path,
        artifact_json: artifact.artifact_json,
      }),
    );
    if (
      expectedArtifacts.length !== actualArtifacts.length ||
      expectedArtifacts.some((artifact) => !actualArtifacts.includes(canonicalJson(artifact))) ||
      new Set(actualArtifacts).size !== actualArtifacts.length
    ) {
      throw new Error('RENDER_STAGED_ARTIFACT_SNAPSHOT_BINDING_MISMATCH');
    }
    const operation = this.#db.transaction(() => {
      const row = this.#requireRow(input.job_id);
      if (
        row.state !== 'STAGING' ||
        row.logical_render_hash !== snapshot.logical_render_hash ||
        !row.logical_plan_json
      ) {
        throw new Error('RENDER_JOB_STATE_CONFLICT');
      }
      this.#db
        .prepare(
          `INSERT INTO render_execution_snapshots(
            execution_snapshot_hash, job_id, attempt_number, snapshot_json, state, created_at
          ) VALUES (?, ?, ?, ?, 'READY_FOR_EXECUTION', ?)`,
        )
        .run(
          snapshot.execution_snapshot_hash,
          row.job_id,
          row.attempt_number,
          canonicalJson(snapshot),
          this.#clock(),
        );
      const insertArtifact = this.#db.prepare(
        `INSERT INTO render_artifacts(
          artifact_record_id, job_id, attempt_number, artifact_role, authority_sha256,
          artifact_sha256, size_bytes, managed_path, state, artifact_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED_STAGED', ?, ?)`,
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(
          artifact.artifact_record_id,
          row.job_id,
          row.attempt_number,
          artifact.artifact_role,
          artifact.authority_sha256,
          artifact.artifact_sha256,
          artifact.size_bytes,
          artifact.managed_path,
          artifact.artifact_json,
          this.#clock(),
        );
      }
      const changed = this.#db
        .prepare(
          `UPDATE render_jobs SET state = 'READY_FOR_EXECUTION',
           current_execution_snapshot_hash = ?, updated_at = ?
           WHERE job_id = ? AND state = 'STAGING'`,
        )
        .run(snapshot.execution_snapshot_hash, this.#clock(), row.job_id).changes;
      if (changed !== 1) throw new Error('RENDER_JOB_STATE_CONFLICT');
      return this.#requireRow(row.job_id);
    });
    return this.#map(operation.immediate());
  }

  getReadySnapshot(jobId: string): RenderExecutionSnapshotV1 | null {
    const row = this.#requireRow(jobId);
    if (row.state !== 'READY_FOR_EXECUTION' || !row.current_execution_snapshot_hash) return null;
    const snapshotRow = this.#db
      .prepare(
        `SELECT snapshot_json FROM render_execution_snapshots
         WHERE execution_snapshot_hash = ? AND job_id = ?`,
      )
      .get(row.current_execution_snapshot_hash, jobId) as { snapshot_json: string } | undefined;
    if (!snapshotRow) throw new Error('RENDER_SNAPSHOT_STORED_INTEGRITY_MISMATCH');
    const snapshot = parseRenderExecutionSnapshotV1(
      JSON.parse(snapshotRow.snapshot_json) as unknown,
    );
    if (canonicalJson(snapshot) !== snapshotRow.snapshot_json) {
      throw new Error('RENDER_SNAPSHOT_STORED_INTEGRITY_MISMATCH');
    }
    return snapshot;
  }

  listReady(): RenderPreparationRecordV1[] {
    return (
      this.#db
        .prepare(
          "SELECT * FROM render_jobs WHERE state = 'READY_FOR_EXECUTION' ORDER BY created_at",
        )
        .all() as RenderJobRow[]
    ).map((row) => this.#map(row));
  }

  interruptReady(jobId: string, code: string, message: string): RenderPreparationRecordV1 {
    const now = this.#clock();
    const operation = this.#db.transaction(() => {
      const changed = this.#db
        .prepare(
          `UPDATE render_jobs SET state = 'INTERRUPTED', updated_at = ?, error_code = ?,
           error_message = ? WHERE job_id = ? AND state = 'READY_FOR_EXECUTION'`,
        )
        .run(now, code, message, jobId).changes;
      if (changed !== 1) throw new Error('RENDER_JOB_STATE_CONFLICT');
      this.#db
        .prepare(
          `UPDATE jobs SET state = 'INTERRUPTED', finished_at = ?, error_code = ?,
           error_message = ? WHERE job_id = ? AND state = 'QUEUED'`,
        )
        .run(now, code, message, jobId);
      return this.#requireRow(jobId);
    });
    return this.#map(operation.immediate());
  }

  fail(jobId: string, code: string, message: string): RenderPreparationRecordV1 {
    const now = this.#clock();
    const operation = this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE render_jobs SET state = 'FAILED', updated_at = ?, error_code = ?, error_message = ?
           WHERE job_id = ? AND state IN ('PREPARING', 'ENTRY_VALIDATED', 'SOURCES_RESOLVED', 'STAGING')`,
        )
        .run(now, code, message, jobId);
      this.#db
        .prepare(
          `UPDATE jobs SET state = 'FAILED', finished_at = ?, error_code = ?, error_message = ?
           WHERE job_id = ? AND state = 'QUEUED'`,
        )
        .run(now, code, message, jobId);
      return this.#requireRow(jobId);
    });
    return this.#map(operation.immediate());
  }

  recoverInterrupted(): RenderPreparationRecordV1[] {
    const placeholders = activeStates.map(() => '?').join(', ');
    const rows = this.#db
      .prepare(`SELECT * FROM render_jobs WHERE state IN (${placeholders}) ORDER BY created_at`)
      .all(...activeStates) as RenderJobRow[];
    if (rows.length === 0) return [];
    const now = this.#clock();
    const operation = this.#db.transaction(() => {
      for (const row of rows) {
        this.#db
          .prepare(
            `UPDATE render_jobs SET state = 'INTERRUPTED', updated_at = ?,
             error_code = 'APP_INTERRUPTED', error_message = 'Render preparation interrupted'
             WHERE job_id = ? AND state = ?`,
          )
          .run(now, row.job_id, row.state);
        this.#db
          .prepare(
            `UPDATE jobs SET state = 'INTERRUPTED', finished_at = ?,
             error_code = 'APP_INTERRUPTED', error_message = 'Render preparation interrupted'
             WHERE job_id = ? AND state = 'QUEUED'`,
          )
          .run(now, row.job_id);
      }
    });
    operation.immediate();
    return rows.map((row) => this.require(row.job_id));
  }

  commitReceipt(value: RenderReceiptV1): RenderReceiptV1 {
    const receipt = parseRenderReceiptV1(value);
    const bytes = canonicalJson(receipt);
    const job = this.#requireRow(receipt.job_id);
    const snapshotRow = this.#db
      .prepare(
        `SELECT snapshot_json FROM render_execution_snapshots
         WHERE execution_snapshot_hash = ? AND job_id = ?`,
      )
      .get(receipt.execution_snapshot_hash, receipt.job_id) as
      | { snapshot_json: string }
      | undefined;
    if (!snapshotRow) throw new Error('RENDER_RECEIPT_EXECUTION_SNAPSHOT_MISMATCH');
    const snapshot = parseRenderExecutionSnapshotV1(
      JSON.parse(snapshotRow.snapshot_json) as unknown,
    );
    const request = renderAcceptedTimelineRequestV1Schema.parse(
      JSON.parse(job.request_json) as unknown,
    );
    if (
      job.logical_render_hash !== receipt.logical_render_hash ||
      snapshot.logical_render_hash !== receipt.logical_render_hash ||
      request.timeline_id !== receipt.timeline_id ||
      request.timeline_version !== receipt.timeline_version ||
      request.expected_timeline_commit_receipt_hash !== receipt.timeline_commit_receipt_hash ||
      request.render_policy_id !== receipt.render_policy_id ||
      request.render_policy_version !== receipt.render_policy_version ||
      request.render_policy_hash !== receipt.render_policy_hash ||
      snapshot.runtime_identity.runtime_id !== receipt.runtime_id ||
      snapshot.runtime_identity.companion_manifest_sha256 !== receipt.runtime_manifest_sha256
    ) {
      throw new Error('RENDER_RECEIPT_AUTHORITY_BINDING_MISMATCH');
    }
    const existing = this.#db
      .prepare('SELECT receipt_json FROM render_receipts WHERE receipt_id = ?')
      .get(receipt.receipt_id) as { receipt_json: string } | undefined;
    if (existing) {
      if (existing.receipt_json !== bytes) throw new Error('RENDER_RECEIPT_IDENTITY_CONFLICT');
      return parseRenderReceiptV1(JSON.parse(existing.receipt_json) as unknown);
    }
    this.#db
      .prepare(
        `INSERT INTO render_receipts(
          receipt_id, job_id, logical_render_hash, execution_snapshot_hash, terminal_state,
          receipt_hash, receipt_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.receipt_id,
        receipt.job_id,
        receipt.logical_render_hash,
        receipt.execution_snapshot_hash,
        receipt.terminal_state,
        receipt.receipt_hash,
        bytes,
        receipt.created_at,
      );
    return receipt;
  }

  #transition(
    jobId: string,
    from: readonly RenderPreparationStateV1[],
    to: RenderPreparationStateV1,
  ): RenderPreparationRecordV1 {
    const placeholders = from.map(() => '?').join(', ');
    const changed = this.#db
      .prepare(
        `UPDATE render_jobs SET state = ?, updated_at = ?
         WHERE job_id = ? AND state IN (${placeholders})`,
      )
      .run(to, this.#clock(), jobId, ...from).changes;
    if (changed !== 1) throw new Error('RENDER_JOB_STATE_CONFLICT');
    return this.require(jobId);
  }

  #row(jobId: string): RenderJobRow | undefined {
    return this.#db.prepare('SELECT * FROM render_jobs WHERE job_id = ?').get(jobId) as
      | RenderJobRow
      | undefined;
  }

  #rowByRequestHash(requestHash: string): RenderJobRow | undefined {
    return this.#db.prepare('SELECT * FROM render_jobs WHERE request_hash = ?').get(requestHash) as
      | RenderJobRow
      | undefined;
  }

  #requireRow(jobId: string): RenderJobRow {
    const row = this.#row(jobId);
    if (!row) throw new Error('RENDER_JOB_NOT_FOUND');
    return row;
  }

  #map(row: RenderJobRow): RenderPreparationRecordV1 {
    const request = renderAcceptedTimelineRequestV1Schema.parse(
      JSON.parse(row.request_json) as unknown,
    );
    if (
      canonicalJson(request) !== row.request_json ||
      sha256(row.request_json) !== row.request_hash
    ) {
      throw new Error('RENDER_REQUEST_STORED_INTEGRITY_MISMATCH');
    }
    const plan = row.logical_plan_json
      ? parseLogicalRenderPlanV1(JSON.parse(row.logical_plan_json) as unknown)
      : null;
    if (
      plan &&
      (canonicalJson(plan) !== row.logical_plan_json ||
        plan.logical_render_hash !== row.logical_render_hash)
    ) {
      throw new Error('RENDER_LOGICAL_PLAN_STORED_INTEGRITY_MISMATCH');
    }
    return {
      job_id: row.job_id,
      request_hash: row.request_hash,
      request,
      logical_render_hash: row.logical_render_hash,
      logical_plan: plan,
      state: row.state,
      attempt_number: row.attempt_number,
      current_execution_snapshot_hash: row.current_execution_snapshot_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  }
}
