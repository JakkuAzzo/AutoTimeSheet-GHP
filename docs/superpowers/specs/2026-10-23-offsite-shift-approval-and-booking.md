# Off-site shift approval and booking

## Problem

The current off-site page records only a clock-in and clock-out in a separate D1 table. Manager approval changes that entry's status but does not create a timesheet clock record. The dashboard's clock and lunch controls use a different path and send directly to Accounts. The off-site page also uses the shared pale-yellow eyebrow style on a white background, which is hard to read. The dashboard's optional geolocation helper inserts raw coordinates into the editable location field.

## Goals

- Provide off-site clock-in, lunch-start, lunch-end and clock-out actions on the off-site page and dashboard.
- Keep off-site attendance out of payroll until an assigned Duty Manager approves the completed shift.
- On approval, produce an idempotent daily clock record with the shift date, times, location and approval lineage in the employee's protected portal timesheet history.
- Allow staff to book an off-site shift in advance with a start, end and named location; require manager approval and allow later changes with a new approval.
- Keep planned bookings separate from worked/payroll time. Approval of a plan alone never creates worked hours.
- Keep the in-office dashboard path intact and let staff choose in-office or off-site when using its clock controls.
- Display a human-readable, editable road, business or site name. Never display raw coordinates in the location field.
- Give “Separate from payroll clock records” a readable dark green foreground on its light background.

## Approval unit options

1. **One completed shift (recommended):** clock-in, lunch and clock-out timestamps are collected in one D1 shift. After clock-out, one manager decision approves or rejects the whole set. Only an approved complete shift creates the daily timesheet record.
2. **Each event separately:** every clock or lunch action has its own manager decision before it can join the timesheet. This creates partial-day approval states and requires a manager to review up to four items per shift.

The first option preserves the current page's completed-shift review and gives the manager one coherent set of times to approve. Use it as the default because the existing workflow already reviews a completed shift.

## Proposed workflow

### Actual off-site shift

1. The employee selects Off-site and enters an editable site name.
2. Clock-in starts an active shift. Lunch start, lunch end and clock-out are recorded against that shift in Europe/London local time, using the existing idempotent request pattern.
3. Clock-out moves the whole shift to `awaiting_approval`; it is still absent from payroll/timesheet records.
4. An assigned manager who did not submit the shift reviews the site and complete times. Rejection requires a reason. A manager cannot approve their own entry.
5. Approval atomically closes the approval and creates one protected `clock` record for that employee/day, keyed by the off-site entry ID. The record carries the actual start, lunch start/end, finish, named site, and manager decision metadata. Duplicate approval retries cannot create duplicate timesheet records.
6. The approved record appears in the employee's protected clock/timesheet history only after approval and uses its actual work date for pay-month placement. The current Power Automate intake contract is marked `target-contract-not-live`; it reports an invalid mailbox trigger and a hard-coded workbook route. This feature must not dispatch real off-site payroll to that unverified route. A later provider certification is required before claiming SharePoint/workbook delivery.

### Advance booking

1. “Book off-site” captures date, planned start/end, named location and optional note.
2. The booking is `awaiting_approval` until an assigned manager approves or rejects it; rejection requires a reason.
3. A booking is planning data and never contributes worked hours or creates a payroll clock record.
4. The owner may amend a booking. Any amendment to an approved booking creates a version, returns it to `awaiting_approval`, and requires a fresh manager decision. Booking changes do not rewrite actual punches.
5. The employee may start an actual shift from an approved booking; actual times remain separately recorded and require final shift approval.

### Dashboard clock

- Add a location-type selector to the existing daily clock form.
- In-office continues through the current direct-to-Accounts workflow.
- Off-site clock/lunch actions use the protected shift workflow above. Do not submit these events directly to Accounts before sign-off.
- Keep the site name as an ordinary editable text field. Remove the behavior that writes raw GPS coordinates into it; do not send precise device coordinates to a third-party geocoder.

## Data and security

- Keep actor identity from the verified Entra token; ignore browser-supplied employee identity for ownership.
- Preserve the configured Off-site Duty Manager allowlist, deny self-approval, require rejection notes, and maintain immutable audit events.
- Add schema constraints for allowed states, event ordering, valid booking intervals, and one active actual shift per employee.
- Use stable request IDs for all write operations and an entry-linked stable payroll record ID for the approval bridge.
- Preserve original booked values and amendments for audit. Do not rewrite a delivered payroll row silently; actual corrections use the existing controlled correction workflow.
- Keep in-office timesheet submissions and existing payroll records unchanged.

## UI and accessibility

- Use dark green `#123d1d` or darker for the eyebrow on white; verify readable contrast.
- Add visible labels for location type, site, booking date, start and end.
- Distinguish planned and actual times and clearly show “Awaiting manager sign-off”, “Approved”, or “Rejected”.
- Show approved, amended and rejected booking history with decision notes and timestamps.
- Keep the current mobile/tablet single-column layout and prevent horizontal overflow.

## Acceptance checks

- Pending/rejected off-site shifts never appear in protected timesheet history or payroll dispatch.
- An approved completed shift creates exactly one daily record for the verified owner and correct pay month, including all four timestamps when present.
- A retry of approval cannot duplicate the record or trigger duplicate delivery.
- Booking approval/amendment changes planning status only and never creates worked time.
- A modified approved booking requires a new approval; prior versions and decision history remain visible.
- Non-managers cannot review; managers cannot self-approve; rejection requires a reason.
- Dashboard in-office actions still use the established path; off-site actions never bypass approval.
- Location fields contain editable human-readable text and never show raw latitude/longitude.
- The off-site heading label has readable contrast and the page remains usable on mobile and desktop.
- Synthetic checks cover API authorization, state transitions, idempotency, payroll isolation, and the browser flows. Live payroll writes are not used for validation.

## Provider boundary

The checked-in `power-platform/timesheet-monthly-upsert-flow-spec.json` labels the current intake contract `target-contract-not-live`, reports an invalid shared-mailbox trigger and a hard-coded workbook route, and requires a fresh live run and workbook readback before replay. This feature creates protected portal timesheet history after approval; it must not claim or attempt a live SharePoint/workbook update until that upstream route is separately certified.

## Out of scope

- Editing or retroactively importing real staff payroll records during implementation.
- Automatically converting approved planned booking times into paid hours.
- Sending precise GPS coordinates to an external geocoding service.
- Changing in-office clock approval policy.
