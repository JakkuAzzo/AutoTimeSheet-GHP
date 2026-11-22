-- Preserve the directory subject chosen for a timesheet address. A reused or
-- renamed address requires an explicit reconciliation before private filing.
CREATE TABLE IF NOT EXISTS private_timesheet_subjects (
  employee_upn TEXT PRIMARY KEY,
  employee_oid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS private_timesheet_subjects_no_update
BEFORE UPDATE ON private_timesheet_subjects
BEGIN SELECT RAISE(ABORT, 'private timesheet subject bindings are immutable'); END;

CREATE TRIGGER IF NOT EXISTS private_timesheet_subjects_no_delete
BEFORE DELETE ON private_timesheet_subjects
BEGIN SELECT RAISE(ABORT, 'private timesheet subject bindings are immutable'); END;
