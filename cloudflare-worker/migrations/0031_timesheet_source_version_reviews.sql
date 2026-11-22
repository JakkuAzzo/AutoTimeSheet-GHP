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
