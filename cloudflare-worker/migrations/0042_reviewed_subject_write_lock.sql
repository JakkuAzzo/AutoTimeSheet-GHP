-- A correction may have been saved by Accounts on behalf of an employee.
-- Keep both the reviewed employee's records and their known on-behalf sources
-- stable while a routed workbook can still be written. Keep historical review
-- subjects in this hold even if a decision is revoked during the handoff;
-- revocation itself remains possible and invalidates publication separately.
CREATE VIEW IF NOT EXISTS timesheet_reviewed_locked_subjects AS
SELECT DISTINCT q.record_id AS delivery_record_id, lower(review.subject_oid) AS subject_oid,
       lower(subject.employee_upn) AS subject_upn
FROM dispatch_queue q
JOIN records delivery ON delivery.record_id=q.record_id
JOIN timesheet_ownership_reviews review ON review.record_id=q.record_id
LEFT JOIN private_timesheet_subjects subject ON lower(subject.employee_oid)=lower(review.subject_oid)
WHERE delivery.kind='timesheets' AND delivery.action='pay_month_correction'
  AND (q.status='sending' OR (q.status IN ('sent','failed','uncertain')
    AND EXISTS (SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)));

CREATE VIEW IF NOT EXISTS timesheet_reviewed_locked_source_records AS
SELECT DISTINCT source.record_id
FROM records source JOIN timesheet_reviewed_locked_subjects locked
WHERE source.kind IN ('timesheets','clock') AND (
  lower(source.owner_oid)=locked.subject_oid OR lower(source.owner_upn)=locked.subject_upn OR
  EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
          WHERE review.record_id=source.record_id AND lower(review.subject_oid)=locked.subject_oid));

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_subjects locked
  WHERE lower(NEW.owner_oid)=locked.subject_oid OR lower(NEW.owner_upn)=locked.subject_upn)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_subjects locked
  WHERE OLD.record_id<>locked.delivery_record_id AND (
    lower(OLD.owner_oid)=locked.subject_oid OR lower(NEW.owner_oid)=locked.subject_oid OR
    lower(OLD.owner_upn)=locked.subject_upn OR lower(NEW.owner_upn)=locked.subject_upn OR
    EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
      WHERE review.record_id=OLD.record_id AND lower(review.subject_oid)=locked.subject_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=NEW.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id IN (OLD.record_id,NEW.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_source_records source WHERE source.record_id=OLD.record_id)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_reviewed_subject_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM timesheet_reviewed_locked_subjects locked WHERE lower(NEW.subject_oid)=locked.subject_oid)
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_reviewed_delivery_in_progress'); END;
