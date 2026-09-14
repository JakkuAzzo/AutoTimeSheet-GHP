-- Customer enquiries use the protected records history so Accounts can review
-- the intake and append replies while preserving the original thread.
-- Rebuild the legacy CHECK constraint without changing existing record data.
PRAGMA foreign_keys=OFF;
CREATE TABLE records_with_enquiries (
  record_id TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('timesheets', 'clock', 'estimates', 'job-cards', 'calendar', 'tasks', 'audit', 'enquiries')),
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
INSERT INTO records_with_enquiries
  (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date, submitted_at, updated_at, issue, payload_json, created_at)
SELECT record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date, submitted_at, updated_at, issue, payload_json, created_at
FROM records;
DROP TABLE records;
ALTER TABLE records_with_enquiries RENAME TO records;
CREATE INDEX IF NOT EXISTS idx_records_owner ON records(owner_oid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(record_date, updated_at DESC);
PRAGMA foreign_keys=ON;
