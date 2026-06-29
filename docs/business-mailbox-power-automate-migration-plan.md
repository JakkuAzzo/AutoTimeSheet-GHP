# Business Mailbox and Power Automate Migration Plan

## Current Baseline

- The prototype app is hosted on GitHub Pages.
- Timesheet submissions currently use an activated FormSubmit token for `acc.gmtelect+timesheets@outlook.com`.
- `acc.gmtelect@outlook.com` is a personal Outlook mailbox and should not be the long-term automation hub.
- GMT appears to already have a Microsoft 365 business tenant under `@gmtelectservsltd.onmicrosoft.com`.
- Do not create a new tenant until admin access, licensing, Exchange, OneDrive, SharePoint, Lists, and Power Automate availability are confirmed.

No Microsoft Graph, Outlook, OneDrive, SharePoint, Power Automate, or mailbox credentials should be added to frontend JavaScript.

## Phase 1: Tenant Readiness

Confirm:

- Tenant admin owner.
- Active Microsoft 365 licenses.
- Exchange mailbox availability.
- OneDrive for Business availability.
- SharePoint availability.
- Microsoft Lists availability.
- Power Automate availability.
- Plus-addressing support.
- Shared mailbox creation support.
- External FormSubmit email delivery into business mailboxes.

Preferred receiving mailbox:

```text
accounts@gmtelectservsltd.onmicrosoft.com
```

Test plus aliases:

```text
accounts+timesheets@gmtelectservsltd.onmicrosoft.com
accounts+audit@gmtelectservsltd.onmicrosoft.com
accounts+jobcards@gmtelectservsltd.onmicrosoft.com
```

Fallback dedicated mailboxes if plus addressing is not reliable:

```text
timesheets@gmtelectservsltd.onmicrosoft.com
audit@gmtelectservsltd.onmicrosoft.com
jobcards@gmtelectservsltd.onmicrosoft.com
```

## Phase 2: App Routing Migration

Keep current production routes working while business endpoints are activated.

Target config shape:

```js
window.GMT_APP_CONFIG = {
  timesheetFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  auditFormSubmitEndpoint: "",
  jobCardFormSubmitEndpoint: "",
  fallbackFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  legacyPersonalAccountsEmail: "acc.gmtelect@outlook.com"
};
```

Routing rules:

- Timesheets use the activated token until a business token is confirmed.
- Audit keeps the current audit route until an audit business token is confirmed.
- Job Cards keep the current job card route until a job card business token is confirmed.
- Category-specific endpoints should take priority when present.
- Blank category endpoints should fall back safely.
- Do not remove the personal mailbox route until business delivery and Power Automate processing are proven.

Structured subjects:

- `[GMT][TIMESHEET][SUBMISSION] {employee} | Week {weekStart}`
- `[GMT][AUDIT][CORRECTED] {auditName} | {rowCount} rows | {warningCount} warnings`
- `[GMT][JOBCARD][NEW] {jobRef} | {client}`
- `[GMT][JOBCARD][UPDATE] {jobRef} | {status}`

Recommended metadata fields:

- `gmt_type`
- `gmt_action`
- `gmt_record_id`
- `gmt_employee`
- `gmt_employee_email`
- `gmt_company`
- `gmt_client`
- `gmt_job_ref`
- `gmt_week_start`
- `gmt_week_end`
- `gmt_year`
- `gmt_month`
- `gmt_status`
- `gmt_attachment_type`
- `gmt_submitted_at`

## Phase 3: Outlook Folders and Rules

Create:

```text
GMT Portal/
  Timesheets/
  Audit/
  Job Cards/
  Tasks/
  Failed - Needs Review/
  Processed/
```

Plus-address rules:

- To contains `+timesheets` -> `GMT Portal / Timesheets`
- To contains `+audit` -> `GMT Portal / Audit`
- To or CC contains `+jobcards` -> `GMT Portal / Job Cards`

Subject fallback rules:

- Subject contains `[GMT][TIMESHEET]` -> `GMT Portal / Timesheets`
- Subject contains `[GMT][AUDIT]` -> `GMT Portal / Audit`
- Subject contains `[GMT][JOBCARD]` -> `GMT Portal / Job Cards`

Failed or ambiguous messages should remain visible or move to `Failed - Needs Review`.

## Phase 4: SharePoint Storage

Prefer SharePoint document libraries over personal OneDrive for company ownership.

Root:

```text
GMT Web-App/
```

Timesheets:

```text
GMT Web-App/Timesheets/{year}/{month}/{employee}/
```

Audit:

```text
GMT Web-App/Audit/{year}/{month}/
```

Job Cards:

```text
GMT Web-App/Job Cards/{year}/{month}/{company}/{jobRef}/
```

Tasks:

```text
GMT Web-App/Tasks/{year}/{month}/{employee}/{status}/
```

Allowed task status folders:

- `In-Progress`
- `Completed`
- `Cancelled`

## Phase 5: Microsoft Lists or Excel Indexes

Prefer Microsoft Lists for long-term operational tracking.

Create:

- `Timesheet Submissions`
- `Audit Submissions`
- `Job Cards`
- `Tasks`

Store metadata and file links, not frontend secrets.

Core fields:

- record ID
- submission type
- employee or client
- week or planned date
- year
- month
- status
- submitted at
- source email subject
- folder link
- attachment links
- processed by flow

## Phase 6: Power Automate Flows

Timesheets:

1. Trigger on new email in `GMT Portal / Timesheets`.
2. Confirm subject contains `[GMT][TIMESHEET]`.
3. Extract metadata.
4. Create `GMT Web-App/Timesheets/{year}/{month}/{employee}/`.
5. Save XLSX and CSV attachments.
6. Create a row in `Timesheet Submissions`.
7. Move email to `Processed`.
8. Move incomplete submissions to `Failed - Needs Review`.

Audit:

1. Trigger on new email in `GMT Portal / Audit`.
2. Extract row count, warning count, parse error count, and source filenames.
3. Create `GMT Web-App/Audit/{year}/{month}/`.
4. Save audit XLSX and warnings CSV.
5. Create a row in `Audit Submissions`.
6. Move email to `Processed`.

Job Cards:

1. Trigger on new email in `GMT Portal / Job Cards`.
2. Extract job ref, client, site, engineer, and planned date.
3. Create `GMT Web-App/Job Cards/{year}/{month}/{company}/{jobRef}/`.
4. Save image attachments.
5. Save email body as `.html` or `.txt`.
6. Create or update a row in `Job Cards`.
7. Move email to `Processed`.

Tasks:

1. Trigger once task submission method is final.
2. Extract task metadata.
3. Create or update a row in `Tasks`.
4. Save attachments or notes if present.
5. Store files under `GMT Web-App/Tasks/{year}/{month}/{employee}/{status}/`.

## Acceptance Criteria

- Business mailbox receives external FormSubmit email.
- Outlook rules sort each category.
- Power Automate can save attachments.
- Lists can receive metadata rows.
- Failed submissions are not lost.
- No Microsoft credentials are exposed in the GitHub Pages frontend.
