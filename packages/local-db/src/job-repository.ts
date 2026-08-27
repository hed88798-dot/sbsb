import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { jobDtoV1Schema, type JobDTOv1 } from '@app/contracts';

interface JobRow {
  job_id: string;
  job_type: string;
  state: JobDTOv1['state'];
  progress: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  request_snapshot_hash: string;
}

export class JobRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  create(jobType: string, requestSnapshotHash: string): JobDTOv1 {
    const jobId = `job_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO jobs(
          job_id, job_type, state, progress, created_at, started_at, finished_at,
          error_code, error_message, request_snapshot_hash
        ) VALUES (?, ?, 'QUEUED', 0, ?, NULL, NULL, NULL, NULL, ?)`,
      )
      .run(jobId, jobType, createdAt, requestSnapshotHash);
    return this.require(jobId);
  }

  get(jobId: string): JobDTOv1 | null {
    const row = this.#db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as
      | JobRow
      | undefined;
    return row ? this.#map(row) : null;
  }

  require(jobId: string): JobDTOv1 {
    const job = this.get(jobId);
    if (!job) throw new Error('JOB_NOT_FOUND');
    return job;
  }

  list(limit = 200): JobDTOv1[] {
    const rows = this.#db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as JobRow[];
    return rows.map((row) => this.#map(row));
  }

  start(jobId: string): JobDTOv1 {
    this.#db
      .prepare(
        `UPDATE jobs SET state = 'RUNNING', progress = 0.05, started_at = ?,
         error_code = NULL, error_message = NULL
         WHERE job_id = ? AND state = 'QUEUED'`,
      )
      .run(new Date().toISOString(), jobId);
    return this.require(jobId);
  }

  fail(jobId: string, code: string, message: string): JobDTOv1 {
    this.#db
      .prepare(
        `UPDATE jobs SET state = 'FAILED', finished_at = ?, error_code = ?, error_message = ?
         WHERE job_id = ? AND state IN ('QUEUED', 'RUNNING')`,
      )
      .run(new Date().toISOString(), code, message, jobId);
    return this.require(jobId);
  }

  cancel(jobId: string): JobDTOv1 {
    this.#db
      .prepare(
        `UPDATE jobs SET state = 'CANCELLED', finished_at = ?, error_code = 'CANCELLED',
         error_message = '用户取消任务'
         WHERE job_id = ? AND state IN ('QUEUED', 'RUNNING')`,
      )
      .run(new Date().toISOString(), jobId);
    return this.require(jobId);
  }

  recoverInterrupted(): number {
    return this.#db
      .prepare(
        `UPDATE jobs SET state = 'INTERRUPTED', finished_at = ?,
         error_code = 'APP_INTERRUPTED', error_message = '应用上次运行时中断'
         WHERE state = 'RUNNING'`,
      )
      .run(new Date().toISOString()).changes;
  }

  #map(row: JobRow): JobDTOv1 {
    return jobDtoV1Schema.parse({ schema_version: '1.0', ...row });
  }
}
