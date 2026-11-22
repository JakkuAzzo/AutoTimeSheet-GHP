-- While a provider request is in flight, protect the local source snapshot
-- and queued attachments. Other employees and non-timesheet work remain open.
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn)=lower(NEW.owner_upn) OR lower(delivery.owner_oid)=lower(NEW.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn) IN (lower(OLD.owner_upn),lower(NEW.owner_upn)) OR lower(delivery.owner_oid) IN (lower(OLD.owner_oid),lower(NEW.owner_oid))))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_upn)=lower(OLD.owner_upn) OR lower(delivery.owner_oid)=lower(OLD.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=NEW.record_id AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id IN (OLD.record_id,NEW.record_id) AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_handoff_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=OLD.record_id AND q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction')
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_handoff_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  LEFT JOIN records source ON source.record_id=NEW.record_id
  WHERE q.status='sending' AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND (lower(delivery.owner_oid)=lower(NEW.subject_oid) OR lower(delivery.owner_upn)=lower(source.owner_upn)
      OR lower(delivery.owner_oid)=lower(source.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_handoff_in_progress'); END;
