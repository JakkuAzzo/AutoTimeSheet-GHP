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
