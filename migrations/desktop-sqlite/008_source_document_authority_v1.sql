CREATE TABLE source_document_versions (
  source_document_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  source_document_hash TEXT NOT NULL CHECK(
    length(source_document_hash) = 64
    AND source_document_hash = lower(source_document_hash)
    AND source_document_hash NOT GLOB '*[^0-9a-f]*'
  ),
  source_hash_scheme TEXT NOT NULL CHECK(source_hash_scheme = 'SHA256_UTF8_EXACT_V1'),
  source_offset_unit TEXT NOT NULL CHECK(source_offset_unit = 'UNICODE_CODE_POINT'),
  source_kind TEXT NOT NULL CHECK(source_kind = 'SCRIPT_VERSION'),
  text TEXT NOT NULL,
  source_script_id TEXT NOT NULL,
  source_script_version INTEGER NOT NULL CHECK(source_script_version >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_document_id, version),
  UNIQUE(source_script_id, source_script_version),
  FOREIGN KEY(source_script_id, source_script_version)
    REFERENCES script_versions(script_id, version)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CHECK(source_document_id = source_script_id),
  CHECK(version = source_script_version)
);

CREATE TRIGGER source_document_versions_reject_update
BEFORE UPDATE ON source_document_versions
BEGIN
  SELECT RAISE(ABORT, 'SOURCE_DOCUMENT_VERSIONS_APPEND_ONLY');
END;
CREATE TRIGGER source_document_versions_reject_delete
BEFORE DELETE ON source_document_versions
BEGIN
  SELECT RAISE(ABORT, 'SOURCE_DOCUMENT_VERSIONS_APPEND_ONLY');
END;
