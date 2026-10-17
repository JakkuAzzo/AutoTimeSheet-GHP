PRAGMA foreign_keys = ON;

-- Submitted job-card files stay in the existing protected SharePoint library.
-- D1 keeps the server-derived pointer and resumable upload verification data.
CREATE TABLE IF NOT EXISTS job_card_attachment_upload_sessions (
  attachment_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(record_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  quick_xor_hash TEXT NOT NULL,
  expected_path TEXT,
  expires_at TEXT NOT NULL,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'complete', 'expired', 'duplicate')),
  duplicate_of TEXT,
  orphan_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_card_attachment_sessions_record
  ON job_card_attachment_upload_sessions(record_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_card_attachment_sessions_expiry
  ON job_card_attachment_upload_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS job_card_attachments (
  attachment_id TEXT PRIMARY KEY REFERENCES job_card_attachment_upload_sessions(attachment_id),
  record_id TEXT NOT NULL REFERENCES records(record_id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  quick_xor_hash TEXT NOT NULL,
  sharepoint_item_id TEXT NOT NULL UNIQUE,
  sharepoint_path TEXT NOT NULL,
  uploaded_by_oid TEXT NOT NULL,
  uploaded_by_upn TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  UNIQUE (record_id, file_name, sha256)
);

CREATE INDEX IF NOT EXISTS idx_job_card_attachments_record
  ON job_card_attachments(record_id, uploaded_at DESC, attachment_id);

CREATE TABLE IF NOT EXISTS job_card_attachment_audit (
  audit_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(record_id),
  attachment_id TEXT NOT NULL,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('uploaded')),
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_card_attachment_audit_upload
  ON job_card_attachment_audit(attachment_id, action);
CREATE INDEX IF NOT EXISTS idx_job_card_attachment_audit_record
  ON job_card_attachment_audit(record_id, created_at DESC);
