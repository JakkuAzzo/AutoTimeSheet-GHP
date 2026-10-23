-- Off-site shifts remain separate from payroll clock and timesheet records.
CREATE TABLE IF NOT EXISTS offsite_clock_entries (
  entry_id TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  work_date TEXT NOT NULL,
  site TEXT NOT NULL CHECK (length(site) BETWEEN 1 AND 240),
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('clocked_in', 'awaiting_approval', 'approved', 'rejected')),
  decision_note TEXT NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000),
  decided_by_oid TEXT,
  decided_by_upn TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'clocked_in' AND clock_out_at IS NULL AND decided_at IS NULL AND decided_by_oid IS NULL AND decided_by_upn IS NULL)
    OR
    (status = 'awaiting_approval' AND clock_out_at IS NOT NULL AND decided_at IS NULL AND decided_by_oid IS NULL AND decided_by_upn IS NULL)
    OR
    (status IN ('approved', 'rejected') AND clock_out_at IS NOT NULL AND decided_at IS NOT NULL AND decided_by_oid IS NOT NULL AND decided_by_upn IS NOT NULL)
  )
);

-- An employee may have only one shift actively clocked in. Pending approval
-- and completed entries remain immutable from the employee clock endpoints.
CREATE UNIQUE INDEX IF NOT EXISTS idx_offsite_clock_one_active_per_owner
  ON offsite_clock_entries(owner_oid) WHERE status = 'clocked_in';
CREATE INDEX IF NOT EXISTS idx_offsite_clock_owner_recent
  ON offsite_clock_entries(owner_oid, clock_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_offsite_clock_pending
  ON offsite_clock_entries(status, clock_out_at ASC);

CREATE TABLE IF NOT EXISTS offsite_clock_audit (
  event_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES offsite_clock_entries(entry_id) ON DELETE RESTRICT,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'approve', 'reject')),
  previous_status TEXT NOT NULL DEFAULT '',
  next_status TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offsite_clock_audit_entry
  ON offsite_clock_audit(entry_id, occurred_at ASC);

CREATE TRIGGER IF NOT EXISTS offsite_clock_audit_no_update
BEFORE UPDATE ON offsite_clock_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS offsite_clock_audit_no_delete
BEFORE DELETE ON offsite_clock_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events cannot be deleted');
END;
