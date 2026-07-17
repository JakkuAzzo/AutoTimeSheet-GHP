# GMT Operational Readiness Build

## Verified baseline

| Asset | Current state |
| --- | --- |
| Shared intake mailbox | `Accounts@gmt-services.co.uk` |
| Shared operational calendar | `GMT Operational Calendar` created in Amanda Brown-Bennett's mailbox on 16 July 2026 |
| Timesheet Intake flow | Active in the default Power Automate environment |
| Intake trigger | New email in the Accounts shared mailbox, `[GMT][TIMESHEET]` subject filter, attachments required and included |
| Intake index action | Creates a SharePoint list item |
| Developer portal | `GMT Portal Development`, non-production only |
| Dataverse proof | `GMTWebAppSolution` contains six proof tables and the GMT Staff Portal model-driven app |

The current Timesheet Intake flow must remain operational while the following work is built and tested. Do not replace its FormSubmit source or redirect the public GitHub Pages routes.

## Shared calendar prerequisite

The approved target is a calendar named `GMT Operational Calendar` owned by
`Amanda.BB@gmt-services.co.uk`. It is a company operational calendar, not a
private employee calendar.

Before creating flows, an Exchange administrator must grant the Power Automate connection owner:

1. Delegated calendar editor rights to Amanda's `GMT Operational Calendar`.
2. Ability to create, update and delete events in that calendar.
3. A second GMT administrator as mailbox/calendar and flow co-owner.

Current verification: `GMT Operational Calendar` exists under Amanda's Outlook
calendar and Jason, Matthew, Ainsley, Simon, Faith, Michelle and Lidia have
read-only access. The calendar must still be verified from the GMT-owned Power
Automate connection before a flow is enabled. Do not create a personal-calendar
fallback.

The existing GMT-owned connection has been checked in Power Automate and exposes
Office 365 Outlook `Create event (V4)`, `Update event (V4)` and `Delete event
(V2)`, plus SharePoint folder/file actions. This verifies connector capability,
not calendar permission or production readiness.

The field-level automation contract and current build status are recorded in
[calendar-automation-contract.json](calendar-automation-contract.json) and
[operational-build-status.md](operational-build-status.md).

## Flow A: Job Card calendar synchronisation

**Environment:** `GMT Portal Development` until approved for production.

**Trigger:** Dataverse `Job Card` row added, modified or deleted.

**Filter:** run only when planned date, status, job reference, client or site changes.

**State required on the Job Card / Calendar Event record:**

- source record ID
- source type `jobcard`
- calendar ID
- Outlook event ID
- synchronisation status
- last synchronised timestamp
- last error text

| Condition | Required calendar operation |
| --- | --- |
| New/planned Job Card with date and no event ID | Create all-day event |
| Planned date/details change with event ID | Update the same event |
| Cancelled or completed where policy removes booking | Delete the event and mark it removed |
| Missing calendar ID/event ID or connector failure | Mark sync failed; do not discard the Job Card |

**Event title:** `[GMT][JOBCARD] {job reference} | {client}`

**Event body:** job reference, client, site, engineer, planned date and a Dataverse record link. Do not insert images or unrelated email attachment data into the event.

## Flow B: Task calendar synchronisation

**Trigger:** Dataverse `Task` row added, modified or deleted.

**Filter:** run only when due date, status, task title, owner or linked job reference changes.

The same event identity and failure-handling pattern as Job Cards applies.

**Event title:** `[GMT][TASK] {task title}`

Use an all-day event on the due date. A completed/cancelled task should follow the agreed delete/retain policy; default to deletion only after Accounts signs off the behaviour.

## Flow C: Timesheet attachment storage extension

The first storage implementation is complete: `GMT Portal - Timesheet Intake`
uses an attachment loop and SharePoint `Create file` to store attachments in
`GMT Web-App/Timesheets/Incoming`. A replayed harmless sample created both the
XLSX and CSV successfully. Keep this landing folder until the source email has
validated structured metadata; the sample also demonstrated that an inline PNG
can be present, so add inline-image filtering before using this flow for routine
submissions.

1. Retain the existing Accounts trigger, structured subject filter and attachment requirement.
2. Filter out inline images and non-timesheet attachments.
3. Parse the approved metadata fields from the email body.
4. Create `GMT Web-App/Timesheets/{year}/{month}/{employee}/` when absent.
5. Move accepted files from `Incoming` into that folder.
6. Create/update the Timesheet Submissions list row with the folder and file links.
7. On missing metadata or attachment failure, send the email/record to `Failed - Needs Review`; never silently mark it processed.

## Outlook folders and rules

Create these folders under the Accounts mailbox:

```
GMT Portal/
  Timesheets/
  Audit/
  Job Cards/
  Tasks/
  Failed - Needs Review/
  Processed/
```

Rules must use the structured subject as the dependable fallback:

- `[GMT][TIMESHEET]` -> Timesheets
- `[GMT][AUDIT]` -> Audit
- `[GMT][JOBCARD]` -> Job Cards
- `[GMT][TASK]` -> Tasks

Do not make a rule that hides failed or malformed submissions.

## Non-sensitive proof tests

1. Create a sample Job Card with a planned date. Confirm one all-day event, one stored event ID and no duplicate after a subsequent update.
2. Create a sample Task with a due date. Confirm the equivalent lifecycle.
3. Cancel each sample source and confirm the agreed event outcome.
4. Submit a sample Timesheet email with harmless XLSX/CSV test files. Confirm folder creation, attachment storage, list metadata and retry handling.
5. Verify the public app, FormSubmit routes and existing Timesheet Intake flow remain unchanged.

## Manual release gates

- Accounts approves the calendar cancellation/completion policy.
- Shared calendar access is verified for two GMT administrators.
- Each flow has two GMT co-owners and GMT-owned connections.
- Real iPhone Safari submissions are verified after the operational changes.
- No production Dataverse promotion until licensing, security roles and the `gmt_` production schema are approved.
