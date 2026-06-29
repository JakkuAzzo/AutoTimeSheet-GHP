# GMT Outlook, OneDrive, and Index Plan

This app remains a static GitHub Pages app. Do not add Microsoft Graph, OneDrive, Outlook, or Power Automate tokens to frontend JavaScript.

## Email Routing

Use FormSubmit for app submissions, then route the received email in Outlook by subject and recipient address.

Recommended Outlook rules:

- To contains `+timesheets` -> `GMT Portal / Timesheets`
- To contains `+audit` -> `GMT Portal / Audit`
- To or CC contains `+jobcards` -> `GMT Portal / Job Cards`

Timesheets currently use the activated FormSubmit token for `acc.gmtelect+timesheets@outlook.com`. Audit and Job Cards should keep using their plus-addressed aliases until each alias has been confirmed or replaced with its own activated FormSubmit token.

## OneDrive Filing

Root folder:

```text
GMT Web-App/
```

Timesheets:

```text
GMT Web-App/Timesheets/{year}/{month}/{employee}/
```

Example:

```text
GMT Web-App/Timesheets/2026/June/Ainsley Williams/
  timesheet.xlsx
  timesheet.csv
```

Job Cards:

```text
GMT Web-App/Job Cards/{year}/{month}/{company}/{jobRef}/
```

Example:

```text
GMT Web-App/Job Cards/2026/June/Client or Company Name/GMT-2026-001/
  job-card email
  attachment image
```

Tasks:

```text
GMT Web-App/Tasks/{year}/{month}/{employee}/{status}/
```

Allowed task status folders:

- `In-Progress`
- `Completed`
- `Cancelled`

Audit:

```text
GMT Web-App/Audit/{year}/{month}/
  corrected audit.xlsx
  warnings.csv
```

## Metadata Indexes

Use OneDrive for files and Microsoft Lists or Excel tables for metadata indexes. The website should not directly read private OneDrive from frontend JavaScript. A later backend, worker, or exported JSON index can safely expose selected records.

Recommended lists or workbooks:

- `Timesheet Submissions`
- `Job Cards`
- `Tasks`
- `Audit Submissions`

Suggested fields:

- `record_id`
- `type`
- `employee`
- `company/client`
- `week_start`
- `month`
- `year`
- `status`
- `submitted_at`
- `source_email_subject`
- `onedrive_folder_link`
- `attachment_file_link`

## Power Automate Plan

1. Outlook receives the FormSubmit email.
2. Outlook rules move the email into the right folder using plus-address and subject tags.
3. Power Automate watches the submission folders.
4. Power Automate saves attachments into the matching OneDrive folder.
5. Power Automate writes a metadata row into the matching Microsoft List or Excel table.

This keeps private files and Microsoft credentials outside the GitHub Pages frontend.
