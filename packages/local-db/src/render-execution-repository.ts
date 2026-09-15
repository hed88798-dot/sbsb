import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { canonicalJson } from '@app/domain-media-index';
import {
  parseRenderReceiptV1,
  type RenderOutputArtifactV1,
  type RenderReceiptV1,
} from '@app/render';

export type RenderExecutionAttemptStateV1 =
  | 'STARTING'
  | 'RUNNING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED';

export interface RenderExecutionAttemptRecordV1 {
  execution_attempt_id: string;
  job_id: string;
  execution_attempt_number: number;
  preparation_attempt_number: number;
  execution_snapshot_hash: string;
  state: RenderExecutionAttemptStateV1;
  partial_output_path: string;
  final_output_path: string;
  progress_frame: number | null;
  progress_out_time_ms: number | null;
  finalize_protocol: 'ATOMIC_SAME_VOLUME_RENAME' | null;
  output_artifact_record_id: string | null;
  receipt_id: string | null;
  error_id: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  cancellation_requested_at: string | null;
}

export type RenderOutputRecoverabilityDispositionV1 =
  | 'TRUSTED'
  | 'MISSING'
  | 'HASH_INVALID'
  | 'SIZE_INVALID'
  | 'OTHER_INTEGRITY_FAILURE';

export interface RenderOutputRecoverabilityObservationV1 {
  observation_id: string;
  job_id: string;
  execution_attempt_id: string;
  output_artifact_record_id: string;
  disposition: RenderOutputRecoverabilityDispositionV1;
  expected_sha256: string;
  expected_size_bytes: number;
  observed_sha256: string | null;
  observed_size_bytes: number | null;
  observed_at: string;
}

export interface ExistingRenderSuccessV1 {
  attempt: RenderExecutionAttemptRecordV1;
  receipt: RenderReceiptV1;
}

type AttemptRow = RenderExecutionAttemptRecordV1;

function assertReceiptBinding(
  attempt: RenderExecutionAttemptRecordV1,
  receipt: RenderReceiptV1,
): void {
  if (
    receipt.job_id !== attempt.job_id ||
    receipt.execution_snapshot_hash !== attempt.execution_snapshot_hash
  ) {
    throw new Error('RENDER_EXECUTION_RECEIPT_BINDING_MISMATCH');
  }
}

export class RenderExecutionRepository {
  readonly #db: Database;
  readonly #clock: () => string;
  readonly #id: () => string;

  constructor(db: Database, options: { clock?: () => string; id?: () => string } = {}) {
    this.#db = db;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#id = options.id ?? (() => randomUUID());
  }

  reserve(input: {
    job_id: string;
    execution_snapshot_hash: string;
    partial_output_path: string;
    final_output_path: string;
  }): RenderExecutionAttemptRecordV1 | ExistingRenderSuccessV1 {
    const operation = this.#db.transaction(() => {
      const success = this.findSucceeded(input.job_id);
      if (success) return success;
      const active = this.#db
        .prepare(
          `SELECT 1 FROM render_execution_attempts WHERE job_id = ?
           AND state IN ('STARTING', 'RUNNING', 'VERIFYING')`,
        )
        .get(input.job_id);
      if (active) throw new Error('RENDER_EXECUTION_ALREADY_ACTIVE');
      const preparation = this.#db
        .prepare(
          `SELECT state, attempt_number, current_execution_snapshot_hash
           FROM render_jobs WHERE job_id = ?`,
        )
        .get(input.job_id) as
        | { state: string; attempt_number: number; current_execution_snapshot_hash: string | null }
        | undefined;
      if (
        !preparation ||
        preparation.state !== 'READY_FOR_EXECUTION' ||
        preparation.current_execution_snapshot_hash !== input.execution_snapshot_hash
      ) {
        throw new Error('RENDER_EXECUTION_NOT_READY');
      }
      const nextNumber =
        (this.#db
          .prepare(
            'SELECT COALESCE(MAX(execution_attempt_number), 0) FROM render_execution_attempts WHERE job_id = ?',
          )
          .pluck()
          .get(input.job_id) as number) + 1;
      const now = this.#clock();
      const attemptId = `render_execution_${this.#id()}`;
      this.#db
        .prepare(
          `INSERT INTO render_execution_attempts(
            execution_attempt_id, job_id, execution_attempt_number, preparation_attempt_number,
            execution_snapshot_hash, state, partial_output_path, final_output_path,
            progress_frame, progress_out_time_ms, finalize_protocol, output_artifact_record_id,
            receipt_id, error_id, started_at, updated_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, 'STARTING', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
        )
        .run(
          attemptId,
          input.job_id,
          nextNumber,
          preparation.attempt_number,
          input.execution_snapshot_hash,
          input.partial_output_path,
          input.final_output_path,
          now,
          now,
        );
      const genericJobChanged = this.#db
        .prepare(
          `UPDATE jobs SET state = 'RUNNING', progress = 0, started_at = ?, finished_at = NULL,
           error_code = NULL, error_message = NULL WHERE job_id = ?
           AND state IN ('QUEUED', 'FAILED', 'CANCELLED', 'INTERRUPTED')`,
        )
        .run(now, input.job_id).changes;
      if (genericJobChanged !== 1) throw new Error('RENDER_GENERIC_JOB_STATE_CONFLICT');
      return this.require(attemptId);
    });
    return operation.immediate();
  }

  require(executionAttemptId: string): RenderExecutionAttemptRecordV1 {
    const row = this.#db
      .prepare('SELECT * FROM render_execution_attempts WHERE execution_attempt_id = ?')
      .get(executionAttemptId) as AttemptRow | undefined;
    if (!row) throw new Error('RENDER_EXECUTION_ATTEMPT_NOT_FOUND');
    return this.#map(row);
  }

  findSucceeded(jobId: string): ExistingRenderSuccessV1 | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM render_execution_attempts
         WHERE job_id = ? AND state = 'SUCCEEDED' ORDER BY execution_attempt_number DESC LIMIT 1`,
      )
      .get(jobId) as AttemptRow | undefined;
    if (!row?.receipt_id) return null;
    const receiptRow = this.#db
      .prepare('SELECT receipt_json FROM render_receipts WHERE receipt_id = ?')
      .get(row.receipt_id) as { receipt_json: string } | undefined;
    if (!receiptRow) throw new Error('RENDER_EXECUTION_SUCCESS_RECEIPT_MISSING');
    const receipt = parseRenderReceiptV1(JSON.parse(receiptRow.receipt_json) as unknown);
    if (canonicalJson(receipt) !== receiptRow.receipt_json) {
      throw new Error('RENDER_EXECUTION_SUCCESS_RECEIPT_INTEGRITY_MISMATCH');
    }
    const attempt = this.#map(row);
    assertReceiptBinding(attempt, receipt);
    return { attempt, receipt };
  }

  findActive(jobId: string): RenderExecutionAttemptRecordV1 | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM render_execution_attempts WHERE job_id = ?
         AND state IN ('STARTING', 'RUNNING', 'VERIFYING')
         ORDER BY execution_attempt_number DESC LIMIT 1`,
      )
      .get(jobId) as AttemptRow | undefined;
    return row ? this.#map(row) : null;
  }

  requestCancellation(jobId: string): RenderExecutionAttemptRecordV1 | null {
    const operation = this.#db.transaction(() => {
      const active = this.findActive(jobId);
      if (!active) return null;
      const requestedAt = active.cancellation_requested_at ?? this.#clock();
      const changed = this.#db
        .prepare(
          `UPDATE render_execution_attempts SET cancellation_requested_at = ?, updated_at = ?
           WHERE execution_attempt_id = ? AND state IN ('STARTING', 'RUNNING', 'VERIFYING')`,
        )
        .run(requestedAt, requestedAt, active.execution_attempt_id).changes;
      if (changed !== 1) throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      return this.require(active.execution_attempt_id);
    });
    return operation.immediate();
  }

  assertCancellationNotRequested(executionAttemptId: string): void {
    const attempt = this.require(executionAttemptId);
    if (attempt.cancellation_requested_at !== null) {
      throw new Error('RENDER_EXECUTION_CANCELLATION_REQUESTED');
    }
  }

  claimSpawn(executionAttemptId: string): RenderExecutionAttemptRecordV1 {
    const changed = this.#db
      .prepare(
        `UPDATE render_execution_attempts SET state = 'RUNNING', updated_at = ?
         WHERE execution_attempt_id = ? AND state = 'STARTING'
         AND cancellation_requested_at IS NULL`,
      )
      .run(this.#clock(), executionAttemptId).changes;
    if (changed === 1) return this.require(executionAttemptId);
    const attempt = this.require(executionAttemptId);
    if (attempt.state === 'STARTING' && attempt.cancellation_requested_at !== null) {
      throw new Error('RENDER_EXECUTION_CANCELLATION_REQUESTED');
    }
    throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
  }

  markRunning(executionAttemptId: string): RenderExecutionAttemptRecordV1 {
    return this.claimSpawn(executionAttemptId);
  }

  recordProgress(
    executionAttemptId: string,
    progress: { frame: number | null; out_time_ms: number | null; percent: number },
  ): RenderExecutionAttemptRecordV1 {
    if (!Number.isFinite(progress.percent) || progress.percent < 0 || progress.percent >= 1) {
      throw new Error('RENDER_EXECUTION_PROGRESS_INVALID');
    }
    const operation = this.#db.transaction(() => {
      const now = this.#clock();
      const changed = this.#db
        .prepare(
          `UPDATE render_execution_attempts SET progress_frame = ?, progress_out_time_ms = ?,
           updated_at = ? WHERE execution_attempt_id = ? AND state = 'RUNNING'`,
        )
        .run(progress.frame, progress.out_time_ms, now, executionAttemptId).changes;
      if (changed !== 1) throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      const attempt = this.require(executionAttemptId);
      const genericJobChanged = this.#db
        .prepare("UPDATE jobs SET progress = ? WHERE job_id = ? AND state = 'RUNNING'")
        .run(progress.percent, attempt.job_id).changes;
      if (genericJobChanged !== 1) throw new Error('RENDER_GENERIC_JOB_STATE_CONFLICT');
      return attempt;
    });
    return operation.immediate();
  }

  markVerifying(executionAttemptId: string): RenderExecutionAttemptRecordV1 {
    return this.#transition(executionAttemptId, ['RUNNING'], 'VERIFYING');
  }

  commitSuccess(input: {
    execution_attempt_id: string;
    receipt: RenderReceiptV1;
    output_artifact: RenderOutputArtifactV1;
    managed_path: string;
    finalize_protocol: 'ATOMIC_SAME_VOLUME_RENAME';
  }): RenderExecutionAttemptRecordV1 {
    const receipt = parseRenderReceiptV1(input.receipt);
    if (
      receipt.terminal_state !== 'SUCCEEDED' ||
      receipt.output_artifact === null ||
      receipt.verification_facts === null ||
      receipt.error_id !== null ||
      canonicalJson(receipt.output_artifact) !== canonicalJson(input.output_artifact)
    ) {
      throw new Error('RENDER_EXECUTION_SUCCESS_RECEIPT_INVALID');
    }
    const operation = this.#db.transaction(() => {
      const attempt = this.require(input.execution_attempt_id);
      if (attempt.state !== 'VERIFYING') throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      assertReceiptBinding(attempt, receipt);
      const artifactRecordId = `${attempt.execution_attempt_id}:output`;
      this.#db
        .prepare(
          `INSERT INTO render_artifacts(
            artifact_record_id, job_id, attempt_number, artifact_role, authority_sha256,
            artifact_sha256, size_bytes, managed_path, state, artifact_json, created_at
          ) VALUES (?, ?, ?, 'OUTPUT', ?, ?, ?, ?, 'VERIFIED_OUTPUT', ?, ?)`,
        )
        .run(
          artifactRecordId,
          attempt.job_id,
          attempt.preparation_attempt_number,
          input.output_artifact.output_sha256,
          input.output_artifact.output_sha256,
          input.output_artifact.size_bytes,
          input.managed_path,
          canonicalJson({ ...input.output_artifact, finalize_protocol: input.finalize_protocol }),
          receipt.created_at,
        );
      this.#insertReceipt(receipt);
      const changed = this.#db
        .prepare(
          `UPDATE render_execution_attempts SET state = 'SUCCEEDED', finalize_protocol = ?,
           output_artifact_record_id = ?, receipt_id = ?, updated_at = ?, finished_at = ?
           WHERE execution_attempt_id = ? AND state = 'VERIFYING'`,
        )
        .run(
          input.finalize_protocol,
          artifactRecordId,
          receipt.receipt_id,
          receipt.created_at,
          receipt.created_at,
          attempt.execution_attempt_id,
        ).changes;
      if (changed !== 1) throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      this.#insertOutputRecoverability({
        observation_id: `render_output_recoverability_${this.#id()}`,
        job_id: attempt.job_id,
        execution_attempt_id: attempt.execution_attempt_id,
        output_artifact_record_id: artifactRecordId,
        disposition: 'TRUSTED',
        expected_sha256: input.output_artifact.output_sha256,
        expected_size_bytes: input.output_artifact.size_bytes,
        observed_sha256: input.output_artifact.output_sha256,
        observed_size_bytes: input.output_artifact.size_bytes,
        observed_at: receipt.created_at,
      });
      const genericJobChanged = this.#db
        .prepare(
          `UPDATE jobs SET state = 'SUCCEEDED', progress = 1, finished_at = ?,
           error_code = NULL, error_message = NULL WHERE job_id = ? AND state = 'RUNNING'`,
        )
        .run(receipt.created_at, attempt.job_id).changes;
      if (genericJobChanged !== 1) throw new Error('RENDER_GENERIC_JOB_STATE_CONFLICT');
      return this.require(attempt.execution_attempt_id);
    });
    return operation.immediate();
  }

  commitNonSuccess(input: {
    execution_attempt_id: string;
    receipt: RenderReceiptV1;
    error_message: string;
  }): RenderExecutionAttemptRecordV1 {
    const receipt = parseRenderReceiptV1(input.receipt);
    if (
      receipt.terminal_state === 'SUCCEEDED' ||
      receipt.output_artifact !== null ||
      receipt.verification_facts !== null ||
      receipt.error_id === null
    ) {
      throw new Error('RENDER_EXECUTION_FAILURE_RECEIPT_INVALID');
    }
    const operation = this.#db.transaction(() => {
      const attempt = this.require(input.execution_attempt_id);
      if (!['STARTING', 'RUNNING', 'VERIFYING'].includes(attempt.state)) {
        throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      }
      assertReceiptBinding(attempt, receipt);
      this.#insertReceipt(receipt);
      const changed = this.#db
        .prepare(
          `UPDATE render_execution_attempts SET state = ?, receipt_id = ?, error_id = ?,
           updated_at = ?, finished_at = ? WHERE execution_attempt_id = ?
           AND state IN ('STARTING', 'RUNNING', 'VERIFYING')`,
        )
        .run(
          receipt.terminal_state,
          receipt.receipt_id,
          receipt.error_id,
          receipt.created_at,
          receipt.created_at,
          attempt.execution_attempt_id,
        ).changes;
      if (changed !== 1) throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
      const genericJobChanged = this.#db
        .prepare(
          `UPDATE jobs SET state = ?, finished_at = ?, error_code = ?, error_message = ?
           WHERE job_id = ? AND state = 'RUNNING'`,
        )
        .run(
          receipt.terminal_state,
          receipt.created_at,
          receipt.error_id,
          input.error_message,
          attempt.job_id,
        ).changes;
      if (genericJobChanged !== 1) throw new Error('RENDER_GENERIC_JOB_STATE_CONFLICT');
      return this.require(attempt.execution_attempt_id);
    });
    return operation.immediate();
  }

  listActive(): RenderExecutionAttemptRecordV1[] {
    return (
      this.#db
        .prepare(
          `SELECT * FROM render_execution_attempts
           WHERE state IN ('STARTING', 'RUNNING', 'VERIFYING') ORDER BY started_at`,
        )
        .all() as AttemptRow[]
    ).map((row) => this.#map(row));
  }

  currentOutputRecoverability(jobId: string): RenderOutputRecoverabilityObservationV1 | null {
    const row = this.#db
      .prepare(
        `SELECT observation_id, job_id, execution_attempt_id, output_artifact_record_id,
         disposition, expected_sha256, expected_size_bytes, observed_sha256,
         observed_size_bytes, observed_at
         FROM render_output_recoverability_observations WHERE job_id = ?
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(jobId) as RenderOutputRecoverabilityObservationV1 | undefined;
    return row ?? null;
  }

  recordOutputRecoverability(input: {
    job_id: string;
    disposition: RenderOutputRecoverabilityDispositionV1;
    observed_sha256: string | null;
    observed_size_bytes: number | null;
  }): RenderOutputRecoverabilityObservationV1 {
    const operation = this.#db.transaction(() => {
      const success = this.findSucceeded(input.job_id);
      if (!success?.attempt.output_artifact_record_id || !success.receipt.output_artifact) {
        throw new Error('RENDER_HISTORICAL_SUCCESS_NOT_FOUND');
      }
      const current = this.currentOutputRecoverability(input.job_id);
      if (current && (current.disposition !== 'TRUSTED' || input.disposition === 'TRUSTED')) {
        return current;
      }
      const observation: RenderOutputRecoverabilityObservationV1 = {
        observation_id: `render_output_recoverability_${this.#id()}`,
        job_id: input.job_id,
        execution_attempt_id: success.attempt.execution_attempt_id,
        output_artifact_record_id: success.attempt.output_artifact_record_id,
        disposition: input.disposition,
        expected_sha256: success.receipt.output_artifact.output_sha256,
        expected_size_bytes: success.receipt.output_artifact.size_bytes,
        observed_sha256: input.observed_sha256,
        observed_size_bytes: input.observed_size_bytes,
        observed_at: this.#clock(),
      };
      this.#insertOutputRecoverability(observation);
      if (input.disposition !== 'TRUSTED') {
        const code = `RENDER_HISTORICAL_OUTPUT_${input.disposition}`;
        const changed = this.#db
          .prepare(
            `UPDATE jobs SET state = 'FAILED', finished_at = ?, error_code = ?, error_message = ?
             WHERE job_id = ? AND state = 'SUCCEEDED'`,
          )
          .run(observation.observed_at, code, code, input.job_id).changes;
        if (changed !== 1) throw new Error('RENDER_GENERIC_JOB_STATE_CONFLICT');
      }
      return observation;
    });
    return operation.immediate();
  }

  #insertReceipt(receipt: RenderReceiptV1): void {
    const bytes = canonicalJson(receipt);
    const existing = this.#db
      .prepare('SELECT receipt_json FROM render_receipts WHERE receipt_id = ?')
      .get(receipt.receipt_id) as { receipt_json: string } | undefined;
    if (existing) {
      if (existing.receipt_json !== bytes) throw new Error('RENDER_RECEIPT_IDENTITY_CONFLICT');
      return;
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
  }

  #insertOutputRecoverability(observation: RenderOutputRecoverabilityObservationV1): void {
    this.#db
      .prepare(
        `INSERT INTO render_output_recoverability_observations(
          observation_id, job_id, execution_attempt_id, output_artifact_record_id, disposition,
          expected_sha256, expected_size_bytes, observed_sha256, observed_size_bytes, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        observation.observation_id,
        observation.job_id,
        observation.execution_attempt_id,
        observation.output_artifact_record_id,
        observation.disposition,
        observation.expected_sha256,
        observation.expected_size_bytes,
        observation.observed_sha256,
        observation.observed_size_bytes,
        observation.observed_at,
      );
  }

  #transition(
    executionAttemptId: string,
    from: readonly RenderExecutionAttemptStateV1[],
    to: RenderExecutionAttemptStateV1,
  ): RenderExecutionAttemptRecordV1 {
    const placeholders = from.map(() => '?').join(', ');
    const changed = this.#db
      .prepare(
        `UPDATE render_execution_attempts SET state = ?, updated_at = ?
         WHERE execution_attempt_id = ? AND state IN (${placeholders})`,
      )
      .run(to, this.#clock(), executionAttemptId, ...from).changes;
    if (changed !== 1) throw new Error('RENDER_EXECUTION_STATE_CONFLICT');
    return this.require(executionAttemptId);
  }

  #map(row: AttemptRow): RenderExecutionAttemptRecordV1 {
    return { ...row };
  }
}
