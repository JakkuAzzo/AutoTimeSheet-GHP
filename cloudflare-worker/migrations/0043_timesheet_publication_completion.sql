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
