-- Existing queued records have no complete attachment proof and stay held.
CREATE TABLE IF NOT EXISTS timesheet_queue_attachment_guards (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  manifest_json TEXT NOT NULL
);
