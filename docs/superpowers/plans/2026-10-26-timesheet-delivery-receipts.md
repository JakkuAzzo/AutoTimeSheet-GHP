# Timesheet Delivery Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show Accounts verified portal-save, Power Automate run, and SharePoint workbook stages for each correction, using provider receipts tied to its existing source record ID.

**Architecture:** Add an authenticated server-to-server Worker callback and append-only D1 receipt events. Power Automate sends run and workbook-read-back evidence; the Worker returns the newest run for each queued correction, and the existing Accounts dialog renders its three delivery stages. Update the monthly Office Script to return source row IDs only after it has read back and matched the written cells.

**Tech Stack:** Cloudflare Worker, D1/SQLite migrations, GMT portal JavaScript/CSS, Power Automate flow contract, Excel Office Script.

**Spec:** `docs/superpowers/specs/2026-10-26-timesheet-delivery-receipts-design.md`

## Global Constraints

- “Sent” means the email endpoint accepted the message; it never implies a Power Automate run or a workbook update.
- Workbook verification requires the expected source record IDs and dates to be present with normalized payroll values matching the submitted JSON.
- Callback secrets remain in provider/Worker secret stores and never enter source control or the browser bundle.
- Callback writes are idempotent by `(source record ID, flow run ID, event type)`; conflicting duplicate evidence is rejected.
- Only Accounts can view the queue and its delivery receipts; the callback has no employee identity or workbook-routing authority.
- A failed receipt callback never causes a timesheet resend or interrupts payroll processing.
- No live credentials, production payroll data, or dispatch state are changed by the implementation or synthetic test. A later user request separately authorizes the production code release.
- Add and run targeted receipt, Office Script, portal, and deployment-contract checks; report provider configuration and live-run evidence separately.

## Review Focus

- A valid but unknown/deleted/non-timesheet record ID must be rejected without receipt insertion.
- A repeated event with identical content must be idempotent; the same key with changed content must not replace stored evidence.
- A failed new run must not inherit the earlier run’s workbook-verified success.
- A workbook callback must be rejected unless its verified row IDs match the expected correction attachment.
- Missing or failed callback evidence must remain pending/failed in the UI and must not trigger a retry or make a payroll record appear processed.

---

### Task 1: Store and expose authenticated delivery receipts

**Files:**
- Create: `cloudflare-worker/migrations/0017_timesheet_delivery_receipts.sql`
- Modify: `cloudflare-worker/schema.sql`
- Modify: `cloudflare-worker/src/index.js`

**Interfaces:**
- `POST /api/integrations/timesheet-delivery-receipts` accepts a bounded JSON body containing `recordId`, `flowRunId`, `runStartedAt`, `event`, and event-specific evidence, authenticated by `X-GMT-Delivery-Key` compared with Worker secret `TIMESHEET_DELIVERY_CALLBACK_KEY`.
- Supported events are `flow_started`, `workbook_verified`, `flow_completed`, and `flow_failed`.
- Existing `GET /api/admin/dispatch-queue` adds the newest flow run and its event evidence to each returned queue record without changing existing queue fields or role access.

- [x] Add append-only receipt table with unique `(record_id, flow_run_id, event_type)`, bounded evidence columns, and a foreign key to `records`.
- [x] Add callback handler before Entra user authentication; compare the separate secret with `constantTimeEqual`, cap JSON size, validate timesheet record and allowed event schema, and reject stale/conflicting duplicates.
- [x] For `workbook_verified`, load the queued `attachment_record` JSON server-side and require the callback’s verified row IDs to match the correction’s expected IDs and dates before storing its row counts.
- [x] Return a generic accepted result that discloses no record details or secret state.
- [x] Extend `adminQueueStatus` to expose the newest run ordered by provider `runStartedAt`, and only events for that run. Keep the endpoint read-only and Accounts-only.
- [x] Update `schema.sql` to match migration `0017` and statically inspect route ordering, authorization, SQL bindings, and response fields.

### Task 2: Add workbook read-back evidence and the Power Automate receipt contract

**Files:**
- Modify: `power-platform/office-scripts/upsert-monthly-timesheet-row.ts`
- Modify: `power-platform/timesheet-monthly-upsert-flow-spec.json`
- Modify: `power-platform/README.md`

**Interfaces:**
- Office Script result adds `verifiedRecordIds: string[]`, populated only after the script re-reads the written worksheet and compares source ID, date, action, and normalized payroll cells with each accepted input row.
- Power Automate posts callbacks using the Task 1 payload and dedicated header secret. The flow order is: validated ID → `flow_started` → upsert script → workbook read-back → `workbook_verified` → remaining index actions → `flow_completed`; any failed processing path posts `flow_failed` with stage and safe error.

- [x] Re-read the `Timesheet Events` worksheet after row updates and return a verified source ID only when a normalized stored row exactly matches the expected row values.
- [x] Document callback event timing, exact JSON fields, idempotency key, retry policy, and secret storage in the machine-readable flow contract and Power Platform README.
- [x] Specify that callback retries reuse the same record/run/event identity, and that callback outages do not reverse or replay a workbook write.
- [x] Statically inspect the Office Script and Power Automate contract to ensure no secret or client-supplied workbook path is accepted.

### Task 3: Render a stage-by-stage Accounts indicator

**Files:**
- Modify: `portal/submissions.js`
- Modify: `portal/submissions.html`
- Modify: `portal.css`

**Interfaces:**
- Each correction item displays three stages: `Portal record saved`, `Power Automate`, and `SharePoint workbook`.
- The latest run shows `In progress`, `Failed`, or `Completed` based on its receipts. Workbook status shows `Verified` only when the Worker accepted a `workbook_verified` event; otherwise it remains `Not reported` or `Failed`.
- Each confirmed stage shows its timestamp; Power Automate details show the run ID. Email `sent` remains a separate handoff label.

- [x] Replace the generic email caveat with a concise status summary and three-stage per-record indicator fed by the existing queue API.
- [x] Display a failed stage and safe error without making a later or earlier run appear successful.
- [x] Keep the Accounts-only trigger, read-only refresh behavior, and existing queue retry controls unchanged.
- [x] Add responsive styles for the stage indicator and bump the `submissions.js` cache version.
- [x] Add a synthetic integration test that exercises Office Script read-back, Worker callbacks, D1 receipts, and Accounts queue status without changing payroll or dispatch records.
- [x] Run the synthetic integration test, relevant portal and Worker contracts, Pages build, and Worker dry-run.
- [x] Review the full diff against the spec and current live-preserving assumptions. Live Power Automate configuration, callback-secret setup, and provider-run proof remain pending because the signed-in Accounts session exposes no environments or flows.

## Completion boundary

The local synthetic integration path passes from Office Script read-back through the Worker callback and D1 into the Accounts queue response. The feature is not live end-to-end until production migration/deployment is verified, the GMT Power Automate flow posts all required callbacks using its configured secret, and a controlled provider run proves that the Accounts dialog shows matching run and workbook evidence.
