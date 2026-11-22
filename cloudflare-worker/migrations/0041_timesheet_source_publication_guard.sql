-- Foundation only. No endpoint, provider grant or live delivery is enabled by
-- these tables. Publication also requires a separately enforced provider fence.
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
