-- Provider receipts are append-only evidence tied to an existing protected
-- pay-month correction. They never change payroll records or dispatch state.
CREATE TABLE IF NOT EXISTS timesheet_delivery_receipts (
  receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  flow_run_id TEXT NOT NULL CHECK (length(flow_run_id) BETWEEN 1 AND 240),
  run_started_at TEXT NOT NULL CHECK (length(run_started_at) BETWEEN 20 AND 40),
  event_type TEXT NOT NULL CHECK (event_type IN ('flow_started', 'workbook_verified', 'flow_completed', 'flow_failed')),
  received_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (length(evidence_json) <= 32768 AND json_valid(evidence_json)),
  UNIQUE (record_id, flow_run_id, event_type),
  FOREIGN KEY (record_id) REFERENCES records(record_id)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_delivery_receipts_record_run
  ON timesheet_delivery_receipts(record_id, run_started_at DESC, received_at DESC, flow_run_id);

-- A run ID always refers to one provider start time, even when callbacks race.
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_receipts_consistent_run
BEFORE INSERT ON timesheet_delivery_receipts
WHEN EXISTS (
  SELECT 1 FROM timesheet_delivery_receipts existing
  WHERE existing.record_id = NEW.record_id
    AND existing.flow_run_id = NEW.flow_run_id
    AND existing.run_started_at <> NEW.run_started_at
)
BEGIN
  SELECT RAISE(ABORT, 'timesheet receipt run start time conflict');
END;

-- One provider run cannot be both completed and failed. A workbook can still
-- be verified before a later index action fails, so those events may coexist.
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_receipts_terminal_event
BEFORE INSERT ON timesheet_delivery_receipts
WHEN (NEW.event_type = 'flow_failed' AND EXISTS (
        SELECT 1 FROM timesheet_delivery_receipts existing
        WHERE existing.record_id = NEW.record_id
          AND existing.flow_run_id = NEW.flow_run_id
          AND existing.event_type = 'flow_completed'
      ))
  OR (NEW.event_type = 'flow_completed' AND EXISTS (
        SELECT 1 FROM timesheet_delivery_receipts existing
        WHERE existing.record_id = NEW.record_id
          AND existing.flow_run_id = NEW.flow_run_id
          AND existing.event_type = 'flow_failed'
      ))
BEGIN
  SELECT RAISE(ABORT, 'timesheet receipt terminal event conflict');
END;

-- Permit idempotent retries of an already-stored event, but never append a new
-- event after a run has completed or failed, even if callbacks race.
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_receipts_no_new_event_after_terminal
BEFORE INSERT ON timesheet_delivery_receipts
WHEN EXISTS (
  SELECT 1 FROM timesheet_delivery_receipts terminal
  WHERE terminal.record_id = NEW.record_id
    AND terminal.flow_run_id = NEW.flow_run_id
    AND terminal.event_type IN ('flow_completed', 'flow_failed')
)
AND NOT EXISTS (
  SELECT 1 FROM timesheet_delivery_receipts duplicate
  WHERE duplicate.record_id = NEW.record_id
    AND duplicate.flow_run_id = NEW.flow_run_id
    AND duplicate.event_type = NEW.event_type
)
BEGIN
  SELECT RAISE(ABORT, 'timesheet receipt terminal event conflict');
END;

CREATE TRIGGER IF NOT EXISTS timesheet_delivery_receipts_no_update
BEFORE UPDATE ON timesheet_delivery_receipts
BEGIN
  SELECT RAISE(ABORT, 'timesheet delivery receipts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS timesheet_delivery_receipts_no_delete
BEFORE DELETE ON timesheet_delivery_receipts
BEGIN
  SELECT RAISE(ABORT, 'timesheet delivery receipts are append-only');
END;
