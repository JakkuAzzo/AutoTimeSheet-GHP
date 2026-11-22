-- Permit a verified, fully completed delivery to release its queue slot.
-- Copy every existing row unchanged; no payroll record or receipt is altered.
CREATE TABLE dispatch_queue_completed_migration (
  record_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'completed')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);
INSERT INTO dispatch_queue_completed_migration SELECT record_id,status,queued_at,updated_at,attempts,next_attempt_at,last_sent_at,last_error FROM dispatch_queue;
DROP TABLE dispatch_queue;
ALTER TABLE dispatch_queue_completed_migration RENAME TO dispatch_queue;
CREATE INDEX idx_dispatch_queue_due ON dispatch_queue(status, next_attempt_at);
