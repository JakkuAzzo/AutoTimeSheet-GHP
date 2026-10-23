-- Extend actual off-site shifts with a single recorded lunch break and an
-- optional link to an approved plan. Planned bookings never count as hours.
ALTER TABLE offsite_clock_entries ADD COLUMN lunch_start_at TEXT;
ALTER TABLE offsite_clock_entries ADD COLUMN lunch_end_at TEXT;
ALTER TABLE offsite_clock_entries ADD COLUMN booking_id TEXT;

-- The v1 audit event constraint only named clock-in/out and decisions. Rebuild
-- it to admit immutable lunch actions while retaining all historical rows.
CREATE TABLE offsite_clock_audit_v2 (
  event_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES offsite_clock_entries(entry_id) ON DELETE RESTRICT,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'lunch_start', 'lunch_end', 'clock_out', 'approve', 'reject')),
  previous_status TEXT NOT NULL DEFAULT '',
  next_status TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
INSERT INTO offsite_clock_audit_v2
  (event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at)
SELECT event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at FROM offsite_clock_audit;
DROP TABLE offsite_clock_audit;
ALTER TABLE offsite_clock_audit_v2 RENAME TO offsite_clock_audit;
CREATE INDEX idx_offsite_clock_audit_entry ON offsite_clock_audit(entry_id, occurred_at ASC);
CREATE TRIGGER offsite_clock_audit_no_update
BEFORE UPDATE ON offsite_clock_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events are immutable');
END;
CREATE TRIGGER offsite_clock_audit_no_delete
BEFORE DELETE ON offsite_clock_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events cannot be deleted');
END;

CREATE TABLE offsite_bookings (
  booking_id TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  work_date TEXT NOT NULL CHECK (length(work_date) = 10),
  planned_start TEXT NOT NULL CHECK (length(planned_start) = 5),
  planned_end TEXT NOT NULL CHECK (length(planned_end) = 5),
  site TEXT NOT NULL CHECK (length(site) BETWEEN 1 AND 240),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval', 'approved', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  decision_note TEXT NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000),
  decided_by_oid TEXT,
  decided_by_upn TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (planned_end > planned_start),
  CHECK (
    (status = 'awaiting_approval' AND decided_at IS NULL AND decided_by_oid IS NULL AND decided_by_upn IS NULL)
    OR
    (status IN ('approved', 'rejected') AND decided_at IS NOT NULL AND decided_by_oid IS NOT NULL AND decided_by_upn IS NOT NULL)
  )
);

CREATE INDEX idx_offsite_bookings_owner ON offsite_bookings(owner_oid, work_date DESC, created_at DESC);
CREATE INDEX idx_offsite_bookings_pending ON offsite_bookings(status, work_date ASC, planned_start ASC);

CREATE TABLE offsite_booking_audit (
  event_id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES offsite_bookings(booking_id) ON DELETE RESTRICT,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('book', 'amend', 'approve', 'reject')),
  previous_status TEXT NOT NULL DEFAULT '',
  next_status TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_offsite_booking_audit_booking ON offsite_booking_audit(booking_id, occurred_at ASC);

CREATE TRIGGER offsite_booking_audit_no_update
BEFORE UPDATE ON offsite_booking_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site booking audit events are immutable');
END;

CREATE TRIGGER offsite_booking_audit_no_delete
BEFORE DELETE ON offsite_booking_audit
BEGIN
  SELECT RAISE(ABORT, 'Off-site booking audit events cannot be deleted');
END;
