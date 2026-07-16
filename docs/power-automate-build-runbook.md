# GMT Power Automate Build Runbook

## Purpose

This runbook turns the GMT GitHub Pages submission emails into company-owned files
and operational records without putting Microsoft credentials in the website.

The website remains static. FormSubmit delivers messages to a business mailbox;
Outlook and Power Automate then file attachments and create Microsoft List records.

## Programmatic Administration

The browser maker portals remain useful for first-time connection setup, but
GMT can now keep the Power Platform solution and administration process
repeatable from a Mac. The repository contains the local scaffold at
`power-platform/`.

| Area | Supported route | Use at GMT |
| --- | --- | --- |
| Power Platform solution | Power Platform CLI (`pac`) | Export, unpack, review and deploy managed/unmanaged solutions. |
| Exchange / shared mailbox rules | Exchange Online PowerShell | Inspect mailbox access and create/review inbox rules after change approval. |
| Shared calendar | Microsoft Graph PowerShell or Outlook connector | Create/update events in a GMT-owned operational calendar. |
| SharePoint files and Lists | Power Automate, Graph, or PnP.PowerShell | File submitted attachments and maintain company-owned indexes. |
| Staff portal | Power Apps + Dataverse | Authenticated internal application, not a public GitHub Pages integration. |

Use delegated interactive authentication while the team is establishing the
solution. Later, use an Entra application identity with narrowly-scoped
permissions and certificate-based authentication for unattended deployment;
never place an app secret in the website or this repository.

### Current Dataverse Gate

On 15 July 2026, GMT provisioned the free non-production Developer Plan
environment `GMT Portal Development` and imported the empty
`GMTWebAppSolution`. It is limited to development/test. No live data, production
flow, paid Azure linkage, or staff production rollout belongs there. See
`power-platform/developer-environment.md` for the supported scope and promotion
gate.

## Confirm Before Build

Do not create or enable production flows until these are confirmed:

- A Microsoft 365 business mailbox or shared mailbox can receive external email.
- The mailbox owner has an Exchange Online mailbox, not only a guest identity.
- The Microsoft 365 account creating flows has access to Outlook, SharePoint and Lists.
- A SharePoint site/document library has been chosen for company-owned files.
- FormSubmit has activated each business destination separately.

The currently approved timesheet route remains the fallback until the business
route has successfully processed a real test submission.

## Recommended Ownership

| Item | Recommended owner |
| --- | --- |
| Receiving mailbox | `accounts@...` business mailbox or shared mailbox |
| Flow owner | GMT Microsoft 365 administrator plus one accounts co-owner |
| File storage | GMT SharePoint document library |
| Metadata index | GMT Microsoft Lists |
| Website delivery | GitHub Pages / future authenticated portal |

Never use a personal Outlook guest account as the long-term flow connection.

## One-time Microsoft 365 Setup

1. Create or confirm the receiving business mailbox. Prefer one mailbox with
   plus-addressing, or separate shared mailboxes if plus-addressing is disabled.
2. Create Outlook folders:

   ```text
   GMT Portal/
     Timesheets/
     Audit/
     Job Cards/
     Tasks/
     Failed - Needs Review/
     Processed/
   ```

3. Create a SharePoint document library or top-level folder named `GMT Web-App`.
4. Create these Microsoft Lists: `Timesheet Submissions`, `Audit Submissions`,
   `Job Cards`, `Tasks`, and `Calendar Requests`.
5. Give the accounts team access to the mailbox, SharePoint library and Lists.
6. Create Outlook rules that place messages into the appropriate `GMT Portal`
   folder using both recipient tags and subject tags as fallback.

## Required List Fields

Create the fields below before building the flows. Use plain text for external
URLs and metadata that may contain inconsistent formats.

### Timesheet Submissions

`Record ID`, `Employee Name`, `Employee Email`, `Week Start`, `Week End`,
`Year`, `Month`, `Worked Hours`, `Basic Hours`, `OT 1.5`, `OT 2.0`, `Status`,
`Submitted At`, `XLSX Link`, `CSV Link`, `Folder Link`, `Source Email Subject`,
`Processed By Flow`.

### Audit Submissions

`Record ID`, `Audit Name`, `Year`, `Month`, `Parsed Files`, `Parsed Rows`,
`Warnings`, `Parse Errors`, `Status`, `Submitted At`, `XLSX Link`,
`Warnings CSV Link`, `Folder Link`, `Source Email Subject`, `Processed By Flow`.

### Job Cards

`Job Reference`, `Client`, `Site Address`, `Engineer`, `Planned Date`, `Year`,
`Month`, `Status`, `Submitted At`, `Attachment Folder Link`, `Image Link`,
`Source Email Subject`, `Processed By Flow`.

### Tasks

`Task ID`, `Task Title`, `Employee`, `Assigned To`, `Company / Job Ref`,
`Status`, `Priority`, `Due Date`, `Year`, `Month`, `Created At`, `Updated At`,
`Folder Link`, `Processed By Flow`.

Task requests initially use `Pending approval`. Accounts approval changes them
to `To-Do`; operational progress values are `In-Progress`, `Completed`, and
`Cancelled`.

### Calendar Requests

`Request ID`, `Event Title`, `Event Date`, `Event Type`, `Requested By`,
`Notes`, `Status`, `Submitted At`, `Approved By`, `Approved At`, `Outlook Event ID`,
`Processed By Flow`.

Calendar requests initially use `Pending approval`. Only an approved request is
allowed to create an event in `GMT Operational Calendar`.

## Flow 1: Timesheet Intake

**Trigger:** Outlook: *When a new email arrives (V3)* in `GMT Portal/Timesheets`.

1. Verify subject contains `[GMT][TIMESHEET]` and the message has attachments.
2. Read the machine-readable `gmt_*` fields from the email body.
3. Validate employee and week-start values. If either is missing, move the
   message to `GMT Portal/Failed - Needs Review` and stop.
4. Derive `{year}`, `{month}` and a safe employee folder name.
5. Create `GMT Web-App/Timesheets/{year}/{month}/{employee}/` if required.
6. For each attachment, save the XLSX and CSV files into the folder.
7. Create one `Timesheet Submissions` List item with metadata and file links.
8. Find the `GMT Calendar Sync - {employee} - {week-start}.json` attachment.
9. Read and parse the JSON attachment. It contains one all-day `timesheet`
   event plus one all-day event for each grouped `Sick`, `Holiday`, or
   `Time Off` period.
10. For each event, use Outlook **Create event (V4)** with the calendar set to
   `GMT Operational Calendar`. Use `startDate` as the all-day start and
   `endDateExclusive` as the all-day end; do not subtract a day from the end.
11. Move the email to `GMT Portal/Processed`.

### Calendar visibility

`GMT Operational Calendar` is the operational source of truth. Grant each
staff account reviewer/editor access to this shared calendar so the generated
timesheet and absence events appear alongside their own Outlook calendars.

The Flow must not attempt to write directly into every employee's private
calendar using the accounts connection. That would require delegated access or
separate Microsoft Graph permissions for each employee. The shared calendar
keeps the workflow company-owned and does not require browser-side Microsoft
credentials.

The timesheet submission includes these fields for validation and future
troubleshooting:

- `gmt_calendar_sync: requested`
- `gmt_calendar_name: GMT Operational Calendar`
- `gmt_calendar_event_count`
- `gmt_employee_upn` when the employee used the authenticated portal

**Test:** submit a one-day Sick test timesheet. Confirm the shared calendar
contains both the weekly `Timesheet submitted` event and the all-day `Sick`
event, then remove the test events.

**Test:** submit one small real timesheet; verify two attachments, one list item,
correct folder path, and the processed email.

## Flow 2: Audit Intake

**Trigger:** Outlook: *When a new email arrives (V3)* in `GMT Portal/Audit`.

1. Check for `[GMT][AUDIT]` and audit workbook attachment.
2. Read parsed file/row/warning/error values from `gmt_*` fields.
3. Derive `{year}` and `{month}` from submitted timestamp.
4. Create `GMT Web-App/Audit/{year}/{month}/`.
5. Save the corrected audit XLSX and warnings CSV.
6. Create one `Audit Submissions` item.
7. Move valid mail to `Processed`; move missing/invalid mail to `Failed - Needs Review`.

## Flow 3: Job Card Intake

**Trigger:** Outlook: *When a new email arrives (V3)* in `GMT Portal/Job Cards`.

1. Check for `[GMT][JOBCARD]`.
2. Read job reference, client, site, engineer and planned date.
3. Require job reference and client; otherwise move to `Failed - Needs Review`.
4. Create `GMT Web-App/Job Cards/{year}/{month}/{company}/{jobRef}/`.
5. Save the email body as HTML or text and save optional image attachments.
6. Create or update a single `Job Cards` List item for the job reference.
7. Move email to `Processed`.

## Flow 4: Task Intake and Approval

**Trigger:** Outlook: *When a new email arrives (V3)* in the GMT Portal task
folder, with subject `[GMT][TASK]`.

1. Validate the `gmt_type=task`, task ID, title and requester metadata.
2. Create or update a `Tasks` List item with `Status = Pending approval`.
3. Notify the licensed accounts approver group. The unlicensed requester does
   not receive List edit permissions.
4. Use **Start and wait for an approval** or an accounts-owned List approval
   view. On approval set status to `To-Do`; on rejection set it to `Cancelled`
   and notify the requester.
5. Save optional files under
   `GMT Web-App/Tasks/{year}/{month}/{employee}/{status}/` and move the source
   email to `Processed`.

## Flow 5: Calendar Request Approval

**Trigger:** Outlook: *When a new email arrives (V3)* in the GMT Portal calendar
folder, with subject `[GMT][CALENDAR]`.

1. Validate `gmt_type=calendar`, request ID, title, date and requester.
2. Create a `Calendar Requests` List item with `Status = Pending approval`.
3. Send an approval to the licensed accounts group.
4. When approved, use Outlook **Create event (V4)** through the
   `Amanda.BB@gmt-services.co.uk` connection and select `GMT Operational Calendar`.
5. Store the returned Outlook Event ID, approver and approved timestamp on the
   List item. On rejection, update the record to `Cancelled` and notify the
   requester.

Unlicensed portal users can submit the request through the authenticated site,
but they must not be granted direct write access to the List or Outlook calendar.

## Cutover and Rollback

1. Keep the existing FormSubmit routes live during testing.
2. Activate one business destination per category and submit a real test message.
3. Confirm Outlook routing, file saving and List creation before adding the
   business endpoint to `config.js`.
4. If a category fails, blank only its category-specific endpoint and redeploy;
   the app falls back to the approved legacy route.
5. Do not delete historic emails or legacy routes until accounts signs off.

## Go-live Evidence

Record for each category:

- FormSubmit destination activation confirmation.
- Screenshot of Outlook rule.
- Flow run ID and successful run history.
- SharePoint folder link.
- Microsoft List record link.
- Email/attachment delivery evidence.

## Security Boundaries

- No Microsoft credentials, Graph tokens, SharePoint URLs with write tokens, or
  mailbox secrets in GitHub Pages JavaScript.
- Power Automate connections are owned by GMT Microsoft 365 accounts.
- SharePoint owns files rather than an individual employee's OneDrive.
- Keep a second GMT administrator as flow co-owner to avoid an individual account
  becoming a single point of failure.
