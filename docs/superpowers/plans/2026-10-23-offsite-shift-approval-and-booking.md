# Off-site Shift Approval and Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manager-approved off-site clock/lunch shifts and advance bookings, then add only approved actual shifts to the employee's protected portal timesheet history.

**Architecture:** Extend the authenticated Worker/D1 off-site workflow with event timestamps and a separate planned-booking lifecycle. A manager's approval atomically creates one stable `kind: clock` record in the existing protected history; dashboard off-site actions use this same API, while in-office actions keep their current delivery path. Do not send real payroll data to the currently unverified Microsoft 365 intake contract.

**Tech Stack:** Static portal HTML/CSS/JavaScript, Cloudflare Worker JavaScript, Cloudflare D1 SQLite, Node.js test scripts, Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-10-23-offsite-shift-approval-and-booking.md`

## Global Constraints

- Only a verified Entra identity can own a shift, booking or timesheet record.
- Keep the configured Duty Manager allowlist and deny self-approval.
- A booking is planning data; approval of it never creates worked time.
- Pending and rejected shifts never enter protected timesheet history.
- Use Europe/London work dates and server-recorded actual event times.
- Never put raw latitude/longitude in a visible location field or send coordinates to a geocoder.
- Do not write live payroll data or claim a SharePoint/workbook update; the checked-in provider contract is `target-contract-not-live`.
- Preserve the existing in-office clock/email flow.

## Review Focus

- Duplicate or concurrent clock/lunch/approval retries must not create duplicate or reordered timesheet rows; pin request identity and event ordering in lifecycle tests.
- Managers with overlapping employee identities must not approve their own shift; pin the verified OID/UPN comparisons in policy tests.
- Approved booking amendments must require new approval without changing actual attendance; pin version and state behavior in lifecycle tests.
- Invalid or cross-midnight booking intervals must be rejected or represented explicitly; pin accepted boundary behavior in booking tests.
- An off-site dashboard action must never use the direct in-office email path; pin the route split and no-coordinate behavior in browser tests.

---

### Task 1: Worker lifecycle, booking API and timesheet bridge

**Files:**
- Create: `cloudflare-worker/migrations/0015_offsite_attendance_workflow.sql`
- Modify: `cloudflare-worker/src/offsite-clock.js`
- Modify: `cloudflare-worker/src/index.js` only if necessary to project approved records.
- Test: `tests/offsite-clock-lifecycle.mjs`
- Test: `tests/offsite-clock-policy.mjs`

**Interfaces:**
- Add idempotent `POST /api/offsite-clock/lunch-start` and `/lunch-end` actions that update an owner’s active entry with server timestamps.
- Add `POST /api/offsite-bookings`, `GET /api/offsite-bookings/mine`, `GET /api/offsite-bookings/pending`, `PATCH /api/offsite-bookings/:id`, and `POST /api/offsite-bookings/:id/decision`.
- Extend shift views with `lunchStartAt`, `lunchEndAt` and an optional `bookingId`.
- On final shift approval, atomically create `offsite-<entryId>` in `records` as a protected clock record with `action: "full_day"`, actual work date/times/location and manager lineage.

- [x] **Step 1: Add failing lifecycle assertions** for lunch ordering, duplicate retries, off-site payroll isolation before approval, one idempotent clock record after approval, and booking owner/manager amendment rules.
- [x] **Step 2: Run `node tests/offsite-clock-lifecycle.mjs` and `node tests/offsite-clock-policy.mjs`; confirm the new assertions fail against the current endpoint.**
- [x] **Step 3: Add the D1 fields/tables and Worker endpoints.** Preserve immutable audit behavior, require a rejection note, reject self-approval, and validate booking date/time/site server-side.
- [x] **Step 4: Create the `records` clock row in the same D1 batch as successful manager approval.** Preserve verified owner OID/UPN and stable `offsite-<entryId>` identity; repeated approval must return the same record.
- [x] **Step 5: Rerun lifecycle and policy tests; verify pending/rejected entries remain absent from `/api/history?kind=clock` and approved entries appear exactly once.**

### Task 2: Employee and manager off-site interface

**Files:**
- Modify: `portal/offsite-clock.html`
- Modify: `portal/offsite-clock.js`
- Modify: `portal/offsite-clock.css`
- Modify: `portal-api.js`
- Test: `tests/offsite-clock-ui.mjs`

**Interfaces:**
- Extend `GMTPortalApi` with the lunch and booking methods from Task 1.
- Keep the page's one-shift review as the approval unit.
- Add an editable location input, action controls, a “Book off-site” form and manager queues for both completed shifts and bookings.

- [x] **Step 1: Extend the browser shim and write failing browser assertions** for lunch actions, booking/amendment state labels, site editing, manager approval and rejection.
- [x] **Step 2: Run `node tests/offsite-clock-ui.mjs`; confirm the new UI assertions fail before implementation.**
- [x] **Step 3: Implement employee shift controls, booking form/history, and manager decision queues.** Render planned bookings separately from actual shifts and display decision reasons/times.
- [x] **Step 4: Set the “Separate from payroll clock records” eyebrow to dark green on its light surface.** Remove raw coordinate display and use a text-only location field labeled for road, business or site name.
- [x] **Step 5: Rerun the browser test across Chromium, Firefox and WebKit at its mobile viewport.**

### Task 3: Dashboard in-office/off-site mode

**Files:**
- Modify: `portal/index.html`
- Modify: `timesheet-clock.js`
- Test: `tests/timesheet-clock-routing.mjs`

**Interfaces:**
- Add a location-mode selector with `in_office` and `off_site` values to the existing dashboard form.
- Keep in-office submissions unchanged. For off-site, allow only clock-in, lunch-start, lunch-end and clock-out; route them to the Task 1 API with a required editable site name.

- [x] **Step 1: Add failing routing tests** showing that each off-site action uses the protected API and never builds/submits the direct-to-Accounts form, while in-office actions retain the current route.
- [x] **Step 2: Run `node tests/timesheet-clock-routing.mjs`; confirm the new routing assertions fail.**
- [x] **Step 3: Implement the mode selector and route split.** Disable full-day/absence actions in off-site mode with explanatory UI; show active-shift state and require a named location before clock-in.
- [x] **Step 4: Remove the current geolocation-to-coordinate filler.** Preserve manual entry and allow edits to the location value.
- [x] **Step 5: Rerun `node tests/timesheet-clock-routing.mjs` and verify the existing in-office record/notification assertions remain unchanged.**

### Task 4: Integrated history and release checks

**Files:**
- Modify if required: `tests/offsite-clock-lifecycle.mjs`, `tests/offsite-clock-ui.mjs`, `tests/timesheet-clock-routing.mjs`, `tests/cloudflare-pages-public-root.mjs`.

- [x] **Step 1: Verify approved `action: full_day` clock rows join the right employee/day and preserve lunch times in the existing timesheet projection.** Add a regression assertion before changing projection code, if needed.
- [x] **Step 2: Run `node tests/offsite-clock-policy.mjs`, `node tests/offsite-clock-lifecycle.mjs`, `node tests/offsite-clock-ui.mjs`, `node tests/timesheet-clock-routing.mjs`, and `node tests/cloudflare-pages-public-root.mjs`.**
- [x] **Step 3: Review the branch diff and confirm no live provider writes, in-office delivery changes, or unapproved source-record edits were included.**
- [ ] **Step 4: Commit the change and prepare a PR against `main`; do not deploy until the review and production-release gate.**
