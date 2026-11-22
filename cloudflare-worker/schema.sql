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
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped', 'completed', 'uncertain')),
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_sent_at TEXT,
  last_error TEXT,
  FOREIGN KEY (record_id) REFERENCES records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dispatch_queue_due ON dispatch_queue(status, next_attempt_at);

-- A queued pay-month generation is valid only for the local source revision
-- and exact JSON attachment captured in the same transaction as the queue.
CREATE TABLE IF NOT EXISTS timesheet_queue_source_guards (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  owner_upn TEXT NOT NULL,
  owner_revision INTEGER NOT NULL,
  source_base64 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_queue_attachment_guards (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  manifest_json TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS imported_invoice_records (
  record_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
  invoice_key TEXT NOT NULL, invoice_date TEXT NOT NULL, currency TEXT NOT NULL,
  total REAL NOT NULL, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL, payload_json TEXT NOT NULL, source_id TEXT NOT NULL,
  source_index INTEGER NOT NULL, source_name TEXT NOT NULL DEFAULT '',
  imported_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (tenant_id, invoice_key)
);
CREATE INDEX IF NOT EXISTS idx_imported_invoice_created ON imported_invoice_records(created_at DESC);
CREATE TABLE IF NOT EXISTS document_import_files (
  record_id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL,
  file_name TEXT NOT NULL, size_bytes INTEGER NOT NULL, sharepoint_item_id TEXT NOT NULL,
  sharepoint_path TEXT NOT NULL, sharing_url TEXT NOT NULL, filed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_owner_revisions (owner_upn TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS timesheet_revision_insert AFTER INSERT ON records WHEN NEW.kind IN ('timesheets','clock')
BEGIN INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(NEW.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER IF NOT EXISTS timesheet_revision_update AFTER UPDATE ON records WHEN OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')
BEGIN
  INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(OLD.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1;
  INSERT INTO timesheet_owner_revisions(owner_upn,revision) SELECT lower(NEW.owner_upn),1 WHERE lower(NEW.owner_upn)<>lower(OLD.owner_upn) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_revision_delete AFTER DELETE ON records WHEN OLD.kind IN ('timesheets','clock')
BEGIN INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(OLD.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END;
CREATE TABLE IF NOT EXISTS private_timesheet_folders (
  employee_oid TEXT PRIMARY KEY, folder_id TEXT NOT NULL UNIQUE,
  admin_group_oid TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS private_timesheet_subjects (
  employee_upn TEXT PRIMARY KEY, employee_oid TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS private_timesheet_subjects_no_update BEFORE UPDATE ON private_timesheet_subjects
BEGIN SELECT RAISE(ABORT, 'private timesheet subject bindings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_timesheet_subjects_no_delete BEFORE DELETE ON private_timesheet_subjects
BEGIN SELECT RAISE(ABORT, 'private timesheet subject bindings are immutable'); END;
CREATE TABLE IF NOT EXISTS private_timesheet_workbooks (
  employee_oid TEXT NOT NULL, pay_month TEXT NOT NULL, employee_folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('reserved','ready')),
  month_folder_id TEXT, workbook_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(employee_oid,pay_month),
  CHECK ((state='reserved' AND month_folder_id IS NULL AND workbook_id IS NULL)
      OR (state='ready' AND month_folder_id IS NOT NULL AND workbook_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS timesheet_delivery_routes (
  record_id TEXT NOT NULL, flow_run_id TEXT NOT NULL, run_started_at TEXT NOT NULL, generation TEXT NOT NULL,
  employee_folder_id TEXT NOT NULL, month_folder_id TEXT NOT NULL, workbook_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,flow_run_id), UNIQUE(record_id,generation), FOREIGN KEY(record_id) REFERENCES records(record_id)
);
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_routes_no_update BEFORE UPDATE ON timesheet_delivery_routes
BEGIN SELECT RAISE(ABORT, 'timesheet delivery routes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_routes_no_delete BEFORE DELETE ON timesheet_delivery_routes
BEGIN SELECT RAISE(ABORT, 'timesheet delivery routes are append-only'); END;
-- Foundation only: these records confer no access until authenticated, snapshot-
-- bound authorization is implemented on every relevant route. Never put
-- timesheet payloads or attachments in this audit.
CREATE TABLE IF NOT EXISTS timesheet_review_record_revisions (
  record_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0)
);
INSERT INTO timesheet_review_record_revisions(record_id, revision)
SELECT record_id, 1 FROM records WHERE kind = 'timesheets'
ON CONFLICT(record_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS timesheet_ownership_reviews (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  record_revision INTEGER NOT NULL CHECK (record_revision > 0),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  subject_oid TEXT NOT NULL CHECK (length(trim(subject_oid)) > 0),
  reviewer_oid TEXT NOT NULL CHECK (length(trim(reviewer_oid)) > 0),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) > 0),
  reviewed_at TEXT NOT NULL CHECK (length(trim(reviewed_at)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_ownership_reviews_record ON timesheet_ownership_reviews(record_id, record_revision);
CREATE TABLE IF NOT EXISTS timesheet_ownership_review_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES timesheet_ownership_reviews(review_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('adopted', 'revoked', 'invalidated')),
  actor_oid TEXT NOT NULL CHECK (length(trim(actor_oid)) > 0),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_ownership_review_events_review ON timesheet_ownership_review_events(review_id, event_type);
CREATE TRIGGER IF NOT EXISTS timesheet_review_validate BEFORE INSERT ON timesheet_ownership_reviews
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM records r JOIN timesheet_review_record_revisions v ON v.record_id = r.record_id
    WHERE r.record_id = NEW.record_id AND r.kind = 'timesheets' AND r.status <> 'Deleted' AND v.revision = NEW.record_revision
  ) THEN RAISE(ABORT, 'record revision is stale or unavailable') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=NEW.record_id AND q.status IN ('sending','sent','failed','uncertain'))
    THEN RAISE(ABORT, 'workbook delivery needs reconciliation') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM timesheet_ownership_reviews review
    WHERE review.record_id = NEW.record_id
      AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id = review.review_id AND e.event_type IN ('revoked','invalidated'))
  ) THEN RAISE(ABORT, 'active review already exists') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_adopted AFTER INSERT ON timesheet_ownership_reviews
BEGIN
  INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at)
  VALUES(NEW.review_id,'adopted',NEW.reviewer_oid,NEW.reviewed_at);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_revoke_validate BEFORE INSERT ON timesheet_ownership_review_events
WHEN NEW.event_type = 'revoked'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM timesheet_ownership_reviews review JOIN timesheet_review_record_revisions v ON v.record_id = review.record_id
    JOIN records r ON r.record_id = review.record_id
    WHERE review.review_id = NEW.review_id AND review.record_revision = v.revision AND r.kind = 'timesheets' AND r.status <> 'Deleted'
      AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id = review.review_id AND e.event_type IN ('revoked','invalidated'))
  ) THEN RAISE(ABORT, 'review is not active') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_no_update BEFORE UPDATE ON timesheet_ownership_reviews BEGIN SELECT RAISE(ABORT,'review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_no_delete BEFORE DELETE ON timesheet_ownership_reviews BEGIN SELECT RAISE(ABORT,'review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_event_no_update BEFORE UPDATE ON timesheet_ownership_review_events BEGIN SELECT RAISE(ABORT,'review event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_event_no_delete BEFORE DELETE ON timesheet_ownership_review_events BEGIN SELECT RAISE(ABORT,'review event is immutable'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_review_revision_insert AFTER INSERT ON records WHEN NEW.kind = 'timesheets'
BEGIN
  INSERT INTO timesheet_review_record_revisions(record_id,revision) VALUES(NEW.record_id,1)
  ON CONFLICT(record_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_revision_update AFTER UPDATE ON records WHEN OLD.kind = 'timesheets' OR NEW.kind = 'timesheets'
BEGIN
  INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at)
  SELECT review.review_id,'invalidated','system:record-change',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM timesheet_ownership_reviews review WHERE review.record_id=OLD.record_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'));
  INSERT INTO timesheet_review_record_revisions(record_id,revision) VALUES(NEW.record_id,1)
  ON CONFLICT(record_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_review_revision_delete AFTER DELETE ON records WHEN OLD.kind = 'timesheets'
BEGIN
  INSERT INTO timesheet_ownership_review_events(review_id,event_type,actor_oid,occurred_at)
  SELECT review.review_id,'invalidated','system:record-deletion',strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM timesheet_ownership_reviews review WHERE review.record_id=OLD.record_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'));
  INSERT INTO timesheet_review_record_revisions(record_id,revision) VALUES(OLD.record_id,1)
  ON CONFLICT(record_id) DO UPDATE SET revision=revision+1;
END;

-- Source review foundation only. A row does not grant access until a trusted
-- caller re-reads the exact provider item and verifies both its tag and hash.
-- Do not store timesheet content or personal source files in this audit trail.
CREATE TABLE IF NOT EXISTS timesheet_source_reviews (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL CHECK (length(trim(site_id)) BETWEEN 1 AND 500),
  list_id TEXT NOT NULL CHECK (length(trim(list_id)) BETWEEN 1 AND 120),
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) BETWEEN 1 AND 120),
  source_etag TEXT NOT NULL CHECK (length(trim(source_etag)) BETWEEN 1 AND 500),
  fields_sha256 TEXT NOT NULL CHECK (length(fields_sha256)=64 AND fields_sha256 NOT GLOB '*[^0-9a-f]*'),
  subject_oid TEXT NOT NULL CHECK (length(trim(subject_oid)) BETWEEN 1 AND 120),
  subject_upn TEXT NOT NULL CHECK (length(trim(subject_upn)) BETWEEN 1 AND 320),
  reviewer_oid TEXT NOT NULL CHECK (length(trim(reviewer_oid)) BETWEEN 1 AND 120),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 180),
  reviewed_at TEXT NOT NULL CHECK (length(trim(reviewed_at)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_reviews_item ON timesheet_source_reviews(site_id,list_id,item_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_reviews_subject ON timesheet_source_reviews(subject_oid);
CREATE TABLE IF NOT EXISTS timesheet_source_review_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES timesheet_source_reviews(review_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('adopted','revoked')),
  actor_oid TEXT NOT NULL CHECK (length(trim(actor_oid)) BETWEEN 1 AND 120),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_review_events_review ON timesheet_source_review_events(review_id,event_type);
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_validate BEFORE INSERT ON timesheet_source_reviews
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM timesheet_source_reviews review
    WHERE review.site_id=NEW.site_id AND review.list_id=NEW.list_id AND review.item_id=NEW.item_id
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'active source review already exists') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_adopted AFTER INSERT ON timesheet_source_reviews
BEGIN
  INSERT INTO timesheet_source_review_events(review_id,event_type,actor_oid,occurred_at)
  VALUES(NEW.review_id,'adopted',NEW.reviewer_oid,NEW.reviewed_at);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_revoke_validate BEFORE INSERT ON timesheet_source_review_events
WHEN NEW.event_type='revoked'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM timesheet_source_reviews review WHERE review.review_id=NEW.review_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=review.review_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'source review is not active') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_no_update BEFORE UPDATE ON timesheet_source_reviews BEGIN SELECT RAISE(ABORT,'source review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_no_delete BEFORE DELETE ON timesheet_source_reviews BEGIN SELECT RAISE(ABORT,'source review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_event_no_update BEFORE UPDATE ON timesheet_source_review_events BEGIN SELECT RAISE(ABORT,'source review event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_review_event_no_delete BEFORE DELETE ON timesheet_source_review_events BEGIN SELECT RAISE(ABORT,'source review event is immutable'); END;
-- A reviewer may classify an exact current source as not containing a
-- timesheet. This is audit evidence, not access or delivery authorisation.
CREATE TABLE IF NOT EXISTS timesheet_source_exclusions (
  exclusion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL CHECK (length(trim(site_id)) BETWEEN 1 AND 500),
  list_id TEXT NOT NULL CHECK (length(trim(list_id)) BETWEEN 1 AND 120),
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) BETWEEN 1 AND 120),
  source_etag TEXT NOT NULL CHECK (length(trim(source_etag)) BETWEEN 1 AND 500),
  fields_sha256 TEXT NOT NULL CHECK (length(fields_sha256)=64 AND fields_sha256 NOT GLOB '*[^0-9a-f]*'),
  reviewer_oid TEXT NOT NULL CHECK (length(trim(reviewer_oid)) BETWEEN 1 AND 120),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 180),
  reviewed_at TEXT NOT NULL CHECK (length(trim(reviewed_at)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_exclusions_item ON timesheet_source_exclusions(site_id,list_id,item_id);
CREATE TABLE IF NOT EXISTS timesheet_source_exclusion_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  exclusion_id INTEGER NOT NULL REFERENCES timesheet_source_exclusions(exclusion_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('adopted','revoked')),
  actor_oid TEXT NOT NULL CHECK (length(trim(actor_oid)) BETWEEN 1 AND 120),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_exclusion_events_exclusion ON timesheet_source_exclusion_events(exclusion_id,event_type);
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_validate BEFORE INSERT ON timesheet_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM timesheet_source_exclusions x WHERE x.site_id=NEW.site_id AND x.list_id=NEW.list_id AND x.item_id=NEW.item_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked'))
    OR EXISTS (SELECT 1 FROM timesheet_source_reviews r WHERE r.site_id=NEW.site_id AND r.list_id=NEW.list_id AND r.item_id=NEW.item_id
      AND NOT EXISTS (SELECT 1 FROM timesheet_source_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'active source classification already exists') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_owner_exclusion_validate BEFORE INSERT ON timesheet_source_reviews
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM timesheet_source_exclusions x WHERE x.site_id=NEW.site_id AND x.list_id=NEW.list_id AND x.item_id=NEW.item_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'active source classification already exists') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_adopted AFTER INSERT ON timesheet_source_exclusions
BEGIN
  INSERT INTO timesheet_source_exclusion_events(exclusion_id,event_type,actor_oid,occurred_at) VALUES(NEW.exclusion_id,'adopted',NEW.reviewer_oid,NEW.reviewed_at);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_revoke_validate BEFORE INSERT ON timesheet_source_exclusion_events
WHEN NEW.event_type='revoked'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM timesheet_source_exclusions x WHERE x.exclusion_id=NEW.exclusion_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_exclusion_events e WHERE e.exclusion_id=x.exclusion_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'source classification is not active') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_no_update BEFORE UPDATE ON timesheet_source_exclusions BEGIN SELECT RAISE(ABORT,'source classification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_no_delete BEFORE DELETE ON timesheet_source_exclusions BEGIN SELECT RAISE(ABORT,'source classification is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_event_no_update BEFORE UPDATE ON timesheet_source_exclusion_events BEGIN SELECT RAISE(ABORT,'source classification event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_exclusion_event_no_delete BEFORE DELETE ON timesheet_source_exclusion_events BEGIN SELECT RAISE(ABORT,'source classification event is immutable'); END;
-- Independent review of a specific historical source version. This audit
-- grants no access or delivery authority and never stores source contents.
CREATE TABLE IF NOT EXISTS timesheet_source_version_reviews (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL CHECK (length(trim(site_id)) BETWEEN 1 AND 500),
  list_id TEXT NOT NULL CHECK (length(trim(list_id)) BETWEEN 1 AND 120),
  item_id TEXT NOT NULL CHECK (length(trim(item_id)) BETWEEN 1 AND 120),
  version_id TEXT NOT NULL CHECK (length(trim(version_id)) BETWEEN 1 AND 80),
  fields_sha256 TEXT NOT NULL CHECK (length(fields_sha256)=64 AND fields_sha256 NOT GLOB '*[^0-9a-f]*'),
  classification TEXT NOT NULL CHECK (classification IN ('employee','not_timesheet')),
  subject_oid TEXT,
  subject_upn TEXT,
  reviewer_oid TEXT NOT NULL CHECK (length(trim(reviewer_oid)) BETWEEN 1 AND 120),
  evidence_reference TEXT NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 180),
  reviewed_at TEXT NOT NULL CHECK (length(trim(reviewed_at)) BETWEEN 1 AND 100),
  CHECK ((classification='employee' AND subject_oid IS NOT NULL AND length(trim(subject_oid)) BETWEEN 1 AND 120 AND subject_upn IS NOT NULL AND length(trim(subject_upn)) BETWEEN 1 AND 320)
    OR (classification='not_timesheet' AND subject_oid IS NULL AND subject_upn IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_version_review_item ON timesheet_source_version_reviews(site_id,list_id,item_id,version_id);
CREATE TABLE IF NOT EXISTS timesheet_source_version_review_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES timesheet_source_version_reviews(review_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('adopted','revoked')),
  actor_oid TEXT NOT NULL CHECK (length(trim(actor_oid)) BETWEEN 1 AND 120),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) BETWEEN 1 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_timesheet_source_version_event_review ON timesheet_source_version_review_events(review_id,event_type);
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_review_validate BEFORE INSERT ON timesheet_source_version_reviews
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM timesheet_source_version_reviews r WHERE r.site_id=NEW.site_id AND r.list_id=NEW.list_id AND r.item_id=NEW.item_id AND r.version_id=NEW.version_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'active source version review already exists') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_review_adopted AFTER INSERT ON timesheet_source_version_reviews
BEGIN
  INSERT INTO timesheet_source_version_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(NEW.review_id,'adopted',NEW.reviewer_oid,NEW.reviewed_at);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_review_revoke_validate BEFORE INSERT ON timesheet_source_version_review_events
WHEN NEW.event_type='revoked'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM timesheet_source_version_reviews r WHERE r.review_id=NEW.review_id
    AND NOT EXISTS (SELECT 1 FROM timesheet_source_version_review_events e WHERE e.review_id=r.review_id AND e.event_type='revoked'))
    THEN RAISE(ABORT,'source version review is not active') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_review_no_update BEFORE UPDATE ON timesheet_source_version_reviews BEGIN SELECT RAISE(ABORT,'source version review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_review_no_delete BEFORE DELETE ON timesheet_source_version_reviews BEGIN SELECT RAISE(ABORT,'source version review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_event_no_update BEFORE UPDATE ON timesheet_source_version_review_events BEGIN SELECT RAISE(ABORT,'source version review event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_source_version_event_no_delete BEFORE DELETE ON timesheet_source_version_review_events BEGIN SELECT RAISE(ABORT,'source version review event is immutable'); END;

-- While a provider request is in flight, protect the local source snapshot
-- and queued attachments. Other employees and non-timesheet work remain open.
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn)=lower(NEW.owner_upn) OR lower(delivery.owner_oid)=lower(NEW.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn) IN (lower(OLD.owner_upn),lower(NEW.owner_upn)) OR lower(delivery.owner_oid) IN (lower(OLD.owner_oid),lower(NEW.owner_oid))))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn)=lower(OLD.owner_upn) OR lower(delivery.owner_oid)=lower(OLD.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=NEW.record_id AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id IN (OLD.record_id,NEW.record_id) AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=OLD.record_id AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  LEFT JOIN records source ON source.record_id=NEW.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_oid)=lower(NEW.subject_oid) OR lower(delivery.owner_upn)=lower(source.owner_upn)
      OR lower(delivery.owner_oid)=lower(source.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TABLE IF NOT EXISTS pay_month_start_settings (
  month_key TEXT PRIMARY KEY,
  start_date TEXT NOT NULL UNIQUE,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(month_key) = 7 AND substr(month_key, 5, 1) = '-'),
  CHECK (length(start_date) = 10 AND substr(start_date, 5, 1) = '-' AND substr(start_date, 8, 1) = '-')
);

CREATE TABLE IF NOT EXISTS pay_month_start_audit (
  audit_id TEXT PRIMARY KEY,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  month_key TEXT NOT NULL,
  old_start_date TEXT NOT NULL,
  new_start_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_month_start_audit_month_created
  ON pay_month_start_audit(month_key, created_at DESC);

-- A routed run can still write a workbook after the email handoff. Keep its
-- local source stable until the queue has a verified completed transition.
CREATE TRIGGER IF NOT EXISTS timesheet_write_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn)=lower(NEW.owner_upn) OR lower(delivery.owner_oid)=lower(NEW.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn) IN (lower(OLD.owner_upn),lower(NEW.owner_upn)) OR lower(delivery.owner_oid) IN (lower(OLD.owner_oid),lower(NEW.owner_oid)))
    AND NOT (OLD.record_id=q.record_id AND NEW.record_id IS OLD.record_id AND OLD.status='Queued for Accounts'
      AND NEW.owner_oid IS OLD.owner_oid AND NEW.owner_upn IS OLD.owner_upn AND NEW.employee_name IS OLD.employee_name
      AND NEW.kind IS OLD.kind AND NEW.action IS OLD.action AND NEW.start_date IS OLD.start_date AND NEW.end_date IS OLD.end_date
      AND NEW.record_date IS OLD.record_date AND NEW.submitted_at IS OLD.submitted_at AND NEW.payload_json IS OLD.payload_json
      AND NEW.source_message_key IS OLD.source_message_key AND NEW.source_attachment_ids IS OLD.source_attachment_ids
      AND NEW.reconciliation_key IS OLD.reconciliation_key AND NEW.source_variant_status IS OLD.source_variant_status
      AND NEW.reconciled_at IS OLD.reconciled_at AND NEW.created_at IS OLD.created_at
      AND NEW.updated_at IS q.updated_at AND ((q.status='sent' AND NEW.status='Sent to Accounts') OR
        (q.status='failed' AND NEW.status='Delivery failed') OR (q.status='uncertain' AND NEW.status='Delivery needs review'))))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn)=lower(OLD.owner_upn) OR lower(delivery.owner_oid)=lower(OLD.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=NEW.record_id AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id IN (OLD.record_id,NEW.record_id) AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=OLD.record_id AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id LEFT JOIN records source ON source.record_id=NEW.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_oid)=lower(NEW.subject_oid) OR lower(delivery.owner_upn)=lower(source.owner_upn) OR lower(delivery.owner_oid)=lower(source.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_period_insert BEFORE INSERT ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_period_update BEFORE UPDATE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_period_delete BEFORE DELETE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

-- Pending filing evidence only. This does not authorise employee access,
-- validate document contents, or establish independent source review.
CREATE TABLE IF NOT EXISTS timesheet_original_filing_intents (
  intent_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(record_id),
  employee_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  owner_revision INTEGER NOT NULL CHECK(owner_revision>=0),
  dates_json TEXT NOT NULL CHECK(json_valid(dates_json) AND json_type(dates_json)='array' AND json_array_length(dates_json) BETWEEN 1 AND 62),
  actor_oid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_original_filing_revocations (
  intent_id TEXT PRIMARY KEY REFERENCES timesheet_original_filing_intents(intent_id),
  actor_oid TEXT NOT NULL,
  revoked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_private_originals (
  intent_id TEXT PRIMARY KEY REFERENCES timesheet_original_filing_intents(intent_id),
  record_id TEXT NOT NULL REFERENCES records(record_id),
  employee_oid TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_etag TEXT NOT NULL,
  file_name TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK(review_state='pending'),
  filed_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS timesheet_original_intent_no_update BEFORE UPDATE ON timesheet_original_filing_intents BEGIN SELECT RAISE(ABORT,'filing intent is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_intent_no_delete BEFORE DELETE ON timesheet_original_filing_intents BEGIN SELECT RAISE(ABORT,'filing intent is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_revocation_no_update BEFORE UPDATE ON timesheet_original_filing_revocations BEGIN SELECT RAISE(ABORT,'filing revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_revocation_no_delete BEFORE DELETE ON timesheet_original_filing_revocations BEGIN SELECT RAISE(ABORT,'filing revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_proof_no_update BEFORE UPDATE ON timesheet_private_originals BEGIN SELECT RAISE(ABORT,'private original proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_proof_no_delete BEFORE DELETE ON timesheet_private_originals BEGIN SELECT RAISE(ABORT,'private original proof is immutable'); END;
-- A correction that ever contained uploaded source evidence remains held
-- until a future independent review and release mechanism exists.
CREATE TABLE IF NOT EXISTS timesheet_import_source_holds (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id),
  first_seen_at TEXT NOT NULL
);
INSERT OR IGNORE INTO timesheet_import_source_holds(record_id,first_seen_at)
SELECT r.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM records r
WHERE r.kind='timesheets' AND r.action='pay_month_correction' AND (
  EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END,'$.rows') row
    WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
  OR EXISTS(SELECT 1 FROM record_versions v, json_each(CASE WHEN json_valid(v.payload_json) THEN v.payload_json ELSE '{}' END,'$.payload.rows') row
    WHERE v.record_id=r.record_id AND row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
);
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_insert AFTER INSERT ON records
WHEN NEW.kind='timesheets' AND NEW.action='pay_month_correction' AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
  WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
BEGIN INSERT OR IGNORE INTO timesheet_import_source_holds VALUES(NEW.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_update AFTER UPDATE ON records
WHEN NEW.kind='timesheets' AND NEW.action='pay_month_correction' AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
  WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
BEGIN INSERT OR IGNORE INTO timesheet_import_source_holds VALUES(NEW.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_no_update BEFORE UPDATE ON timesheet_import_source_holds BEGIN SELECT RAISE(ABORT,'source hold is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_no_delete BEFORE DELETE ON timesheet_import_source_holds BEGIN SELECT RAISE(ABORT,'source hold is immutable'); END;
-- Preserve the original employee and dates of standalone imported days, so
-- later edits cannot silently remove their review hold from a pay month.
CREATE TABLE IF NOT EXISTS timesheet_import_source_days (
  record_id TEXT NOT NULL, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL,
  source_day TEXT NOT NULL, PRIMARY KEY(record_id,owner_oid,owner_upn,source_day)
);
WITH snapshots AS (
  SELECT r.record_id,lower(COALESCE(r.owner_oid,'')) oid,lower(COALESCE(r.owner_upn,'')) upn,
    CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END payload
  FROM records r WHERE r.kind='timesheets' AND r.action<>'pay_month_correction'
  UNION ALL
  SELECT r.record_id,lower(COALESCE(v.owner_oid,r.owner_oid,'')),lower(COALESCE(r.owner_upn,'')),
    COALESCE(json_extract(CASE WHEN json_valid(v.payload_json) THEN v.payload_json ELSE '{}' END,'$.payload'),'{}')
  FROM records r JOIN record_versions v ON v.record_id=r.record_id WHERE r.kind='timesheets' AND r.action<>'pay_month_correction'
), sourced AS (
  SELECT * FROM snapshots WHERE json_valid(payload) AND COALESCE(CAST(json_extract(payload,'$.importSourceId') AS TEXT),'')<>''
)
INSERT OR IGNORE INTO timesheet_import_source_days(record_id,owner_oid,owner_upn,source_day)
SELECT s.record_id,s.oid,s.upn,CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
FROM sourced s JOIN json_each(s.payload,'$.rows') row
UNION ALL SELECT s.record_id,s.oid,s.upn,'*' FROM sourced s WHERE NOT EXISTS(SELECT 1 FROM json_each(s.payload,'$.rows'));
INSERT OR IGNORE INTO timesheet_import_source_days(record_id,owner_oid,owner_upn,source_day)
SELECT r.record_id,lower(COALESCE(r.owner_oid,'')),lower(COALESCE(r.owner_upn,'')),'*' FROM records r
WHERE r.kind='timesheets' AND r.action<>'pay_month_correction' AND r.record_id LIKE 'document-import-%'
  AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=r.record_id);
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_insert AFTER INSERT ON records WHEN NEW.kind='timesheets' AND NEW.action<>'pay_month_correction'
BEGIN
 INSERT OR IGNORE INTO timesheet_import_source_days
 SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
 WHERE COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'';
 INSERT OR IGNORE INTO timesheet_import_source_days SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),'*'
 WHERE (NEW.record_id LIKE 'document-import-%' OR COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'')
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=NEW.record_id);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_update AFTER UPDATE ON records WHEN NEW.kind='timesheets' AND NEW.action<>'pay_month_correction'
BEGIN
 INSERT OR IGNORE INTO timesheet_import_source_days
 SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
 WHERE COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'';
 INSERT OR IGNORE INTO timesheet_import_source_days SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),'*'
 WHERE (NEW.record_id LIKE 'document-import-%' OR COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'')
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=NEW.record_id);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_no_update BEFORE UPDATE ON timesheet_import_source_days BEGIN SELECT RAISE(ABORT,'source day hold is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_no_delete BEFORE DELETE ON timesheet_import_source_days BEGIN SELECT RAISE(ABORT,'source day hold is immutable'); END;
-- The same bytes in the same private vault may be created at most once until
-- an operator explicitly reconciles an uncertain attempt. A different file
-- extension or a new intent cannot bypass the reservation.
CREATE TABLE IF NOT EXISTS timesheet_original_create_reservations (
  vault_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  intent_id TEXT NOT NULL REFERENCES timesheet_original_filing_intents(intent_id),
  record_id TEXT NOT NULL REFERENCES records(record_id),
  file_name TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  PRIMARY KEY(vault_id,source_sha256)
);
CREATE TRIGGER IF NOT EXISTS timesheet_original_create_reservations_no_update BEFORE UPDATE ON timesheet_original_create_reservations BEGIN SELECT RAISE(ABORT,'original create reservation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_create_reservations_no_delete BEFORE DELETE ON timesheet_original_create_reservations BEGIN SELECT RAISE(ABORT,'original create reservation is immutable'); END;
-- A source review is evidence only; it does not release a workbook hold.
CREATE TABLE IF NOT EXISTS timesheet_private_original_reviews (
  review_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES timesheet_original_filing_intents(intent_id),
  record_id TEXT NOT NULL REFERENCES records(record_id),
  employee_oid TEXT NOT NULL, owner_upn TEXT NOT NULL, owner_revision INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL, source_sha256 TEXT NOT NULL, dates_json TEXT NOT NULL,
  vault_id TEXT NOT NULL, item_id TEXT NOT NULL, item_etag TEXT NOT NULL, file_name TEXT NOT NULL,
  reviewer_oid TEXT NOT NULL, reviewed_at TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision='rows_match')
);
CREATE INDEX IF NOT EXISTS idx_private_original_review_intent ON timesheet_private_original_reviews(intent_id);
CREATE TABLE IF NOT EXISTS timesheet_private_original_review_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL REFERENCES timesheet_private_original_reviews(review_id),
  event_type TEXT NOT NULL CHECK(event_type IN ('adopted','revoked')),
  actor_oid TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS private_original_review_adopted AFTER INSERT ON timesheet_private_original_reviews
BEGIN INSERT INTO timesheet_private_original_review_events(review_id,event_type,actor_oid,occurred_at) VALUES(NEW.review_id,'adopted',NEW.reviewer_oid,NEW.reviewed_at); END;
CREATE TRIGGER IF NOT EXISTS private_original_review_no_update BEFORE UPDATE ON timesheet_private_original_reviews BEGIN SELECT RAISE(ABORT,'private source review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_original_review_no_delete BEFORE DELETE ON timesheet_private_original_reviews BEGIN SELECT RAISE(ABORT,'private source review is immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_original_review_event_no_update BEFORE UPDATE ON timesheet_private_original_review_events BEGIN SELECT RAISE(ABORT,'private source review event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS private_original_review_event_no_delete BEFORE DELETE ON timesheet_private_original_review_events BEGIN SELECT RAISE(ABORT,'private source review event is immutable'); END;

-- Internal source-bound publication foundation; no public route is enabled.
CREATE TABLE IF NOT EXISTS timesheet_publication_scopes (
  subject_oid TEXT NOT NULL, subject_upn TEXT NOT NULL, pay_month TEXT NOT NULL, cycle_start TEXT NOT NULL, cycle_end TEXT NOT NULL,
  record_id TEXT NOT NULL, record_owner_oid TEXT NOT NULL, record_owner_upn TEXT NOT NULL, payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, source_base64 TEXT NOT NULL, generation TEXT NOT NULL,
  owner_revision INTEGER NOT NULL, subject_revision INTEGER NOT NULL, record_revision INTEGER NOT NULL, review_watermark INTEGER NOT NULL, period_settings_json TEXT NOT NULL,
  desired_revision INTEGER NOT NULL CHECK(desired_revision>0),
  published_revision INTEGER, published_generation TEXT, published_drive_id TEXT, published_item_id TEXT, published_etag TEXT,
  PRIMARY KEY(subject_oid,pay_month)
);
CREATE TABLE IF NOT EXISTS timesheet_publication_candidates (
  subject_oid TEXT NOT NULL, pay_month TEXT NOT NULL, revision INTEGER NOT NULL,
  generation TEXT NOT NULL, drive_id TEXT NOT NULL, item_id TEXT NOT NULL, etag TEXT NOT NULL,
  UNIQUE(drive_id,item_id),
  PRIMARY KEY(subject_oid,pay_month,revision)
);
CREATE TRIGGER IF NOT EXISTS timesheet_publication_candidates_no_update BEFORE UPDATE ON timesheet_publication_candidates BEGIN SELECT RAISE(ABORT,'publication candidate is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_candidates_no_delete BEFORE DELETE ON timesheet_publication_candidates BEGIN SELECT RAISE(ABORT,'publication candidate is immutable'); END;

-- A correction may have been saved by Accounts on behalf of an employee.
-- Keep both the reviewed employee's records and their known on-behalf sources
-- stable while a routed workbook can still be written. Keep historical review
-- subjects in this hold even if a decision is revoked during the handoff;
-- revocation itself remains possible and invalidates publication separately.
CREATE VIEW IF NOT EXISTS timesheet_reviewed_locked_subjects AS
SELECT DISTINCT q.record_id AS delivery_record_id, lower(review.subject_oid) AS subject_oid,
       lower(subject.employee_upn) AS subject_upn
FROM dispatch_queue q
JOIN records delivery ON delivery.record_id=q.record_id
JOIN timesheet_ownership_reviews review ON review.record_id=q.record_id
LEFT JOIN private_timesheet_subjects subject ON lower(subject.employee_oid)=lower(review.subject_oid)
WHERE delivery.kind='timesheets' AND delivery.action='pay_month_correction'
  AND (q.status='sending' OR (q.status IN ('sent','failed','uncertain')
    AND EXISTS (SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)));

CREATE VIEW IF NOT EXISTS timesheet_reviewed_locked_source_records AS
SELECT DISTINCT source.record_id
FROM records source JOIN timesheet_reviewed_locked_subjects locked
WHERE source.kind IN ('timesheets','clock') AND (
  lower(source.owner_oid)=locked.subject_oid OR lower(source.owner_upn)=locked.subject_upn OR
  EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
          WHERE review.record_id=source.record_id AND lower(review.subject_oid)=locked.subject_oid));

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_subjects locked
  WHERE lower(NEW.owner_oid)=locked.subject_oid OR lower(NEW.owner_upn)=locked.subject_upn)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_subjects locked
  WHERE OLD.record_id<>locked.delivery_record_id AND (
    lower(OLD.owner_oid)=locked.subject_oid OR lower(NEW.owner_oid)=locked.subject_oid OR
    lower(OLD.owner_upn)=locked.subject_upn OR lower(NEW.owner_upn)=locked.subject_upn OR
    EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
      WHERE review.record_id=OLD.record_id AND lower(review.subject_oid)=locked.subject_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=NEW.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id IN (OLD.record_id,NEW.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_subjects locked WHERE lower(NEW.subject_oid)=locked.subject_oid)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

-- Internal foundation only: a completion is trusted evidence supplied by a
-- future independently verified sealed-delivery implementation. This does
-- not expose a route or establish a provider-side write fence.
CREATE TABLE IF NOT EXISTS timesheet_publication_completions (
  subject_oid TEXT NOT NULL, pay_month TEXT NOT NULL, revision INTEGER NOT NULL,
  generation TEXT NOT NULL, drive_id TEXT NOT NULL, item_id TEXT NOT NULL, etag TEXT NOT NULL,
  flow_run_id TEXT NOT NULL CHECK(length(trim(flow_run_id)) BETWEEN 1 AND 240),
  verification_digest TEXT NOT NULL CHECK(length(verification_digest)=64 AND verification_digest NOT GLOB '*[^0-9a-f]*'),
  completed_at TEXT NOT NULL CHECK(length(completed_at)=24),
  PRIMARY KEY(subject_oid,pay_month,revision),
  FOREIGN KEY(subject_oid,pay_month,revision) REFERENCES timesheet_publication_candidates(subject_oid,pay_month,revision)
);
CREATE TRIGGER IF NOT EXISTS timesheet_publication_completion_validate BEFORE INSERT ON timesheet_publication_completions
WHEN NOT EXISTS (
 SELECT 1 FROM timesheet_publication_scopes p JOIN timesheet_publication_candidates c
   ON c.subject_oid=p.subject_oid AND c.pay_month=p.pay_month AND c.revision=p.desired_revision
 JOIN dispatch_queue q ON q.record_id=p.record_id
 WHERE p.subject_oid=NEW.subject_oid AND p.pay_month=NEW.pay_month AND p.desired_revision=NEW.revision
   AND p.published_revision=NEW.revision AND p.generation=NEW.generation AND p.published_generation=NEW.generation
   AND p.published_drive_id=NEW.drive_id AND p.published_item_id=NEW.item_id AND p.published_etag=NEW.etag
   AND c.generation=NEW.generation AND c.drive_id=NEW.drive_id AND c.item_id=NEW.item_id AND c.etag=NEW.etag
   AND q.status='sent'
)
BEGIN SELECT RAISE(ABORT,'publication completion does not match a sent candidate'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_completion_queue AFTER INSERT ON timesheet_publication_completions
BEGIN
 UPDATE dispatch_queue SET status='completed',updated_at=NEW.completed_at
 WHERE status='sent' AND record_id=(SELECT record_id FROM timesheet_publication_scopes WHERE subject_oid=NEW.subject_oid AND pay_month=NEW.pay_month AND desired_revision=NEW.revision);
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'publication completion queue changed') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_completions_no_update BEFORE UPDATE ON timesheet_publication_completions BEGIN SELECT RAISE(ABORT,'publication completion is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_completions_no_delete BEFORE DELETE ON timesheet_publication_completions BEGIN SELECT RAISE(ABORT,'publication completion is immutable'); END;

-- Exclude known old-writer destinations and sealed candidates in both
-- directions. This does not revoke a previously issued ID or prevent a
-- separately authorised provider client from writing to a candidate.
CREATE INDEX IF NOT EXISTS idx_timesheet_publication_candidates_item ON timesheet_publication_candidates(item_id);
CREATE TRIGGER IF NOT EXISTS timesheet_candidate_excludes_old_writer BEFORE INSERT ON timesheet_publication_candidates
WHEN EXISTS(SELECT 1 FROM timesheet_delivery_routes WHERE workbook_id=NEW.item_id)
  OR EXISTS(SELECT 1 FROM private_timesheet_workbooks WHERE workbook_id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'publication candidate belongs to old writer'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_route_excludes_candidate BEFORE INSERT ON timesheet_delivery_routes
WHEN EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot route publication candidate'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_workbook_excludes_candidate_insert BEFORE INSERT ON private_timesheet_workbooks
WHEN NEW.workbook_id IS NOT NULL AND EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot register publication candidate'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_workbook_excludes_candidate_update BEFORE UPDATE OF workbook_id ON private_timesheet_workbooks
WHEN NEW.workbook_id IS NOT NULL AND EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot register publication candidate'); END;
-- Local database boundary for source-bound publication. Provider file access
-- and any already-authorised writer require an independent provider fence.
CREATE VIEW IF NOT EXISTS timesheet_publication_locked_subjects AS
SELECT p.record_id, p.subject_oid, p.subject_upn
FROM timesheet_publication_scopes p JOIN dispatch_queue q ON q.record_id=p.record_id
WHERE q.status IN ('sending','sent','failed','uncertain') OR
 (q.status='completed' AND NOT EXISTS (
   SELECT 1 FROM timesheet_publication_completions done
   WHERE done.subject_oid=p.subject_oid AND done.pay_month=p.pay_month
    AND done.revision=p.desired_revision AND done.generation=p.generation
    AND done.revision=p.published_revision AND done.generation=p.published_generation
    AND done.drive_id=p.published_drive_id AND done.item_id=p.published_item_id AND done.etag=p.published_etag));

CREATE VIEW IF NOT EXISTS timesheet_publication_locked_records AS
SELECT DISTINCT r.record_id FROM records r JOIN timesheet_publication_locked_subjects p
WHERE r.record_id=p.record_id OR (r.kind IN ('timesheets','clock') AND (
 lower(r.owner_oid)=p.subject_oid OR lower(r.owner_upn)=p.subject_upn OR
 EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id AND lower(review.subject_oid)=p.subject_oid)));

CREATE TRIGGER IF NOT EXISTS timesheet_publication_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects p WHERE lower(NEW.owner_oid)=p.subject_oid OR lower(NEW.owner_upn)=p.subject_upn)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_record_update BEFORE UPDATE ON records
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id=OLD.record_id)
 OR (NEW.kind IN ('timesheets','clock') AND EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects p WHERE lower(NEW.owner_oid)=p.subject_oid OR lower(NEW.owner_upn)=p.subject_upn))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_record_delete BEFORE DELETE ON records
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id=NEW.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id IN (OLD.record_id,NEW.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects p WHERE lower(NEW.subject_oid)=p.subject_oid OR NEW.record_id=p.record_id)
 OR EXISTS (SELECT 1 FROM timesheet_publication_locked_records r WHERE r.record_id=NEW.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_period_insert BEFORE INSERT ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_period_update BEFORE UPDATE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_period_delete BEFORE DELETE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_queue_no_unverified_release BEFORE UPDATE OF status ON dispatch_queue
WHEN OLD.status IN ('sending','sent','failed','uncertain') AND NEW.status IN ('queued','skipped','completed')
 AND EXISTS (SELECT 1 FROM timesheet_publication_scopes p WHERE p.record_id=OLD.record_id)
 AND NOT (NEW.status='completed' AND EXISTS (
  SELECT 1 FROM timesheet_publication_scopes p JOIN timesheet_publication_completions done
   ON done.subject_oid=p.subject_oid AND done.pay_month=p.pay_month AND done.revision=p.desired_revision
  WHERE p.record_id=OLD.record_id AND done.generation=p.generation AND done.revision=p.published_revision
   AND done.generation=p.published_generation AND done.drive_id=p.published_drive_id
   AND done.item_id=p.published_item_id AND done.etag=p.published_etag))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_queue_no_delete BEFORE DELETE ON dispatch_queue
WHEN OLD.status IN ('sending','sent','failed','uncertain','completed')
 AND EXISTS (SELECT 1 FROM timesheet_publication_scopes p WHERE p.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_queue_no_replay BEFORE UPDATE OF status ON dispatch_queue
WHEN OLD.status='completed' AND NEW.status IN ('queued','sending')
 AND EXISTS (SELECT 1 FROM timesheet_publication_scopes p WHERE p.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_queue_no_move BEFORE UPDATE OF record_id ON dispatch_queue
WHEN NEW.record_id IS NOT OLD.record_id AND OLD.status IN ('sending','sent','failed','uncertain','completed')
 AND EXISTS (SELECT 1 FROM timesheet_publication_scopes p WHERE p.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_scope_no_change BEFORE UPDATE ON timesheet_publication_scopes
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects p WHERE p.record_id=OLD.record_id)
 AND (NEW.subject_oid IS NOT OLD.subject_oid OR NEW.subject_upn IS NOT OLD.subject_upn OR NEW.pay_month IS NOT OLD.pay_month
  OR NEW.cycle_start IS NOT OLD.cycle_start OR NEW.cycle_end IS NOT OLD.cycle_end OR NEW.record_id IS NOT OLD.record_id
  OR NEW.record_owner_oid IS NOT OLD.record_owner_oid OR NEW.record_owner_upn IS NOT OLD.record_owner_upn
  OR NEW.payload_json IS NOT OLD.payload_json OR NEW.payload_sha256 IS NOT OLD.payload_sha256
  OR NEW.source_base64 IS NOT OLD.source_base64 OR NEW.generation IS NOT OLD.generation
  OR NEW.owner_revision IS NOT OLD.owner_revision OR NEW.subject_revision IS NOT OLD.subject_revision
  OR NEW.record_revision IS NOT OLD.record_revision OR NEW.review_watermark IS NOT OLD.review_watermark
  OR NEW.period_settings_json IS NOT OLD.period_settings_json OR NEW.desired_revision IS NOT OLD.desired_revision)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_scope_no_delete BEFORE DELETE ON timesheet_publication_scopes
WHEN EXISTS (SELECT 1 FROM timesheet_publication_locked_subjects p WHERE p.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_publication_in_progress'); END;
-- An immutable claim ties a single local handoff attempt to its selected
-- source. It does not send anything or establish a provider write boundary.
CREATE TABLE IF NOT EXISTS timesheet_publication_attempts (
 attempt_id TEXT PRIMARY KEY, record_id TEXT NOT NULL,
 subject_oid TEXT NOT NULL, pay_month TEXT NOT NULL, revision INTEGER NOT NULL,
 generation TEXT NOT NULL, claimed_at TEXT NOT NULL,
 UNIQUE(subject_oid,pay_month,revision), UNIQUE(record_id,generation)
);
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attempt_claim AFTER INSERT ON timesheet_publication_attempts
BEGIN
 UPDATE dispatch_queue SET status='sending',attempts=attempts+1,updated_at=NEW.claimed_at,last_error=NULL
 WHERE record_id=NEW.record_id AND status='queued' AND attempts=0 AND next_attempt_at<=NEW.claimed_at
 AND EXISTS (SELECT 1 FROM timesheet_publication_scopes p WHERE p.record_id=NEW.record_id
  AND p.subject_oid=NEW.subject_oid AND p.pay_month=NEW.pay_month AND p.desired_revision=NEW.revision AND p.generation=NEW.generation);
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'publication handoff claim changed') END;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attempt_no_update BEFORE UPDATE ON timesheet_publication_attempts BEGIN SELECT RAISE(ABORT,'publication attempt is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_attempt_no_delete BEFORE DELETE ON timesheet_publication_attempts BEGIN SELECT RAISE(ABORT,'publication attempt is immutable'); END;
-- This binds a reported receiving run to one database claim. Callers must
-- authenticate that report; this table does not establish provider identity.
CREATE TABLE IF NOT EXISTS timesheet_publication_run_bindings (
 attempt_id TEXT PRIMARY KEY REFERENCES timesheet_publication_attempts(attempt_id),
 flow_run_id TEXT NOT NULL UNIQUE CHECK(length(trim(flow_run_id)) BETWEEN 1 AND 240),
 bound_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS timesheet_publication_run_binding_no_update BEFORE UPDATE ON timesheet_publication_run_bindings BEGIN SELECT RAISE(ABORT,'publication run binding is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_run_binding_no_delete BEFORE DELETE ON timesheet_publication_run_bindings BEGIN SELECT RAISE(ABORT,'publication run binding is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_publication_completion_attempt_validate BEFORE INSERT ON timesheet_publication_completions
WHEN NOT EXISTS (
 SELECT 1 FROM timesheet_publication_attempts a JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id
 JOIN timesheet_publication_scopes p ON p.record_id=a.record_id AND p.subject_oid=a.subject_oid AND p.pay_month=a.pay_month
 WHERE a.subject_oid=NEW.subject_oid AND a.pay_month=NEW.pay_month AND a.revision=NEW.revision
  AND a.revision=p.desired_revision AND a.generation=NEW.generation AND b.flow_run_id=NEW.flow_run_id
)
BEGIN SELECT RAISE(ABORT,'publication completion is not bound to a handoff attempt'); END;

-- A completion from a pre-binding prototype must not release the local lock.
DROP VIEW IF EXISTS timesheet_publication_locked_subjects;
CREATE VIEW IF NOT EXISTS timesheet_publication_locked_subjects AS
SELECT p.record_id, p.subject_oid, p.subject_upn
FROM timesheet_publication_scopes p JOIN dispatch_queue q ON q.record_id=p.record_id
WHERE q.status IN ('sending','sent','failed','uncertain') OR
 (q.status='completed' AND NOT EXISTS (
   SELECT 1 FROM timesheet_publication_completions done
   JOIN timesheet_publication_attempts a ON a.record_id=p.record_id AND a.subject_oid=done.subject_oid AND a.pay_month=done.pay_month AND a.revision=done.revision AND a.generation=done.generation
   JOIN timesheet_publication_run_bindings b ON b.attempt_id=a.attempt_id AND b.flow_run_id=done.flow_run_id
   WHERE done.subject_oid=p.subject_oid AND done.pay_month=p.pay_month
    AND done.revision=p.desired_revision AND done.generation=p.generation
    AND done.revision=p.published_revision AND done.generation=p.published_generation
    AND done.drive_id=p.published_drive_id AND done.item_id=p.published_item_id AND done.etag=p.published_etag));
