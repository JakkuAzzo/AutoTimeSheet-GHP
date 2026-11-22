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
