# GMT Un-Paid Timesheet Absence — Design

## Intent

Add an explicit `Un-Paid` absence value and make it contribute zero worked and paid hours through every portal and payroll calculation path. The user will make their requested October changes later through the protected pay-month correction workflow; this implementation must not alter existing payroll records.

## Selected approach

Use `Un-Paid` as a first-class absence status. It takes precedence over clock intervals, reported totals, and cached daily/overtime values. Preserve source times and notes for audit while writing zero for all hour measures. Keep the established Worker, D1 history, SharePoint workbook, and correction-record boundaries; do not write directly to a workbook or overwrite source evidence.

## Entry and calculation behavior

- Offer `Un-Paid` in the dashboard absence selector, weekly-timesheet absence planner and daily row selector, and permitted pay-month correction editor.
- For `Un-Paid`, set worked minutes/hours, basic hours, overtime x1.5/x2, and weighted paid hours to zero, regardless of start/finish times or any stale non-zero reported/calculated values.
- Keep the date, clock times, break details, notes, source identifiers, submission metadata, and audit trail. Show `Un-Paid` and 0h in summaries; do not count it as a worked day.
- Include `Un-Paid` in upcoming absence entries. Keep paid Holiday behavior and all existing absence meanings unchanged.
- Preserve each daily source record ID and submit corrections through the portal's `pay_month_correction` path, retaining the original records and audit history.

## User-managed October corrections

The user intends to correct these six dates in the October 2026 pay-month view after the code is available:

- 2026-10-16: currently `Holiday`, 08:00–17:00, counted as 9h in the protected pay-month record.
- 2026-10-19 through 2026-10-23: currently `Time Off`, 08:00–17:00, counted as 9h per day (45h total) in a submitted timesheet.

The protected editor must support setting all six daily statuses to `Un-Paid` and saving zero for every worked, basic, overtime, and paid measure. Preserve the original daily source identities and audit trail. Do not perform these live edits as part of implementation or change other employees or dates.

## Data and access boundaries

Use the authenticated portal's existing correction editor and Worker authorization. The Worker remains authoritative for normalization; SharePoint/workbook updates remain on the established Power Automate route. If the protected correction or delivery path rejects the update, leave source data unchanged and report the concrete blocker. Do not use browser storage or static files for payroll data, expand permissions, or add a new API endpoint.

## Verification

- Verify client calculations with `Un-Paid` rows containing valid clock times, stale `workedMinutes`/hours, and stale overtime values; every total must be 0.
- Verify Worker history normalization and correction validation return 0 for the status even when source totals are non-zero.
- Verify calendar/history/personal statistics show absence, 0h, and no worked-day count.
- Verify generated workbook/CSV rows and pay-month totals carry `Un-Paid` and 0 for each hour field.
- Verify paid Holiday remains an 8-hour paid day; Sick and Time Off retain existing semantics.
- Verify the protected editor supports the requested dates and preserves source IDs/audit history; do not perform a live correction during implementation.

## Out of scope

No change to holiday entitlement, pay rates, overtime rules, other staff records, Xero write access, identity or role permissions, or source submission history.
