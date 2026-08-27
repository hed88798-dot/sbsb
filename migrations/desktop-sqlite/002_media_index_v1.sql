CREATE TABLE media_assets (
  asset_id TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL DEFAULT 'video',
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'MISSING', 'FAILED')),
  active_revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE media_asset_locations (
  location_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  normalized_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  mtime_ns TEXT NOT NULL CHECK(length(mtime_ns) > 0 AND mtime_ns NOT GLOB '*[^0-9]*'),
  file_identity TEXT,
  location_status TEXT NOT NULL CHECK(location_status IN ('PRESENT', 'MISSING')),
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_media_asset_locations_asset ON media_asset_locations(asset_id);

CREATE TABLE asset_revisions (
  asset_id TEXT NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  file_hash TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  width INTEGER NOT NULL CHECK(width > 0),
  height INTEGER NOT NULL CHECK(height > 0),
  rotation INTEGER NOT NULL,
  fps REAL NOT NULL CHECK(fps > 0),
  index_signature_hash TEXT NOT NULL,
  generation_key_hash TEXT NOT NULL,
  index_signature_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  worker_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('READY', 'FAILED')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, revision)
);

CREATE INDEX idx_asset_revisions_signature ON asset_revisions(index_signature_hash);
CREATE INDEX idx_asset_revisions_generation_key ON asset_revisions(generation_key_hash);

CREATE TABLE shots (
  shot_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK(end_ms > start_ms),
  quality_score REAL NOT NULL CHECK(quality_score >= 0 AND quality_score <= 1),
  analysis_status TEXT NOT NULL CHECK(analysis_status IN ('READY', 'FAILED')),
  FOREIGN KEY(asset_id, revision) REFERENCES asset_revisions(asset_id, revision) ON DELETE CASCADE
);

CREATE INDEX idx_shots_asset_revision ON shots(asset_id, revision, start_ms);

CREATE TABLE keyframes (
  keyframe_id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(shot_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('SAFE_EARLY', 'MIDPOINT', 'BEST_QUALITY')),
  timestamp_ms INTEGER NOT NULL CHECK(timestamp_ms >= 0),
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  quality_json TEXT NOT NULL
);

CREATE INDEX idx_keyframes_shot ON keyframes(shot_id);

CREATE TABLE visual_descriptors (
  shot_id TEXT PRIMARY KEY REFERENCES shots(shot_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL
);

CREATE TABLE embeddings (
  embedding_id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL UNIQUE REFERENCES shots(shot_id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  preprocess_version TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK(dimension > 0),
  dtype TEXT NOT NULL CHECK(dtype = 'float16'),
  normalized INTEGER NOT NULL CHECK(normalized = 1),
  vector_f16 BLOB NOT NULL,
  vector_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_embeddings_generation_key ON embeddings(model_id, model_version, preprocess_version);

CREATE TABLE index_generations (
  generation_id TEXT PRIMARY KEY,
  index_signature_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('BUILDING', 'READY', 'FAILED')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  cache_manifest_sha256 TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX idx_one_active_index_generation ON index_generations(active) WHERE active = 1;

CREATE TABLE index_generation_assets (
  generation_id TEXT NOT NULL REFERENCES index_generations(generation_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(generation_id, asset_id),
  FOREIGN KEY(asset_id, revision) REFERENCES asset_revisions(asset_id, revision)
);

CREATE TABLE media_index_jobs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  source_folder_id TEXT,
  profile TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE media_index_job_steps (
  job_id TEXT NOT NULL REFERENCES media_index_jobs(job_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(job_id, asset_id, revision, stage)
);
