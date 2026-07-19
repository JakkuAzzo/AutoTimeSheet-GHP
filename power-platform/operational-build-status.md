# GMT Operational Build Status

Updated 17 July 2026. This records what has been created, what is deliberately
not enabled, and the exact next implementation work.

## Completed in the GMT tenant

| Asset | State |
| --- | --- |
| `Accounts@gmt-services.co.uk` shared mailbox | Created and accessible in Outlook |
| `GMT Operational Calendar` | Created in Amanda Brown-Bennett's mailbox and shared read-only with staff |
| SharePoint roots | `Timesheets`, `Audit`, `Job Cards`, `Tasks` created in `GMT Web-App` |
| Microsoft Lists | Timesheet Submissions, Audit Submissions, Job Cards, Tasks created |
| Timesheet Intake flow | Active; shared-mailbox trigger uses `[GMT][TIMESHEET]`, requires attachments, creates the existing index row, and stores only non-inline `.xlsx`, `.csv`, and controlled `GMT Calendar Sync - *.json` attachments in `GMT Web-App/Timesheets/Incoming`. A replay succeeded after the filter change. |
| Developer portal | `GMT Portal Development` with the published GMT Staff Portal proof app |
| Connector capability check | The existing GMT-owned Power Automate connection exposes Office 365 Outlook create/update/delete event actions and SharePoint create-folder/create-file actions |

## Not enabled by design

1. Job Card and Task calendar flows. The existing proof schema does not yet
   carry planned/due dates, job/client details, Outlook event IDs or sync
   errors. Enabling a create-only flow now would make duplicates on updates.
2. Metadata-based Timesheet filing and calendar processing. The live filter
   accepts the controlled calendar JSON, while the current flow deliberately
   uses the safe `Timesheets/Incoming` landing folder until structured
   employee, year and month metadata is parsed and validated. The JSON now
   provides stable submission/event sync IDs, but no flow has yet used those
   IDs to create or update Outlook calendar events.
3. Outlook routing rules. The folder/rule contract is approved, but rules must
   be created and tested against a benign submission without moving existing
   Accounts mail. This prevents the current Accounts inbox from being hidden
   by an over-broad rule.
4. Production Dataverse promotion. The Developer proof uses `crbf9_` names;
   production must use a separately approved `gmt_` schema.

## Required schema additions

The canonical field/lifecycle definition is in
[calendar-automation-contract.json](calendar-automation-contract.json).

Add the listed fields through the unmanaged `GMTWebAppSolution`, publish, and
export before creating the flows. These are business fields, not frontend
configuration; no Microsoft credential or endpoint belongs in GitHub Pages.

## Flow build order

1. Add the Job Card and Task source/sync fields in the Developer solution.
2. Create `GMT Portal - Job Card Calendar Sync` and `GMT Portal - Task
   Calendar Sync` in that same solution.
3. Select a GMT-owned Office 365 Outlook connection and explicitly select
   `Amanda.BB@gmt-services.co.uk` / `GMT Operational Calendar`.
4. Save the flows disabled, add two GMT co-owners, and run the non-sensitive
   lifecycle tests from the contract.
5. Parse and validate structured Timesheet metadata, then create and use the
   employee/year/month hierarchy for accepted files rather than the `Incoming`
   landing folder.
6. Create the folders and narrowly scoped subject rules, then test one benign
   submission in each category.
7. Build `GMT Portal - Timesheet Calendar Sync` as a disabled draft. It must
   parse only the controlled JSON files, use `submissionId` and `syncEventId`
   to avoid duplicates, and target only Amanda's `GMT Operational Calendar`.

## Outlook routing contract

```
GMT Portal/
  Timesheets/
  Audit/
  Job Cards/
  Tasks/
  Failed - Needs Review/
  Processed/
```

Rules must match the complete structured prefix and must not mark mail as read:

- `[GMT][TIMESHEET]` -> Timesheets
- `[GMT][AUDIT]` -> Audit
- `[GMT][JOBCARD]` -> Job Cards
- `[GMT][TASK]` -> Tasks

Malformed or incomplete messages remain in Inbox or move only to `Failed -
Needs Review`; they must never be silently archived.
