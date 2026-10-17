# GMT Original Source ID Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the shared monthly timesheet Office Script rejects records that lack an original source submission ID and preserves distinct source records that share a date.

**Architecture:** Keep the existing parser and workbook upsert flow, but remove fallback IDs from FormSubmit, CSV, calendar-sync, and row-envelope parsing. The existing `main` validation will reject records with no `recordId` before workbook writes; companion representations are merged only when their source-derived row IDs match.

**Tech Stack:** Office Scripts TypeScript; Node.js `node:test` and `vm` test harness.

**Spec:** `power-platform/submission-envelope-contract.json`; `power-platform/timesheet-monthly-upsert-flow-spec.json`.

## Global Constraints

- Reconcile queued or missing records only from original source submission IDs.
- Use synthetic internal records for local verification; do not fabricate payroll history.
- Keep the change within shared integration/provider assets; do not edit individual tool UIs.
- Leave production provider settings unchanged when approved M365 access is unavailable.

## Review Focus

- FormSubmit text without `gmt_record_id` or `gmt_submission_id` must fail before workbook writes.
- CSV without a source-record column must not create rows using employee/date-derived IDs.
- Calendar-sync JSON without `submissionId` must not fall back to `syncEventId` or identity/date values.
- Row envelopes without per-row `recordId` or parent source ID must fail before workbook writes.
- Existing source IDs must continue to persist through upsert and exact retries must remain deduplicated.
- Different source IDs for the same employee and date must remain separate rows; companion files with the same source-derived row ID may enrich one another.

---

### Task 1: Require original source IDs in the monthly upsert parser

**Files:**
- Modify: `power-platform/office-scripts/upsert-monthly-timesheet-row.ts`
- Modify: `power-platform/submission-envelope-contract.json`
- Modify: `power-platform/timesheet-monthly-upsert-flow-spec.json`
- Test: `tests/timesheet-upsert-behavior.mjs`
- Test: `tests/timesheet-source-date-routing.mjs`
- Test: `tests/timesheet-monthly-contract.mjs`

**Interfaces:**
- Consumes: Existing FormSubmit, CSV, calendar-sync and row-envelope payloads.
- Produces: Workbook records only when each record has a source-provided `recordId`, `record_id`, `gmt_record_id`, `gmt_submission_id`, `Source record ID`, or parent `submissionId` combined with the row date.

- [x] Add behavior tests for missing IDs across each fallback parser and verify no workbook rows are written; assert distinct source IDs on one date remain separate rows and CSV keeps the supplied source ID.
- [x] Run `node tests/timesheet-upsert-behavior.mjs` and confirm the missing-ID and distinct-source-row cases fail against current behavior.
- [x] Remove generated employee/date/sync-event fallback keys and restrict companion-file enrichment to matching source-derived row IDs; document the same identity boundary in the intake contracts.
- [x] Run the upsert, source-date-routing, monthly-contract, intake-routing and reconciliation checks.
- [x] Review the diff for unrelated changes and commit the provider-asset contract fix.
