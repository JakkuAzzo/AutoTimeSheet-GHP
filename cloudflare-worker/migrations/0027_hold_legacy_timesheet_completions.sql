-- Run only with timesheet dispatch and delivery processing stopped and drained.
-- All pre-existing completed timesheet corrections need reconciliation: old
-- receipts did not prove every stored value against the current source. Do not
-- infer that an old generation belongs to today's attachment. Preserve attempts,
-- timestamps, evidence and any existing warning; never automatically resend.
UPDATE dispatch_queue
SET status='uncertain',
    last_error=CASE WHEN COALESCE(last_error,'')='' THEN
      'Prior delivery requires source-row reconciliation before further corrections.'
    ELSE last_error || ' | Prior delivery requires source-row reconciliation before further corrections.' END
WHERE status='completed' AND EXISTS (
  SELECT 1 FROM records r WHERE r.record_id=dispatch_queue.record_id
    AND r.kind='timesheets' AND r.action='pay_month_correction'
);
