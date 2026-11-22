-- Preserve an ambiguous provider handoff for review without automatically resending.
-- Copy every existing row unchanged; no payroll record or receipt is altered.
CREATE TABLE dispatch_queue_uncertain_migration (
  record_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'completed', 'uncertain')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);
INSERT INTO dispatch_queue_uncertain_migration SELECT record_id,status,queued_at,updated_at,attempts,next_attempt_at,last_sent_at,last_error FROM dispatch_queue;
DROP TABLE dispatch_queue;
ALTER TABLE dispatch_queue_uncertain_migration RENAME TO dispatch_queue;
CREATE INDEX idx_dispatch_queue_due ON dispatch_queue(status, next_attempt_at);
-- Older failures do not record whether a request reached the provider. Hold
-- attempted pay-month handoffs for review rather than automatically replaying.
UPDATE dispatch_queue SET status='uncertain'
WHERE status='failed' AND attempts>0 AND EXISTS (
  SELECT 1 FROM records r WHERE r.record_id=dispatch_queue.record_id
    AND r.kind='timesheets' AND r.action='pay_month_correction'
);
