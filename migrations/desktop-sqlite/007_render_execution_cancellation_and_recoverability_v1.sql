ALTER TABLE render_execution_attempts
ADD COLUMN cancellation_requested_at TEXT;

CREATE TABLE render_output_recoverability_observations (
  observation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES render_jobs(job_id) ON DELETE RESTRICT,
  execution_attempt_id TEXT NOT NULL REFERENCES render_execution_attempts(execution_attempt_id) ON DELETE RESTRICT,
  output_artifact_record_id TEXT NOT NULL REFERENCES render_artifacts(artifact_record_id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK(disposition IN (
    'TRUSTED', 'MISSING', 'HASH_INVALID', 'SIZE_INVALID', 'OTHER_INTEGRITY_FAILURE'
  )),
  expected_sha256 TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL CHECK(expected_size_bytes > 0),
  observed_sha256 TEXT,
  observed_size_bytes INTEGER CHECK(observed_size_bytes IS NULL OR observed_size_bytes >= 0),
  observed_at TEXT NOT NULL
);

CREATE INDEX idx_render_output_recoverability_current
  ON render_output_recoverability_observations(job_id, observed_at, observation_id);

CREATE TRIGGER render_output_recoverability_reject_update
BEFORE UPDATE ON render_output_recoverability_observations
BEGIN
  SELECT RAISE(ABORT, 'RENDER_OUTPUT_RECOVERABILITY_APPEND_ONLY');
END;

CREATE TRIGGER render_output_recoverability_reject_delete
BEFORE DELETE ON render_output_recoverability_observations
BEGIN
  SELECT RAISE(ABORT, 'RENDER_OUTPUT_RECOVERABILITY_APPEND_ONLY');
END;
