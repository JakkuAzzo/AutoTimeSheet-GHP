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
