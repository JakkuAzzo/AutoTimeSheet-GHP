# GMT pay-month start controls implementation plan

## Base and boundaries

Base after rebase: `1f08246` (`origin/main`, includes PR #108).
Spec: `docs/superpowers/specs/2026-10-16-gmt-pay-month-start-controls-design.md`.

Global constraints: keep the existing 28-day schedule as the default; use a
protected D1 override and audit trail; keep the exact start-date permission on
the server; preserve all source records and times; do not edit the active
responsive-layout checkout. The user has now requested the calendar control
for `acc.gmtelect`, `accounts@gmt`, Amanda, and Faith, and requested the
26 October 2026 start. Use the exact previously confirmed sign-in identities
in the dedicated Cloudflare Worker secret; do not broaden timesheet viewing.

## Tasks

1. Extend `pay-periods.js` with validated per-month start overrides, adjacent
   period boundaries, payroll-Friday end dates, and current/next month lookup.
   Keep the existing API contract for callers without loaded overrides.
2. Add Worker identity capability, D1 migration/audit table, protected settings
   GET/POST endpoints, strict current/next and stale-write validation, and use
   the same rules for timesheet routing, edit-window policy, and history output.
3. Add the authenticated client API and load the Worker override map before
   calendar, timesheet, form, and pay-month-sheet initialization. Refresh
   affected projections after a successful date change.
4. Add the calendar-day action and accessible confirmation UI with explicit
   current/next month names. Bind its visibility to the Worker permission.
5. Update monthly sheet window text so October shows the extended pay period
   and the 26 October next-period boundary, while preserving row IDs and values.
6. Review the resulting diff and prepare a branch/PR. After source review,
   apply the dedicated allowlist as an encrypted Worker secret, deploy the
   migration and Worker/Pages changes, then set November 2026 to start on
   26 October through the authenticated API so the actual signed-in actor is
   recorded in the audit table.

## Verification boundary

No automated tests will be added or run in this task unless the user asks for
tests. Before the approval gate, inspect the changed source and diff for
consistency, syntax, scope, and deployment wiring. Report any verification
that could not be performed.
