# GMT Staff Portal Proof Implementation

## Objective

Prove an authenticated, internal operations portal without changing the public
GitHub Pages submission routes or placing Microsoft credentials in browser code.
The proof is built in the free `GMT Portal Development` Dataverse environment.

## Implemented baseline

| Item | Status |
| --- | --- |
| Developer Dataverse environment | Created in Europe; non-production only |
| Custom solution | `GMTWebAppSolution`, publisher prefix `gmt` |
| Staff app shell | Published model-driven app: `GMT Staff Portal` |
| Proof tables | Six tables included in `GMTWebAppSolution`: Timesheet Submission, Clock Event, Audit Submission, Job Card, Task, Calendar Event |
| Existing operations baseline | Accounts shared mailbox, SharePoint roots, Lists and Timesheet Intake flow remain unchanged |

The proof tables use the environment-generated `crbf9_` prefix. They are now
included in `GMTWebAppSolution` and are suitable for interface and flow testing
only. Production promotion requires a clean `gmt_` schema inside the solution;
this proof must not be promoted as-is.

## Portal navigation

The model-driven app should expose these work areas, in this order:

1. Timesheets: weekly submission index and submitted totals.
2. Clock events: clock in/out and lunch start/end records.
3. Audit: submitted audits, warnings and workbook links.
4. Job Cards: new, planned, in-progress and completed work.
5. Tasks: assigned work with due date, priority and status.
6. Calendar: records linked to the shared operational calendar.

The public app remains the employee submission interface during the trial. The
model-driven app is an Entra-authenticated accounts/operations workspace, not a
replacement for the public website.

## Required calendar automation

Use the calendar named `GMT Operational Calendar` owned by
`Amanda.BB@gmt-services.co.uk`.

| Source | Triggered change | Calendar action |
| --- | --- | --- |
| Job Card | New/planned date changed | Create or update all-day event |
| Job Card | Cancelled/completed where policy removes event | Delete event |
| Task | Created/due date changed | Create or update all-day event |
| Task | Cancelled/completed where policy removes event | Delete event |

Flows must write the source table row ID and Outlook event ID to Calendar Event
records. A failed calendar action must be visible for accounts to retry; it
must not silently discard the Job Card or Task update.

## Test plan

Use non-sensitive sample records only.

1. Open the staff app as an authorised GMT user and verify Entra sign-in is
   required.
2. Add a sample job card with a planned date; confirm one all-day event appears
   in `GMT Operational Calendar` and its Outlook event ID is stored.
3. Move the date; confirm the same event updates rather than duplicates.
4. Add a sample task with a due date; repeat the create/update checks.
5. Cancel each sample record; confirm the configured delete behaviour and
   failure logging.
6. Verify Timesheet, Clock Event and Audit records do not create calendar
   events.
7. Confirm the existing Timesheet Intake flow and FormSubmit routes still work.

## Promotion gates

- Recreate the approved production schema using `gmt_` names in
  `GMTWebAppSolution`.
- Add the tables and flows to the solution, export it, and review the unpacked
  diff.
- Assign least-privilege Dataverse security roles through GMT Entra groups.
- Use GMT-owned connection references, with two named GMT flow owners.
- Confirm Power Apps/Power Automate Premium licensing and capacity.
- Complete manual calendar, timesheet intake and data-retention checks.
- Obtain Accounts and director approval before moving any live operational data.
