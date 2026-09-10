CREATE TABLE timeline_plan_versions (
  timeline_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  parent_version INTEGER,
  planning_request_id TEXT NOT NULL UNIQUE,
  timeline_request_hash TEXT NOT NULL,
  shot_plan_id TEXT NOT NULL,
  shot_plan_hash TEXT NOT NULL,
  timing_snapshot_id TEXT NOT NULL,
  timing_snapshot_hash TEXT NOT NULL,
  planning_facts_hash TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_snapshot_hash TEXT NOT NULL,
  duration_plan_hash TEXT NOT NULL,
  planning_request_json TEXT NOT NULL,
  planning_facts_json TEXT NOT NULL,
  duration_policy_json TEXT NOT NULL,
  duration_plan_json TEXT NOT NULL,
  commit_receipt_hash TEXT NOT NULL,
  commit_receipt_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY(timeline_id, version),
  CHECK(
    (version = 1 AND parent_version IS NULL)
    OR
    (version > 1 AND parent_version = version - 1)
  )
);

CREATE INDEX idx_timeline_plan_versions_latest
  ON timeline_plan_versions(timeline_id, version DESC);

CREATE TRIGGER timeline_plan_versions_reject_update
BEFORE UPDATE ON timeline_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'TIMELINE_PLAN_VERSIONS_APPEND_ONLY');
END;

CREATE TRIGGER timeline_plan_versions_reject_delete
BEFORE DELETE ON timeline_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'TIMELINE_PLAN_VERSIONS_APPEND_ONLY');
END;
