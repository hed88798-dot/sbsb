CREATE TABLE render_policy_versions (
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK(policy_version > 0),
  policy_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  PRIMARY KEY(policy_id, policy_version),
  UNIQUE(policy_hash)
);

CREATE TRIGGER render_policy_versions_reject_update
BEFORE UPDATE ON render_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'RENDER_POLICY_VERSIONS_APPEND_ONLY');
END;

CREATE TRIGGER render_policy_versions_reject_delete
BEFORE DELETE ON render_policy_versions
BEGIN
  SELECT RAISE(ABORT, 'RENDER_POLICY_VERSIONS_APPEND_ONLY');
END;

CREATE TABLE narration_audio_artifacts (
  narration_audio_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE,
  artifact_sha256 TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  codec TEXT NOT NULL,
  container TEXT NOT NULL,
  sample_rate_hz INTEGER NOT NULL CHECK(sample_rate_hz > 0),
  channels INTEGER NOT NULL CHECK(channels > 0),
  channel_layout TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  artifact_hash TEXT NOT NULL UNIQUE,
  artifact_json TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE TRIGGER narration_audio_artifacts_reject_update
BEFORE UPDATE ON narration_audio_artifacts
BEGIN
  SELECT RAISE(ABORT, 'NARRATION_AUDIO_ARTIFACTS_APPEND_ONLY');
END;

CREATE TRIGGER narration_audio_artifacts_reject_delete
BEFORE DELETE ON narration_audio_artifacts
BEGIN
  SELECT RAISE(ABORT, 'NARRATION_AUDIO_ARTIFACTS_APPEND_ONLY');
END;

CREATE TABLE narration_audio_locations (
  location_id TEXT PRIMARY KEY,
  narration_audio_id TEXT NOT NULL REFERENCES narration_audio_artifacts(narration_audio_id) ON DELETE RESTRICT,
  normalized_path TEXT NOT NULL UNIQUE,
  location_status TEXT NOT NULL CHECK(location_status IN ('PRESENT', 'MISSING')),
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_narration_audio_locations_artifact
  ON narration_audio_locations(narration_audio_id, normalized_path);

CREATE TABLE render_jobs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  timeline_version INTEGER NOT NULL CHECK(timeline_version > 0),
  timeline_commit_receipt_hash TEXT NOT NULL,
  render_policy_id TEXT NOT NULL,
  render_policy_version INTEGER NOT NULL CHECK(render_policy_version > 0),
  render_policy_hash TEXT NOT NULL,
  logical_render_hash TEXT UNIQUE,
  logical_plan_json TEXT,
  state TEXT NOT NULL CHECK(state IN (
    'PREPARING', 'ENTRY_VALIDATED', 'SOURCES_RESOLVED', 'STAGING',
    'READY_FOR_EXECUTION', 'FAILED', 'CANCELLED', 'INTERRUPTED'
  )),
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  current_execution_snapshot_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX idx_render_jobs_state ON render_jobs(state, updated_at);

CREATE TABLE render_execution_snapshots (
  execution_snapshot_hash TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES render_jobs(job_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state = 'READY_FOR_EXECUTION'),
  created_at TEXT NOT NULL,
  UNIQUE(job_id, attempt_number)
);

CREATE TRIGGER render_execution_snapshots_reject_update
BEFORE UPDATE ON render_execution_snapshots
BEGIN
  SELECT RAISE(ABORT, 'RENDER_EXECUTION_SNAPSHOTS_APPEND_ONLY');
END;

CREATE TRIGGER render_execution_snapshots_reject_delete
BEFORE DELETE ON render_execution_snapshots
BEGIN
  SELECT RAISE(ABORT, 'RENDER_EXECUTION_SNAPSHOTS_APPEND_ONLY');
END;

CREATE TABLE render_artifacts (
  artifact_record_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES render_jobs(job_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  artifact_role TEXT NOT NULL CHECK(artifact_role IN ('STAGED_SOURCE', 'STAGED_NARRATION', 'OUTPUT')),
  authority_sha256 TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  managed_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('VERIFIED_STAGED', 'VERIFIED_OUTPUT', 'QUARANTINED')),
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_render_artifacts_job_attempt
  ON render_artifacts(job_id, attempt_number, artifact_role);

CREATE TRIGGER render_artifacts_reject_update
BEFORE UPDATE ON render_artifacts
BEGIN
  SELECT RAISE(ABORT, 'RENDER_ARTIFACTS_APPEND_ONLY');
END;

CREATE TRIGGER render_artifacts_reject_delete
BEFORE DELETE ON render_artifacts
BEGIN
  SELECT RAISE(ABORT, 'RENDER_ARTIFACTS_APPEND_ONLY');
END;

CREATE TABLE render_receipts (
  receipt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES render_jobs(job_id) ON DELETE RESTRICT,
  logical_render_hash TEXT NOT NULL,
  execution_snapshot_hash TEXT NOT NULL REFERENCES render_execution_snapshots(execution_snapshot_hash) ON DELETE RESTRICT,
  terminal_state TEXT NOT NULL CHECK(terminal_state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  receipt_hash TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER render_receipts_reject_update
BEFORE UPDATE ON render_receipts
BEGIN
  SELECT RAISE(ABORT, 'RENDER_RECEIPTS_APPEND_ONLY');
END;

CREATE TRIGGER render_receipts_reject_delete
BEFORE DELETE ON render_receipts
BEGIN
  SELECT RAISE(ABORT, 'RENDER_RECEIPTS_APPEND_ONLY');
END;
