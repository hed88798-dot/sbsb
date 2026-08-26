CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  target_object TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '',
  specification TEXT NOT NULL DEFAULT '',
  approved_scope TEXT NOT NULL DEFAULT '',
  usage TEXT NOT NULL DEFAULT '',
  contraindications_json TEXT NOT NULL DEFAULT '[]',
  selling_points_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  marketing_focus TEXT NOT NULL DEFAULT '',
  forbidden_claims_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  industry_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_aliases (
  alias_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  UNIQUE(product_id, normalized_alias)
);

CREATE INDEX idx_product_aliases_product_id ON product_aliases(product_id);
CREATE INDEX idx_product_aliases_normalized ON product_aliases(normalized_alias);

CREATE TABLE product_assets (
  asset_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  role TEXT NOT NULL CHECK(role IN ('MAIN', 'PACKAGING', 'DETAIL', 'OTHER')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(product_id, source_path)
);

CREATE INDEX idx_product_assets_product_id ON product_assets(product_id);

CREATE TABLE scripts (
  script_id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(product_id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE script_versions (
  script_id TEXT NOT NULL REFERENCES scripts(script_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  raw_model_output TEXT NOT NULL,
  result_status TEXT NOT NULL CHECK(result_status IN ('SUCCEEDED', 'REVIEW_REQUIRED')),
  fact_snapshot_json TEXT,
  fact_conflicts_json TEXT NOT NULL DEFAULT '[]',
  prompt_template_id TEXT NOT NULL,
  prompt_template_version TEXT NOT NULL,
  provider_alias TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  request_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(script_id, version)
);

CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  request_snapshot_hash TEXT NOT NULL
);

CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_state ON jobs(state);

CREATE TABLE copywriting_jobs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  fact_snapshot_json TEXT,
  script_id TEXT REFERENCES scripts(script_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_call_summaries (
  call_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  provider_alias TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  billed_units REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  error_code TEXT,
  request_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_provider_calls_job_id ON provider_call_summaries(job_id);

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

