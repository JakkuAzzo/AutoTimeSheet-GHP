-- A routed run can still write a workbook after the email handoff. Keep its
-- local source stable until the queue has a verified completed transition.
CREATE TRIGGER IF NOT EXISTS timesheet_write_record_insert BEFORE INSERT ON records
WHEN NEW.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn)=lower(NEW.owner_upn) OR lower(delivery.owner_oid)=lower(NEW.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_record_update BEFORE UPDATE ON records
WHEN (OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')) AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn) IN (lower(OLD.owner_upn),lower(NEW.owner_upn)) OR lower(delivery.owner_oid) IN (lower(OLD.owner_oid),lower(NEW.owner_oid)))
    AND NOT (OLD.record_id=q.record_id AND NEW.record_id IS OLD.record_id AND OLD.status='Queued for Accounts'
      AND NEW.owner_oid IS OLD.owner_oid AND NEW.owner_upn IS OLD.owner_upn AND NEW.employee_name IS OLD.employee_name
      AND NEW.kind IS OLD.kind AND NEW.action IS OLD.action AND NEW.start_date IS OLD.start_date AND NEW.end_date IS OLD.end_date
      AND NEW.record_date IS OLD.record_date AND NEW.submitted_at IS OLD.submitted_at AND NEW.payload_json IS OLD.payload_json
      AND NEW.source_message_key IS OLD.source_message_key AND NEW.source_attachment_ids IS OLD.source_attachment_ids
      AND NEW.reconciliation_key IS OLD.reconciliation_key AND NEW.source_variant_status IS OLD.source_variant_status
      AND NEW.reconciled_at IS OLD.reconciled_at AND NEW.created_at IS OLD.created_at
      AND NEW.updated_at IS q.updated_at AND ((q.status='sent' AND NEW.status='Sent to Accounts') OR
        (q.status='failed' AND NEW.status='Delivery failed') OR (q.status='uncertain' AND NEW.status='Delivery needs review'))))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_record_delete BEFORE DELETE ON records
WHEN OLD.kind IN ('timesheets','clock') AND EXISTS (
  SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_upn)=lower(OLD.owner_upn) OR lower(delivery.owner_oid)=lower(OLD.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_insert BEFORE INSERT ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=NEW.record_id AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_update BEFORE UPDATE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id IN (OLD.record_id,NEW.record_id) AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_attachment_delete BEFORE DELETE ON record_attachments
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id
  WHERE q.record_id=OLD.record_id AND q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_review_insert BEFORE INSERT ON timesheet_ownership_reviews
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN records delivery ON delivery.record_id=q.record_id LEFT JOIN records source ON source.record_id=NEW.record_id
  WHERE q.status IN ('sent','failed','uncertain') AND delivery.kind='timesheets' AND delivery.action='pay_month_correction'
    AND EXISTS(SELECT 1 FROM timesheet_delivery_routes route WHERE route.record_id=q.record_id)
    AND (lower(delivery.owner_oid)=lower(NEW.subject_oid) OR lower(delivery.owner_upn)=lower(source.owner_upn) OR lower(delivery.owner_oid)=lower(source.owner_oid)))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;

CREATE TRIGGER IF NOT EXISTS timesheet_write_period_insert BEFORE INSERT ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_period_update BEFORE UPDATE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_write_period_delete BEFORE DELETE ON pay_month_start_settings
WHEN EXISTS (SELECT 1 FROM dispatch_queue q JOIN timesheet_delivery_routes route ON route.record_id=q.record_id WHERE q.status IN ('sending','sent','failed','uncertain'))
BEGIN SELECT RAISE(ABORT,'gmt_timesheet_delivery_in_progress'); END;
