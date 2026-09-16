-- Source-preserving historical reconciliation for Accounts timesheet repair.
-- The migration is idempotent for the new tables and is applied once to the
-- existing D1 records table before the generated seed is loaded.
CREATE TABLE IF NOT EXISTS reconciliation_sources (
  source_id TEXT PRIMARY KEY,
  source_message_key TEXT NOT NULL,
  source_message_id TEXT NOT NULL DEFAULT '',
  source_attachment_name TEXT NOT NULL,
  source_attachment_id TEXT NOT NULL,
  attachment_sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  employee_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  declared_start_date TEXT,
  declared_end_date TEXT,
  parse_status TEXT NOT NULL,
  issue TEXT,
  raw_row_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_sources_employee
  ON reconciliation_sources(employee_upn, declared_start_date, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_sources_message
  ON reconciliation_sources(source_message_key);

CREATE TABLE IF NOT EXISTS reconciliation_source_attachments (
  source_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  parse_status TEXT NOT NULL,
  PRIMARY KEY (source_id, attachment_id),
  FOREIGN KEY (source_id) REFERENCES reconciliation_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_source_attachments_hash
  ON reconciliation_source_attachments(sha256);

CREATE TABLE IF NOT EXISTS reconciliation_source_rows (
  source_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  record_id TEXT NOT NULL DEFAULT '',
  work_date TEXT,
  source_date TEXT,
  row_json TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  issue TEXT,
  PRIMARY KEY (source_id, row_index),
  FOREIGN KEY (source_id) REFERENCES reconciliation_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_source_rows_record
  ON reconciliation_source_rows(record_id, work_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_source_rows_date
  ON reconciliation_source_rows(work_date, selected);

ALTER TABLE records ADD COLUMN source_message_key TEXT;
ALTER TABLE records ADD COLUMN source_attachment_ids TEXT;
ALTER TABLE records ADD COLUMN reconciliation_key TEXT;
ALTER TABLE records ADD COLUMN source_variant_status TEXT;
ALTER TABLE records ADD COLUMN reconciled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_records_reconciliation
  ON records(reconciliation_key, employee_name, start_date);
