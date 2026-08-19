# GMT monthly timesheet filing contract

Status: frontend envelope prepared; Microsoft 365 flow activation and OneDrive
filing remain required before this is live.

## Observed live failure on 19 August 2026

The two clock submissions from `info@gmt-services.co.uk` arrived at the legacy
`acc.gmtelect+timesheets@outlook.com` route. The saved Outlook messages each
contained only the CSV attachment. The clock form used the same multipart field
name for the XLSX and CSV; FormSubmit retained the last file. The frontend now
uses `attachment` for XLSX and `attachment_csv` for CSV.

## Required monthly behaviour

Each clock event remains an auditable source event, but it must be appended to
one employee/month workbook rather than creating a new user-visible workbook for
every clock action.

```text
GMT Web-App/Timesheets/{year}/{month}/{employee}/
  GMT Timesheet - {employee} - {year}-{month}.xlsx
  Raw Events/{event files}
```

The workbook key is emitted as `gmt_workbook_key`, for example:
`clock-clock-tester-gmt-services-co-uk-2026-07`. The event ID remains
`gmt_record_id`; Power Automate must use it as the idempotency key so a retry or
duplicate email does not append the same event twice.

## Power Automate implementation gate

The flow must:

1. Watch the actual mailbox/folder receiving the activated `[GMT][TIMESHEET]`
   messages. The current legacy personal Outlook destination does not reach the
   GMT shared-mailbox flow.
2. Validate `gmt_type=timesheet_clock`, `gmt_filing_mode=monthly-upsert`, the
   employee/month fields, and the XLSX/CSV attachment pair.
3. Look up `gmt_record_id` in the `Timesheet Submissions` List or an equivalent
   protected index. Stop on an existing ID rather than appending twice.
4. Create the employee/month folder and a workbook from the approved GMT
   template if the `gmt_workbook_key` does not exist.
5. Append the event row to a pre-existing Excel table in that monthly workbook.
   Store the raw XLSX and CSV in `Raw Events` for audit, not as the primary
   employee-facing workbook.
6. Update the protected index with the workbook path/link and event ID.
7. Send a completion message to the employee login mailbox and any approved
   notification address. Do not use browser localStorage or expose OneDrive
   links in the static site.

At month change, the `gmt_workbook_key` changes and the flow creates the next
monthly workbook. No DNS, MX, forwarding, or mailbox cutover is part of this
contract.
