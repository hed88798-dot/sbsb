CREATE TABLE licenses (
  license_id TEXT PRIMARY KEY,
  activation_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  device_limit INTEGER NOT NULL CHECK (device_limit > 0),
  monthly_budget REAL NOT NULL CHECK (monthly_budget >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('CNY', 'USD')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(license_id),
  public_key_pem TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX devices_license_idx ON devices(license_id);

CREATE TABLE refresh_credentials (
  credential_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  secret_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE access_tokens (
  token_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE replay_nonces (
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, nonce)
);

CREATE TABLE provider_jobs (
  job_id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(license_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  capability TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  provider_job_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
  estimated_cost REAL NOT NULL,
  final_cost REAL,
  currency TEXT NOT NULL CHECK (currency IN ('CNY','USD')),
  billed_units REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error_class TEXT,
  error_code TEXT,
  fallback_reason TEXT,
  result_artifacts_json TEXT NOT NULL DEFAULT '[]',
  result_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (license_id, request_id)
);
CREATE UNIQUE INDEX provider_jobs_remote_idx ON provider_jobs(provider, provider_job_id) WHERE provider_job_id IS NOT NULL;

CREATE TABLE cost_reservations (
  reservation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES provider_jobs(job_id),
  license_id TEXT NOT NULL REFERENCES licenses(license_id),
  amount REAL NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('CNY','USD')),
  state TEXT NOT NULL CHECK (state IN ('RESERVED','SETTLED','RELEASED','UNKNOWN')),
  created_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE TABLE usage_events (
  usage_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('RESERVATION','SETTLEMENT','RELEASE','STATE')),
  license_id TEXT NOT NULL REFERENCES licenses(license_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  request_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES provider_jobs(job_id),
  reservation_id TEXT REFERENCES cost_reservations(reservation_id),
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  capability TEXT NOT NULL,
  estimated_cost REAL NOT NULL,
  final_cost REAL,
  currency TEXT NOT NULL,
  billed_units REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  state TEXT NOT NULL,
  error_class TEXT,
  fallback_reason TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE (job_id, event_type)
);
CREATE INDEX usage_events_license_time_idx ON usage_events(license_id, occurred_at);

CREATE TABLE legal_allowlist (
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  capability TEXT NOT NULL,
  api_terms_version TEXT NOT NULL,
  model_code_license TEXT NOT NULL,
  model_weight_license TEXT NOT NULL,
  commercial_use INTEGER NOT NULL CHECK (commercial_use IN (0,1)),
  output_ownership TEXT NOT NULL,
  training_or_retention_policy TEXT NOT NULL,
  region_data_transfer TEXT NOT NULL,
  prohibited_content TEXT NOT NULL,
  attribution_requirement TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_model, capability)
);

CREATE TABLE object_refs (
  object_ref TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(license_id),
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PRESIGNED','UPLOADED','EXPIRED','DELETED')),
  created_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  provider_job_id TEXT NOT NULL,
  state TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE audit_events (
  audit_event_id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
