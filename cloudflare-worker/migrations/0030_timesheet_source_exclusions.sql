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
