CREATE TABLE render_execution_attempts (
  execution_attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES render_jobs(job_id) ON DELETE RESTRICT,
  execution_attempt_number INTEGER NOT NULL CHECK(execution_attempt_number > 0),
  preparation_attempt_number INTEGER NOT NULL CHECK(preparation_attempt_number > 0),
  execution_snapshot_hash TEXT NOT NULL REFERENCES render_execution_snapshots(execution_snapshot_hash) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN (
    'STARTING', 'RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'
  )),
  partial_output_path TEXT NOT NULL,
  final_output_path TEXT NOT NULL,
  progress_frame INTEGER CHECK(progress_frame IS NULL OR progress_frame >= 0),
  progress_out_time_ms INTEGER CHECK(progress_out_time_ms IS NULL OR progress_out_time_ms >= 0),
  finalize_protocol TEXT CHECK(
    finalize_protocol IS NULL OR finalize_protocol = 'ATOMIC_SAME_VOLUME_RENAME'
  ),
  output_artifact_record_id TEXT REFERENCES render_artifacts(artifact_record_id) ON DELETE RESTRICT,
  receipt_id TEXT REFERENCES render_receipts(receipt_id) ON DELETE RESTRICT,
  error_id TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_id, execution_attempt_number)
);

CREATE UNIQUE INDEX idx_render_execution_attempts_one_active
  ON render_execution_attempts(job_id)
  WHERE state IN ('STARTING', 'RUNNING', 'VERIFYING');

CREATE UNIQUE INDEX idx_render_execution_attempts_one_success
  ON render_execution_attempts(job_id)
  WHERE state = 'SUCCEEDED';

CREATE INDEX idx_render_execution_attempts_recovery
  ON render_execution_attempts(state, updated_at);

CREATE TRIGGER render_execution_attempts_terminal_immutable
BEFORE UPDATE ON render_execution_attempts
WHEN OLD.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')
BEGIN
  SELECT RAISE(ABORT, 'RENDER_EXECUTION_ATTEMPT_TERMINAL_IMMUTABLE');
END;
