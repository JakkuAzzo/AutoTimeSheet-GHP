# GMT Operational Data Architecture

## Decision

GMT will use Microsoft 365 as the production operational data platform:

- SharePoint document library: source and generated files.
- Microsoft Lists: searchable, sortable operational records.
- Outlook shared calendar: approved operational events and absences.
- Power Automate: validated intake, approval, filing, reminders and monthly reporting.
- GitHub Pages staff portal: authenticated request interface only.

This avoids a second identity, database and file store in Firebase while GMT is
already using Microsoft Entra, Outlook and SharePoint. The existing Power Apps
Developer Plan remains a non-production place to test the equivalent Dataverse
model; it must not become the live system of record.

## Storage Ownership

Create a company-owned SharePoint site and document library:

```text
GMT Operations
  GMT Web-App/
    Timesheets/{year}/{month}/{employee}/{yyyy-mm-dd}/
    Audit/{year}/{month}/
    Job Cards/{year}/{month}/{company}/{jobRef}/
    Tasks/{year}/{month}/{employee}/{status}/
    Calendar Requests/{year}/{month}/{requestId}/
```

No employee OneDrive is the authoritative archive. Accounts and an additional
GMT administrator must be co-owners of the site, Lists and flows.

## Authoritative Lists

| List | Purpose | Key fields |
| --- | --- | --- |
| `Timesheet Submissions` | Weekly generated timesheets | Record ID, employee, week, worked/basic/OT totals, status, attachment links |
| `Clock Events` | Clock, lunch, full-day and absence records | Record ID, employee, date, action, absence reason, times, worked hours, links |
| `Job Cards` | New and updated job cards | Job reference, client, site, engineer, status, attachment folder |
| `Tasks` | Requests and approved operational work | Task ID, requester, assigned staff, priority, due date, status |
| `Calendar Requests` | Approval queue for calendar changes | Request ID, title, date, requester, status, Outlook event ID |
| `Audit Submissions` | Corrected audit exports | Record ID, files, rows, warnings, parse errors, attachment links |

Use `Record ID` as the idempotency key. A Power Automate retry must update the
existing record rather than create a duplicate.

## Portal Boundary

The browser may submit a request but does not receive direct write credentials
for SharePoint, Lists, Dataverse or Outlook. The current route is:

```text
Entra-authenticated portal -> FormSubmit -> GMT mailbox -> Power Automate
  -> SharePoint + Microsoft Lists + approved Outlook calendar
```

Once this is proven, a small company-owned backend/worker may use Microsoft
Graph with server-side credentials to provide read-only portal views of the
approved records. That is a later phase; no Graph secret or SharePoint token is
permitted in GitHub Pages JavaScript.

## Firebase Position

Firebase is not selected for the production baseline. It is appropriate only if
GMT later approves a separate Google Cloud environment, Firebase Authentication,
Firestore and Storage security rules, budget alarms, a Cloud Functions backend
and a data-retention policy. That would create a parallel source of truth and
does not simplify the existing Outlook/SharePoint workflow.

## Go-live Gates

1. Fix inbound custom-domain delivery for `@gmt-services.co.uk` or retain a
   confirmed working business receiving route.
2. Create the SharePoint site/library and Lists above.
3. Build the documented Power Automate intake flows with two GMT co-owners.
4. Test each submission type through to List item, file folder and calendar
   request.
5. Enable the reminder and monthly-register schedules only after a full month
   of reconciled test records.
