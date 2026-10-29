# GMT Un-Paid Timesheet Absence Implementation Plan

**Goal:** Make Un-Paid absence contribute zero worked, basic, overtime, weighted and payroll hours throughout entry, correction, history, calendar and export flows. The user will apply the six requested October dates through the protected editor after the change is live.

**Architecture:** Keep absence normalization in the existing browser and Worker pipelines. Preserve original source IDs and reported source values for audit, while normalized Un-Paid values are zeroed before history or exports consume them. Use the current `pay_month_correction` pathway when the user makes the six live changes.

**Tech Stack:** Native HTML/CSS/JavaScript, Cloudflare Worker, D1, existing Node and Playwright tests.

**Spec:** `docs/superpowers/specs/2026-10-26-gmt-unpaid-timesheet-absence-design.md`

## Global Constraints

- Preserve each daily source record ID and submit corrections through the portal's `pay_month_correction` path, retaining the original records and audit history.
- Do not write directly to a workbook or overwrite source evidence.
- Do not make any live payroll data changes during implementation. The user will correct 2026-10-16 and 2026-10-19 through 2026-10-23 after release.

## Review Focus

- Un-Paid rows containing clocks and stale totals still calculate to zero.
- Browser history, Worker-normalized history and exports preserve the status and report zero.
- Future Un-Paid dates are accepted as absence, not work.
- Holiday remains 480 paid minutes and Time Off retains its current worked-hours behavior.
- Correction payloads preserve source IDs and audit history and leave unrelated days untouched.

---

### Task 1: Shared zero-hour policy

**Files:** `script.js`, `timesheet-row-policy.js`, `timesheets.js`, `portal/pay-month-workbook.js`, `portal/submissions.js`, `portal/history-frame.js`, `workbook-format.js`, `tests/pay-month-unpaid-correction.mjs`, `tests/timesheet-daily-preview.mjs`, `tests/timesheet-upstream-daily.mjs`.

- [x] Add failing cases for Un-Paid with clocks, stale worked/overtime values, future dates and payroll totals; verify Holiday and Time Off behavior remains distinct.
- [x] Run the focused tests and confirm the initial failures expose retained worked/overtime values.
- [x] Add Un-Paid to relevant selectors and allow it for future absence entries.
- [x] Apply Un-Paid precedence before clock and cached-total calculations; preserve reported source values but set all counted hour fields to zero.
- [x] Re-run the focused tests plus daily calculation, submissions UI, admin UI, protected editor, history and calendar checks.

### Task 2: Protected editor support

**Files:** `tests/pay-month-sheet-editor.mjs` plus authenticated portal workflow; no direct source/workbook mutation.

- [x] Extend the correction-editor test for stale clocked Un-Paid rows and verify saved hours are all zero.
- [x] Confirm the editor keeps the correction action type and does not overwrite original source records.
- [x] Verify the protected editor allows Un-Paid with clocks, previews zero hours before save, and writes zero hours to the correction and filing export.
- [ ] After release, user marks 2026-10-16 and 2026-10-19 through 2026-10-23 as Un-Paid in the authenticated editor and verifies source IDs, audit history, calendar and export.

