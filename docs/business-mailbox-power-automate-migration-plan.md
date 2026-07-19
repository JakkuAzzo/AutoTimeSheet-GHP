# Business Mailbox and Power Automate Migration Plan

## Current Baseline

- The prototype app is hosted on GitHub Pages.
- Timesheet submissions currently use an activated FormSubmit token for `acc.gmtelect+timesheets@outlook.com`.
- `acc.gmtelect@outlook.com` is a personal Outlook mailbox and should not be the long-term automation hub.
- GMT appears to already have a Microsoft 365 business tenant under `@gmtelectservsltd.onmicrosoft.com`.
- Do not create a new tenant until admin access, licensing, Exchange, OneDrive, SharePoint, Lists, and Power Automate availability are confirmed.

No Microsoft Graph, Outlook, OneDrive, SharePoint, Power Automate, or mailbox credentials should be added to frontend JavaScript.

## Observed Mail State (19 July 2026)

This section records the current state so DNS work is not mistaken for a routine
verification change.

- `gmt-services.co.uk` is present in Microsoft 365 and marked as the default
  domain, but Microsoft 365 shows its Exchange setup as **Incomplete setup**.
- Public DNS still routes inbound mail to the existing hosted mail service:
  `mx.gmt-services.co.uk.cust.a.hostedemail.com`.
- Microsoft 365 supplied a tenant-verification TXT record is already present.
- The Microsoft 365 Exchange wizard requires a new Microsoft 365 MX record,
  an `autodiscover` CNAME, and an SPF update. Applying those records changes
  live inbound and outbound mail routing.
- The custom domain is not currently available as a mail-enabled Exchange
  domain in the shared mailbox creation screen. `accounts@gmt-services.co.uk`
  is therefore not yet a confirmed Exchange mailbox destination.
- A Microsoft 365 message to `info@gmt-services.co.uk` has produced a
  "recipient unknown" undeliverable notice. That address is not currently
  mail-enabled in the Microsoft 365 tenant.
- On 19 July 2026, Outlook resolved `accounts@gmt-services.co.uk` to a
  directory object labelled `accounts` and accepted a harmless test message
  into Amanda's Sent Items. This only proves internal directory resolution;
  it does not prove the final mailbox, forwarding, or external delivery path.
- Exchange confirms that the current `Accounts` object is a private,
  Teams-connected Microsoft 365 Group with one owner and three members. Its
  primary address is `Accounts@GMTElectServsLtd.onmicrosoft.com`; no custom
  domain alias is shown in the readable General view. It is not a replacement
  for the planned business Accounts shared mailbox.
- The earlier app copy test to `accounts@gmt-services.co.uk` was not visible
  in the expected destination. Treat the Accounts route as unproven until the
  recipient object, owner/membership, and destination inbox have been checked.

Consequently, no DNS, FormSubmit, or Power Automate production cutover should
occur until the pre-cutover checks below have passed. The existing hosted mail
service remains the mail authority during planning.

## Pre-Cutover Routing Verification

The aim is to prove where mail currently lands, rather than infer it from a
Microsoft 365 sign-in name. A user principal name is not proof of an Exchange
mailbox or proxy address.

Create a short test log with the date, sender, recipient, message ID, observed
inbox, and result for each of the following. Use harmless test subjects such
as `[GMT][MAIL-CUTOVER-TEST] <case>` and do not include employee data.

1. Send external mail to each current `@gmt-services.co.uk` operational
   address and record the hosted-mail inbox where it arrives.
2. Send from each relevant `@gmtelectservsltd.onmicrosoft.com` mailbox to its
   intended `@gmt-services.co.uk` address. Confirm whether it is delivered,
   rejected, or routed to a different mailbox.
3. Send from the current hosted mailbox to each intended Microsoft 365 user
   or shared mailbox address and record the result.
4. Check the Exchange admin centre for each target address: primary SMTP
   address, aliases/proxy addresses, mailbox type, licence, and owners or
   members.
5. Confirm the current `info@gmt-services.co.uk` and Accounts destinations:
   whether each is a hosted mailbox, forwarder, distribution group, shared
   mailbox, or alias, and who can access it.
6. Run one inbound and one outbound test for every address that FormSubmit,
   Power Automate, staff, or customers will use.

Do not regard a custom-domain UPN, an Outlook contact label, or an old
`onmicrosoft.com` mailbox as evidence that mail is forwarding to the new
address. The tests above are the acceptance evidence.

## Forwarding and Backup Plan

### Inventory before changes

Before bOnline changes DNS, record and export:

- Every hosted mailbox, alias, distribution address, forwarder, and catch-all
  rule under `gmt-services.co.uk`.
- Mailbox owners, delegated users, shared-mailbox members, Outlook rules,
  signatures, contacts, calendars, and retention requirements.
- Current DNS zone records, including the existing MX, SPF, DKIM, DMARC,
  `autodiscover`, web, and verification records. Save both screenshots and a
  text export from bOnline/OpenSRS.
- The current TTL values. Reduce only the mail-related record TTLs to 300
  seconds 24 to 48 hours before the approved change window if bOnline supports
  it; do not alter website records.

### Backup before migration

- Take an export or provider backup of every existing hosted mailbox before
  changing MX records. Prefer a provider migration/export process that
  preserves folders, dates, sent mail, contacts, and attachments.
- Export the shared calendars and contacts that are operationally important.
- Store the exports in restricted company-controlled SharePoint storage and
  record the restoration method and owner.
- Keep the legacy personal FormSubmit route active as the app-level fallback
  until each business submission category has completed real delivery and
  Power Automate processing tests.

### Transitional forwarding

Once Exchange mailboxes and aliases have been created and tested, configure
source-side forwarding or migration copies from the existing hosted service to
the matching Microsoft 365 mailbox. The first pass must retain a copy in the
source mailbox so delivery can be compared and no mail is silently lost.

- Forward only to approved internal business mailboxes; do not create loops.
- Do not delete hosted mailboxes or turn off source copies during the initial
  validation period.
- Re-test `info`, Accounts, and all operational shared addresses separately.
- Remove temporary forwarding only after the agreed retention period and a
  documented sign-off from the business owner.

## bOnline / OpenSRS Cutover Runbook

The DNS provider must carry out this section. It is intentionally a planned
change, not a frontend or Microsoft 365 configuration task.

### Preconditions

1. A named bOnline/OpenSRS contact confirms they control the live DNS zone.
2. The routing verification log is complete and all target Exchange mailboxes
   or shared mailboxes exist, are licensed where required, and receive test
   mail.
3. Backup exports and the DNS snapshot are complete.
4. A maintenance window, rollback owner, and customer/staff communication
   have been approved.
5. Microsoft 365 confirms the exact records to use in the domain wizard at
   the time of change. Do not reuse stale values from an old screenshot.

### Requested DNS change

Ask bOnline to apply only the current Microsoft 365 Exchange records shown in
the Microsoft 365 domain wizard:

- Replace the existing inbound MX route with the Microsoft 365 MX target.
- Add or replace the `autodiscover` CNAME with the Microsoft 365 target.
- Replace the current SPF policy with the Microsoft 365 SPF policy, preserving
  any separately required authorised senders only after they have been
  reviewed.
- Leave website, verification, DKIM, DMARC, and unrelated DNS records intact
  unless a separately approved migration step changes them.

The exact host, target, priority, and TTL must be copied from the live
Microsoft 365 wizard into the bOnline request and reviewed by a tenant admin
before submission.

### Validation after DNS propagation

1. Complete the Microsoft 365 domain wizard and confirm the domain becomes
   Healthy.
2. Test external-to-business and business-to-external mail for every active
   staff and shared address.
3. Test `info`, Accounts, Timesheets, Audit, and Job Cards routing.
4. Verify Outlook folders/rules and Power Automate triggers with harmless test
   messages.
5. Activate and test FormSubmit destinations one category at a time. Update
   the app configuration only after that category's delivery, attachment, and
   flow run are verified.
6. Monitor message trace and the legacy hosted mailbox for at least one full
   working day before declaring cutover complete.

### Rollback

Rollback is required if a target address rejects mail, a shared mailbox is
missing, external delivery fails, or forwarding creates a loop.

1. Ask bOnline to restore the recorded previous MX, SPF, and `autodiscover`
   records.
2. Keep existing mailbox data and Microsoft 365 accounts intact; do not
   delete mailboxes during rollback.
3. Disable any forwarding rule that creates a duplicate or loop.
4. Keep category-specific business endpoints blank and retain the existing
   app fallback route until the fault is resolved and retested.
5. Record the failure, affected addresses, and next retest date.

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
  legacyPersonalAccountsEmail: "acc.gmtelect@outlook.com",
  formSubmitEndpoint: "https://formsubmit.co/ajax/acc.gmtelect@outlook.com",
  formSubmitTimesheetEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe"
};
```

Routing rules:

- Timesheets use the activated token until a business token is confirmed.
- Audit keeps the current audit route until an audit business token is confirmed.
- Job Cards keep the current job card route until a job card business token is confirmed.
- Category-specific endpoints should take priority when present.
- Blank category endpoints should fall back safely.
- Do not remove the personal mailbox route until business delivery and Power Automate processing are proven.

Endpoint resolution order:

- Timesheets: `timesheetFormSubmitEndpoint`, then `formSubmitTimesheetEndpoint`, then a `+timesheets` route derived from `formSubmitEndpoint`, then `fallbackFormSubmitEndpoint`.
- Audit: `auditFormSubmitEndpoint`, then a `+audit` route derived from `formSubmitEndpoint`, then `fallbackFormSubmitEndpoint`.
- Job Cards: `jobCardFormSubmitEndpoint`, then a `+jobcards` route derived from `formSubmitEndpoint`, then `fallbackFormSubmitEndpoint`.

Preparation-only implementation:

- Keep `auditFormSubmitEndpoint` blank until the business audit destination is activated and a test email is received.
- Keep `jobCardFormSubmitEndpoint` blank until the business job card destination is activated and a test email is received.
- Keep `formSubmitEndpoint` pointed at the current legacy route while audit and job card business routes are unproven.
- Do not put Microsoft Graph, SharePoint, OneDrive, Power Automate, mailbox, or tenant credentials in `config.js`.
- `legacyPersonalAccountsEmail` is a routing reference only. It is not an authentication setting.

Manual activation gates:

1. Confirm the business mailbox receives external email.
2. Confirm plus addressing or dedicated category mailboxes work.
3. Trigger FormSubmit activation for each final destination.
4. Confirm the FormSubmit token or endpoint for Timesheets, Audit, and Job Cards separately.
5. Submit one real message per category and confirm Outlook rules move each message.
6. Confirm Power Automate saves attachments and creates the expected List or Excel row.
7. Only then replace the relevant category-specific endpoint in production config.

Rollback plan:

- Leave the current `formSubmitEndpoint` and activated timesheet token available until business routing has processed real submissions successfully.
- If a business endpoint fails, blank the affected category-specific endpoint and redeploy config so the app falls back to the current legacy route.
- Keep subject tags (`[GMT][TIMESHEET]`, `[GMT][AUDIT]`, `[GMT][JOBCARD]`) so rules can continue to work even if plus addressing is unreliable.
- Keep manual download/export flows available for Timesheets and Audit while email automation is being tested.

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
