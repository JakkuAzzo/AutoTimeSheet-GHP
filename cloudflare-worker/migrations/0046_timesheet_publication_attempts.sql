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
