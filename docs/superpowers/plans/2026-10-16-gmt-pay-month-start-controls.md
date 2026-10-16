# GMT pay-month start controls implementation plan

## Base and boundaries

Base: `e73795b04a27f089d05e836f9d1ab5f3f3487a05` (`origin/main`).
Spec: `docs/superpowers/specs/2026-10-16-gmt-pay-month-start-controls-design.md`.

Global constraints: keep the existing 28-day schedule as the default; use a
protected D1 override and audit trail; keep the exact start-date permission on
the server; preserve all source records and times; do not edit the active
responsive-layout checkout; do not deploy the new permission until the user
confirms at the action-time gate.

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
6. Review the resulting diff and prepare a branch/PR. Stop before merge,
   allowlist configuration, or production data writes until the user confirms
   the exact five identities and release action.

## Verification boundary

No automated tests will be added or run in this task unless the user asks for
tests. Before the approval gate, inspect the changed source and diff for
consistency, syntax, scope, and deployment wiring. Report any verification
that could not be performed.
