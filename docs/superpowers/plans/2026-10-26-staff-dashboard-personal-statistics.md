# Staff Dashboard Personal Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third staff-dashboard carousel slide with personal activity totals for a selected GMT pay month.

**Architecture:** Reuse the existing authorized `/api/history` response, request its supported 500-record bound through the current browser API wrapper, and filter all displayed counts to the signed-in identity. Use `GMTPayPeriods` and source activity dates to derive month totals; do not add a backend route or mutate records.

**Tech Stack:** Existing portal HTML/CSS, vanilla JavaScript, Cloudflare Worker history API, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-10-26-staff-dashboard-personal-statistics-design.md`

## Global Constraints

- Reuse the existing signed-in history API; no new endpoint or data writes.
- Match the signed-in user by owner OID/UPN so admin visibility cannot expose other employees’ statistics.
- Use the configured GMT pay-period helper for month assignment.
- Count only source-backed worked days, holiday days, estimates, job cards and completed tasks.
- Distinguish unavailable history from a successful zero; disclose that counts use records currently returned to the account.
- Keep slide navigation accessible and responsive.

## Review Focus

- Accounts administrators can see multiple employees’ records: statistics must still include only the active account’s owner OID/UPN.
- One weekly record can contain multiple daily rows and corrected duplicates: count distinct dates, not record count.
- A holiday row must not also count as a worked day; pending tasks must not count as completed.
- A history outage must not render zero totals as confirmed data.
- Staff with no records must still see the current pay month and a clear zero-data state.

## File Map

- `portal/index.html` — add the slide and its third accessible carousel indicator; version the modified portal assets.
- `portal.css` — style the statistics cards, month selector and narrow-screen layout.
- `portal-api.js` — honor the optional history limit, bounded to the Worker’s 500-record maximum.
- `portal/dashboard-updates.js` — reuse one history response for notifications and personal statistics; calculate and render month totals, loading, empty and error states.
- `tests/dashboard-updates-smoke.mjs` — cover three-slide navigation, month totals, own-record filtering, source-status handling and responsive overflow.
- `tests/dashboard-tools-navigation.browser.mjs` — verify the dashboard requests the bounded history and exposes the third slide through the real portal shell.

## Tasks

### Task 1: Add failing dashboard statistics coverage

- [x] Extend the dashboard fixture with two signed-in owner records and one other-owner record; include multiple daily rows, a holiday, estimates, a job card, completed and pending tasks across two configured pay months.
- [x] Assert that the third slide and matching tab exist, “My statistics” loads the current GMT pay month, daily dates are deduplicated, holiday dates are excluded from worked days, only own documents are counted, pending tasks are excluded, and selecting the prior month changes the totals.
- [x] Add separate assertions for unavailable history and successful empty history, plus no horizontal overflow at 390px and desktop width.
- [x] Update the portal navigation browser test from two slides to three and assert the third slide title and its current-month control.
- [x] Run `npm run test:dashboard-updates` and `npm run test:portal:navigation`; the new assertions failed for the missing slide/metrics before implementation.

### Task 2: Request and calculate personal history totals

- [x] Update `GMTPortalApi.history(kind, options)` in `portal-api.js` to append a validated `limit` query parameter when supplied, capped at 500; preserve existing requests when no limit is supplied.
- [x] Add the “My statistics” slide to `portal/index.html` with an accessible pay-month selector and cards for worked days, holiday days, estimates written, job cards raised and tasks completed.
- [x] In `portal/dashboard-updates.js`, request `history("all", { limit: 500 })` once and use that response for both the existing notifications and the new statistics slide.
- [x] Filter personal statistics by the active profile’s owner OID/UPN; assign daily timesheet rows with `GMTPayPeriods.payMonthKeyForDate`; count distinct worked and holiday dates; group authored estimates/job cards and completed tasks by their explicit activity date, falling back to submission date only when no activity date exists.
- [x] Render the current month by default, offer prior pay months found in the available personal records, refresh totals when the selector changes, and show distinct loading, no-records and unavailable messages with the source-availability note.
- [x] Update `dashboard-updates-smoke.mjs` fixtures to assert the history request uses the 500-record bound.

### Task 3: Style, version and verify the dashboard release candidate

- [x] Add responsive statistics-card and month-control styles in `portal.css`; keep the slide readable without horizontal overflow on phone and desktop widths.
- [x] Bump the cache versions for the changed dashboard script, API wrapper and stylesheet in `portal/index.html`.
- [x] Run `npm run test:dashboard-updates`, `npm run test:portal:navigation`, and `git diff --check`; the browser tests pass and existing clock, notifications and task-board slides continue to work.
- [x] Review the final diff for user-scoped filtering, accurate pay-month boundaries, accessible slide labels, and no changes to production records or backend routes.
