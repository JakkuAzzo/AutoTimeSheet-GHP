# GMT pay-month start controls

## Goal

Keep the current pay month, the next month, submitted timesheets, and generated
employee sheets on one shared set of pay-month boundaries. Let only the
authorised Accounts and payroll identities change a current or next start date
from a calendar day action.

## Confirmed period change

October 2026 is a five-week pay month. Its current start remains 21 September
2026. Its following pay month starts on 26 October 2026, so the October
payroll-Friday end is 23 October and the October period includes 24–25 October
before the November period begins. The selected start is stored as the start
for pay month `2026-11`.

Existing 28-day cadence continues from an explicitly selected start until a
later current/next-month change replaces a boundary. Month labels stay attached
to their selected pay-month keys, even when a period begins in the prior
calendar month.

## User flow

1. An authorised user clicks any dated cell in a portal calendar.
2. The existing day-actions dialog includes “Set pay-month start day”.
3. The dialog shows the clicked date and two explicit choices, such as
   “Current October 2026” and “Next month November 2026”.
4. Before saving, it states which month key will change and the resulting
   previous/current/next boundaries. The user confirms the choice.
5. The protected Worker validates and saves the setting, then the page reloads
   the shared rules and refreshes the visible sheet/calendar data.

Users without the dedicated server-side permission do not see the action, and
direct API writes from those accounts are rejected.

## Shared calculation and persistence

- Extend the common pay-period helper to accept per-month start overrides while
  preserving the existing 28-day anchor as the default.
- `periodForDate`, `periodForMonth`, prior/current edit windows, workbook rows,
  generated XLSX/CSV metadata, and Worker filing/validation all use the same
  override map.
- The Worker stores current/next month start settings in D1 and records each
  effective change with actor, timestamp, month key, old date, and new date.
- The browser loads rules through the authenticated portal API. Browser storage
  and public calendar JSON are never authoritative for payroll boundaries.
- Calendar and sheet views display the configured month span; for a Monday
  boundary the payroll-Friday end remains the Friday before the following
  Monday, with the intervening weekend included in that month.

## Access and validation

- Use a dedicated Worker allowlist variable for the specific Accounts,
  Amanda, and Faith identities. Do not infer this permission from ordinary
  staff status or a client-side flag.
- Only the server accepts changes for the currently active pay month or its
  next pay month.
- Reject invalid dates, starts that collide with adjacent periods, a current
  start after today, a next start on/before today, and stale edits whose
  expected old date no longer matches.
- A no-op save does not create an audit event. Every real change does.

## Scope and release

The web-app's protected Worker and all pay-month sheet projections change
together. Existing source rows keep their exact times and record IDs; only
their computed month membership changes at the new boundary. The October 2026
setting is applied as November 2026 start = 26 October 2026. The release
requires the D1 migration, the dedicated allowlist configuration, and the
Pages/Worker deployment. Do not broaden SharePoint, Outlook, or calendar-feed
permissions.

## Acceptance criteria

- 21 September–25 October 2026 resolves to October 2026; 26 October–22
  November resolves to November 2026; 23 November begins the following
  28-day period.
- Current and next month labels are explicit in the calendar action dialog.
- Only the configured identities can submit the change; the Worker rejects
  unauthorised, stale, invalid, or overlapping updates.
- The Worker audit row identifies the actor and before/after values.
- Portal pay-month sheets and download generation use the persisted boundary
  and retain all existing source IDs and daily values.
- Other active GMT work, including the separate responsive-layout task, remains
  untouched.
