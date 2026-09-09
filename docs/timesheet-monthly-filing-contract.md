# GMT monthly timesheet filing contract

Status: frontend envelope and Excel Online upsert script prepared; Microsoft 365
flow activation and company-owned filing remain required before this is live.

## Observed live failure on 19 August 2026

The two clock submissions from `info@gmt-services.co.uk` arrived at the legacy
`acc.gmtelect+timesheets@outlook.com` route. The saved Outlook messages each
contained only the CSV attachment. The clock form used the same multipart field
name for the XLSX and CSV; FormSubmit retained the last file. The frontend now
uses `attachment` for XLSX and `attachment_csv` for CSV.

## Required monthly behaviour

Each weekly submission and clock event remains an auditable source event, but it
must be upserted into one employee/month workbook rather than creating a new
user-visible workbook for every submission or clock action.

```text
GMT Web-App/Timesheets/{year}/{month}/{employee}/
  GMT Timesheet - {employee} - {year}-{month}.xlsx
  Raw Events/{record-id}/*.xlsx and *.csv
```

The workbook key is emitted as `gmt_workbook_key`, for example:
`timesheet-clock-tester-gmt-services-co-uk-2026-07`. Weekly submissions and
quick clock events for the same employee/month intentionally use the same key.
The event ID remains
`gmt_record_id`; Power Automate and the Excel Online upsert script must use it as
the idempotency key so a retry or duplicate email replaces the matching row
instead of appending the same event twice.

## Power Automate implementation gate

The flow must:

1. Watch the actual mailbox/folder receiving the activated `[GMT][TIMESHEET]`
   messages. The current legacy personal Outlook destination does not reach the
   GMT shared-mailbox flow.
2. Validate `gmt_type=timesheet` or `timesheet_clock`,
   `gmt_filing_mode=monthly-upsert`, the employee/month fields, and the XLSX/CSV
   attachment pair.
3. Look up `gmt_record_id` in the `Timesheet Submissions` List or an equivalent
   protected index. On an existing ID, replace the matching files/list metadata
   and update the matching workbook row; never append a second row.
4. Create the employee/month folder and copy the approved GMT monthly workbook
   template if the `gmt_workbook_key` does not exist.
5. Store the raw XLSX and CSV under `Raw Events/{gmt_record_id}/` for audit,
   not as the primary employee-facing workbook.
6. Run `office-scripts/upsert-monthly-timesheet-row.ts` against the monthly
   workbook. It creates the controlled Excel table on first use and upserts by
   `Source record ID`.
7. Update the protected index with the workbook path/link, raw-file links and
   event ID.
8. Send a completion message to the employee login mailbox and any approved
   notification address. Do not use browser localStorage or expose OneDrive
   links in the static site.

At month change, the `gmt_workbook_key` changes and the flow creates the next
monthly workbook. No DNS, MX, forwarding, or mailbox cutover is part of this
contract.
