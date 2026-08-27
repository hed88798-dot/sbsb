import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  copywritingResultV1Schema,
  type CopywritingGenerateRequestV1,
  type CopywritingResultV1,
  type FactConflictV1,
  type ProductFactSnapshotV1,
  type TextGatewayResultV1,
} from '@app/contracts';

interface ResultRow {
  job_id: string;
  script_id: string;
  text: string;
  raw_model_output: string;
  result_status: 'SUCCEEDED' | 'REVIEW_REQUIRED';
  fact_snapshot_json: string | null;
  fact_conflicts_json: string;
  prompt_template_id: string;
  prompt_template_version: string;
  provider_alias: string;
  provider_model: string;
  request_snapshot_hash: string;
  created_at: string;
}

export class CopywritingRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  attachRequest(
    jobId: string,
    request: CopywritingGenerateRequestV1,
    factSnapshot: ProductFactSnapshotV1 | null,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO copywriting_jobs(job_id, request_json, fact_snapshot_json, script_id, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
      .run(
        jobId,
        JSON.stringify(request),
        factSnapshot ? JSON.stringify(factSnapshot) : null,
        new Date().toISOString(),
      );
  }

  recordFailure(input: {
    jobId: string;
    requestId: string;
    errorCode: string;
    requestSnapshotHash: string;
    durationMs: number;
  }): void {
    this.#db
      .prepare(
        `INSERT INTO provider_call_summaries(
          call_id, job_id, request_id, provider_alias, provider_model, duration_ms,
          billed_units, state, error_code, request_snapshot_hash, created_at
        ) VALUES (?, ?, ?, 'gateway', 'text.standard', ?, 0, 'FAILED', ?, ?, ?)`,
      )
      .run(
        `provider_call_${randomUUID()}`,
        input.jobId,
        input.requestId,
        input.durationMs,
        input.errorCode,
        input.requestSnapshotHash,
        new Date().toISOString(),
      );
  }

  complete(input: {
    jobId: string;
    productId: string | null;
    textResult: TextGatewayResultV1;
    factSnapshot: ProductFactSnapshotV1 | null;
    conflicts: FactConflictV1[];
    promptTemplateId: string;
    promptTemplateVersion: string;
    requestSnapshotHash: string;
  }): CopywritingResultV1 {
    const scriptId = `script_${randomUUID()}`;
    const callId = `provider_call_${randomUUID()}`;
    const now = new Date().toISOString();
    const resultStatus = input.conflicts.length > 0 ? 'REVIEW_REQUIRED' : 'SUCCEEDED';
    const write = this.#db.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO scripts(script_id, product_id, current_version, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .run(scriptId, input.productId, now, now);
      this.#db
        .prepare(
          `INSERT INTO script_versions(
            script_id, version, text, raw_model_output, result_status, fact_snapshot_json,
            fact_conflicts_json, prompt_template_id, prompt_template_version, provider_alias,
            provider_model, request_snapshot_hash, created_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          scriptId,
          input.textResult.text,
          input.textResult.text,
          resultStatus,
          input.factSnapshot ? JSON.stringify(input.factSnapshot) : null,
          JSON.stringify(input.conflicts),
          input.promptTemplateId,
          input.promptTemplateVersion,
          input.textResult.provider_alias,
          input.textResult.provider_model,
          input.requestSnapshotHash,
          now,
        );
      this.#db
        .prepare('UPDATE copywriting_jobs SET script_id = ? WHERE job_id = ?')
        .run(scriptId, input.jobId);
      this.#db
        .prepare(
          `INSERT INTO provider_call_summaries(
            call_id, job_id, request_id, provider_alias, provider_model, duration_ms,
            billed_units, state, error_code, request_snapshot_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', NULL, ?, ?)`,
        )
        .run(
          callId,
          input.jobId,
          input.textResult.request_id,
          input.textResult.provider_alias,
          input.textResult.provider_model,
          input.textResult.latency_ms,
          input.textResult.billed_units,
          input.requestSnapshotHash,
          now,
        );
      this.#db
        .prepare(
          `UPDATE jobs SET state = 'SUCCEEDED', progress = 1, finished_at = ?,
           error_code = NULL, error_message = NULL WHERE job_id = ? AND state = 'RUNNING'`,
        )
        .run(now, input.jobId);
    });
    write.immediate();
    return this.requireResult(input.jobId);
  }

  getResult(jobId: string): CopywritingResultV1 | null {
    const row = this.#db
      .prepare(
        `SELECT cj.job_id, sv.script_id, sv.text, sv.raw_model_output, sv.result_status,
          sv.fact_snapshot_json, sv.fact_conflicts_json, sv.prompt_template_id,
          sv.prompt_template_version, sv.provider_alias, sv.provider_model,
          sv.request_snapshot_hash, sv.created_at
         FROM copywriting_jobs cj
         JOIN scripts s ON s.script_id = cj.script_id
         JOIN script_versions sv ON sv.script_id = s.script_id AND sv.version = s.current_version
         WHERE cj.job_id = ?`,
      )
      .get(jobId) as ResultRow | undefined;
    if (!row) return null;
    return copywritingResultV1Schema.parse({
      schema_version: '1.0',
      job_id: row.job_id,
      script_id: row.script_id,
      result_status: row.result_status,
      text: row.text,
      raw_model_output: row.raw_model_output,
      fact_snapshot: row.fact_snapshot_json
        ? (JSON.parse(row.fact_snapshot_json) as ProductFactSnapshotV1)
        : null,
      fact_conflicts: JSON.parse(row.fact_conflicts_json) as FactConflictV1[],
      prompt_template_id: row.prompt_template_id,
      prompt_template_version: row.prompt_template_version,
      provider_alias: row.provider_alias,
      provider_model: row.provider_model,
      request_snapshot_hash: row.request_snapshot_hash,
      created_at: row.created_at,
    });
  }

  requireResult(jobId: string): CopywritingResultV1 {
    const result = this.getResult(jobId);
    if (!result) throw new Error('COPYWRITING_RESULT_NOT_FOUND');
    return result;
  }
}
