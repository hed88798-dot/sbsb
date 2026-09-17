CREATE TABLE shot_plan_lineages (
  shot_plan_id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  source_document_version INTEGER NOT NULL CHECK(source_document_version >= 1),
  source_document_hash TEXT NOT NULL CHECK(
    length(source_document_hash) = 64
    AND source_document_hash = lower(source_document_hash)
    AND source_document_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE(source_document_id, source_document_version),
  FOREIGN KEY(source_document_id, source_document_version)
    REFERENCES source_document_versions(source_document_id, version)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TABLE shot_plan_candidates (
  candidate_id TEXT PRIMARY KEY,
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision >= 1),
  candidate_status TEXT NOT NULL CHECK(candidate_status IN ('ACTIVE', 'REJECTED')),
  source_document_id TEXT NOT NULL,
  source_document_version INTEGER NOT NULL CHECK(source_document_version >= 1),
  source_document_hash TEXT NOT NULL CHECK(
    length(source_document_hash) = 64
    AND source_document_hash = lower(source_document_hash)
    AND source_document_hash NOT GLOB '*[^0-9a-f]*'
  ),
  bound_shot_plan_id TEXT,
  base_confirmed_version INTEGER CHECK(base_confirmed_version IS NULL OR base_confirmed_version >= 1),
  candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_document_id, source_document_version)
    REFERENCES source_document_versions(source_document_id, version)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY(bound_shot_plan_id)
    REFERENCES shot_plan_lineages(shot_plan_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CHECK(
    (bound_shot_plan_id IS NULL AND base_confirmed_version IS NULL)
    OR (bound_shot_plan_id IS NOT NULL AND base_confirmed_version IS NOT NULL)
  )
);

CREATE TABLE confirmed_shot_plan_versions (
  shot_plan_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  shot_plan_hash TEXT NOT NULL CHECK(
    length(shot_plan_hash) = 64
    AND shot_plan_hash = lower(shot_plan_hash)
    AND shot_plan_hash NOT GLOB '*[^0-9a-f]*'
  ),
  source_document_id TEXT NOT NULL,
  source_document_version INTEGER NOT NULL CHECK(source_document_version >= 1),
  source_document_hash TEXT NOT NULL CHECK(
    length(source_document_hash) = 64
    AND source_document_hash = lower(source_document_hash)
    AND source_document_hash NOT GLOB '*[^0-9a-f]*'
  ),
  candidate_id TEXT NOT NULL,
  candidate_revision INTEGER NOT NULL CHECK(candidate_revision >= 1),
  confirmed_plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(shot_plan_id, version),
  UNIQUE(
    candidate_id,
    candidate_revision,
    source_document_id,
    source_document_version,
    source_document_hash
  ),
  FOREIGN KEY(shot_plan_id)
    REFERENCES shot_plan_lineages(shot_plan_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY(source_document_id, source_document_version)
    REFERENCES source_document_versions(source_document_id, version)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY(candidate_id)
    REFERENCES shot_plan_candidates(candidate_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX confirmed_shot_plan_versions_lineage_idx
ON confirmed_shot_plan_versions(shot_plan_id, version);

CREATE TRIGGER shot_plan_lineages_reject_update
BEFORE UPDATE ON shot_plan_lineages
BEGIN
  SELECT RAISE(ABORT, 'SHOT_PLAN_LINEAGES_APPEND_ONLY');
END;

CREATE TRIGGER shot_plan_lineages_reject_delete
BEFORE DELETE ON shot_plan_lineages
BEGIN
  SELECT RAISE(ABORT, 'SHOT_PLAN_LINEAGES_APPEND_ONLY');
END;

CREATE TRIGGER confirmed_shot_plan_versions_reject_update
BEFORE UPDATE ON confirmed_shot_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_SHOT_PLAN_VERSIONS_APPEND_ONLY');
END;

CREATE TRIGGER confirmed_shot_plan_versions_reject_delete
BEFORE DELETE ON confirmed_shot_plan_versions
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_SHOT_PLAN_VERSIONS_APPEND_ONLY');
END;
