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
