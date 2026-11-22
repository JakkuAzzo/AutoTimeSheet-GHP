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
