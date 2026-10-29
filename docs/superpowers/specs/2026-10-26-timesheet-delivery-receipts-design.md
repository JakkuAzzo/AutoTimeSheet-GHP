# Timesheet Delivery Receipts Design

## Intent

Replace the generic “Email accepted” caveat in the Accounts correction-status view with a per-record indicator that reports portal save, Power Automate run, and verified SharePoint workbook update separately. The goal is to let Accounts see what happened to a correction without treating email acceptance as proof of downstream processing.

## Current state

The portal saves the correction in Worker D1 and queues its attachments. The Worker dispatch queue records only its outbound email attempt (`queued`, `sending`, `sent`, `failed`, or `skipped`). `sent` means the email endpoint accepted the message. There is no durable event linking a Power Automate run or workbook read-back to the source record ID, so the browser cannot currently display either downstream result.

## Approaches

1. **Portal-only stepper:** show the D1 save and email handoff, then label downstream stages “not reported.” This is accurate but never confirms the flow or workbook.
2. **End-to-end receipt path (selected):** have the existing Power Automate intake flow report run start, failure, and verified workbook completion against the stable source record ID. The Worker stores these receipts, and the Accounts view renders the evidence for each stage. This is the only approach that can show actual flow and workbook outcomes.

## Design

- Add an append-only Worker D1 receipt table keyed by source record ID and Power Automate run ID. Each receipt records a validated event (`flow_started`, `workbook_verified`, `flow_completed`, or `flow_failed`), the Worker receipt timestamp, and bounded provider evidence. A run ID makes retried flow events idempotent and preserves separate retries.
- Add a server-to-server callback route protected by a dedicated Worker secret, compared with the existing constant-time secret helper. Accept only existing, non-deleted timesheet records and known event types. Bound request size and fields, reject unknown states, and never accept employee identity or workbook routing from the callback as authority.
- The flow reports `flow_started` after it has extracted and validated the original source record ID, including its run start time; reports `flow_failed` from its failure path with the failed stage and a safe error; and reports `workbook_verified` only after the upsert script succeeds and a SharePoint workbook read-back confirms the expected source rows. Verification requires every expected `(source record ID, date)` row to be present with the normalized payroll values matching the validated input. Include the flow run ID and created/updated/unchanged row counts. A message receipt or script action success alone is insufficient for the verified state.
- Receipt retries are idempotent on `(source record ID, flow run ID, event type)`. An exact duplicate returns success without adding another event; a duplicate key with different evidence is rejected and retained state is not overwritten.
- The Accounts view reports the newest run for each record, ordered by the provider run start time; it never combines an older run's workbook success with a newer run's failure or pending state. Older run receipts remain available in audit history.
- Extend the Accounts-only correction queue response with the latest flow and workbook evidence per source record. Keep existing queue fields and status contract intact. The portal renders a three-stage indicator: Portal record saved, Power Automate run, SharePoint workbook verified. Each stage shows its evidence timestamp and run reference when available; not-yet-reported stages remain visibly pending. Flow failures show the stage and returned safe error. The UI does not infer completion from email acceptance.
- Keep the existing correction queue read-only status route and Accounts access restriction. Do not automatically resend, replay, change payroll records, or alter the existing email route as part of viewing status.
- Receipt reporting is observability only: the flow retries a failed callback with the same idempotency identity and continues its existing data work. A receipt outage must not interrupt payroll processing, roll back a successful workbook write, or cause an automatic timesheet resend. Pending callbacks are retried in event order after service returns; the portal leaves missing stages as “Not reported” until receipts are accepted.

## Constraints and non-goals

- Preserve source record IDs, correction data, role checks, current D1 history, and existing dispatch behavior.
- Do not claim that legacy records were processed based on old run-history evidence; receipts begin only when the new flow callback is configured.
- Do not store Power Automate callback secrets in source control or expose them to the portal.
- This change does not repair the current Power Automate trigger, certify every workbook, or replay queued corrections. Those are separate provider operations and require a verified GMT-owned flow environment.
- Production status is complete only after the Worker migration and secret plus the Power Automate callbacks are configured, and a controlled synthetic record proves flow-run and workbook read-back receipts appear in the Accounts view.

## Builder decisions

- Use additive D1 schema and preserve the current `/api/admin/dispatch-queue` endpoint.
- Expose the newest event per stage and flow run in the existing admin queue response; retain event rows for audit and retry history.
- Keep the receipt API server-to-server and the UI Accounts-only.
