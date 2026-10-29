-- GMT portal records. The owner columns are populated only from a verified
-- Microsoft Entra token by the Worker; they are never trusted from the browser.
CREATE TABLE IF NOT EXISTS records (
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
  source_message_key TEXT,
  source_attachment_ids TEXT,
  reconciliation_key TEXT,
  source_variant_status TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_records_owner ON records(owner_oid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_kind ON records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_date ON records(record_date, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_reconciliation ON records(reconciliation_key, employee_name, start_date);

CREATE TABLE IF NOT EXISTS record_versions (
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  owner_oid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by_oid TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_record_versions_record ON record_versions(record_id, changed_at DESC);

-- Corrections are queued in the protected Worker until the scheduled
-- FormSubmit dispatch. Attachments are kept with the record so the scheduled
-- job can send the same XLSX/CSV envelope that the browser sends for a new
-- submission. The queue is intentionally separate from the record status so
-- a retry never changes the user-owned record payload.
CREATE TABLE IF NOT EXISTS record_attachments (
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (record_id, field_name),
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dispatch_queue (
  record_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_queue_due ON dispatch_queue(status, next_attempt_at);

-- Xero OAuth state is short-lived and single-use. The state hash is stored so
-- a callback never needs to persist the browser's raw CSRF value.
CREATE TABLE IF NOT EXISTS xero_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  return_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_expiry ON xero_oauth_states(expires_at, consumed_at);

-- Refresh tokens are encrypted by the Worker before they are written. The
-- encryption key is a Worker secret and is never present in D1 or the Pages
-- bundle. One row per connected Xero organisation supports future tenant
-- selection while keeping the GMT Accounts connection explicit.
CREATE TABLE IF NOT EXISTS xero_connections (
  tenant_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE,
  tenant_name TEXT NOT NULL,
  tenant_type TEXT NOT NULL,
  scopes TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  connected_by_oid TEXT NOT NULL,
  connected_by_upn TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_xero_connections_updated ON xero_connections(updated_at DESC);

-- Refresh tokens can be shared across several Xero tenants. This short-lived
-- lease serializes token rotation across concurrent Worker requests.
CREATE TABLE IF NOT EXISTS xero_refresh_locks (
  token_hash TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL
);

-- Per-account GMT app settings. The Entra object ID is the stable owner key;
-- the sign-in address is retained only as the current displayable username.
-- The browser cache is a convenience and is never the source of truth.
CREATE TABLE IF NOT EXISTS profile_settings (
  owner_oid TEXT PRIMARY KEY,
  owner_upn TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  notification_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_settings_upn ON profile_settings(owner_upn);

-- Source-preserving historical reconciliation.  These tables retain every
-- mailbox bundle and parsed daily row, including exact duplicate retries and
-- excluded administrative identities.  The selected flag identifies the
-- version used for the calendar/pay-month projection; raw source rows remain
-- available for Accounts audit.
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

CREATE TABLE IF NOT EXISTS portal_access_assignments (
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('hr', 'xero', 'operations', 'job-card')),
  created_by_oid TEXT NOT NULL,
  created_by_upn TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_oid, role)
);
CREATE INDEX IF NOT EXISTS idx_portal_access_assignments_identity
  ON portal_access_assignments(owner_oid, owner_upn);
CREATE TABLE IF NOT EXISTS portal_access_audit (
  audit_id TEXT PRIMARY KEY,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  target_oid TEXT NOT NULL,
  target_upn TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hr', 'xero', 'operations', 'job-card')),
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  created_at TEXT NOT NULL
);

-- Dedicated off-site shifts never enter payroll clock/timesheet history.
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
BEFORE UPDATE ON offsite_clock_audit BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS offsite_clock_audit_no_delete
BEFORE DELETE ON offsite_clock_audit BEGIN
  SELECT RAISE(ABORT, 'Off-site clock audit events cannot be deleted');
END;

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
