-- Existing queued generations have no source proof and remain held until
-- they are reviewed and queued again through the guarded path.
CREATE TABLE IF NOT EXISTS timesheet_queue_source_guards (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  owner_upn TEXT NOT NULL,
  owner_revision INTEGER NOT NULL,
  source_base64 TEXT NOT NULL
);
