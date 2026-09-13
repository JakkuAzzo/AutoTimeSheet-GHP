-- GMT portal records. The owner columns are populated only from a verified
-- Microsoft Entra token by the Worker; they are never trusted from the browser.
CREATE TABLE IF NOT EXISTS records (
  record_id TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit')),
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  record_date TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  issue TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_records_owner ON records(owner_oid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(record_date, updated_at DESC);

CREATE TABLE IF NOT EXISTS record_versions (
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  owner_oid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by_oid TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_record_versions_record ON record_versions(record_id, changed_at DESC);

-- Corrections are queued in the protected Worker until the scheduled
-- FormSubmit dispatch. Attachments are kept with the record so the scheduled
-- job can send the same XLSX/CSV envelope that the browser sends for a new
-- submission. The queue is intentionally separate from the record status so
-- a retry never changes the user-owned record payload.
CREATE TABLE IF NOT EXISTS record_attachments (
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (record_id, field_name),
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dispatch_queue (
  record_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_queue_due ON dispatch_queue(status, next_attempt_at);
