# GMT Timesheet fallback routing

Status: prepared, not activated or deployed.

## Why this route is required

`acc.gmtelect@outlook.com` is recorded in Microsoft Entra as an external guest
identity (`#EXT#`). A Microsoft 365 Business Standard licence on that guest does
not turn it into a native GMT Exchange mailbox or a reliable owner for the GMT
Power Automate intake. The current activated route must therefore remain in
place until the replacement route passes delivery tests.

## Target design

```text
GitHub Pages timesheet form
        |
        v
FormSubmit activated for info+timesheets@gmt-services.co.uk
        |
        v
Native GMT mailbox / narrowly scoped flow
        |\
        | +--> SharePoint: GMT Web-App/Timesheets/Incoming
        |       then validated filing hierarchy when metadata checks pass
        |
        +----> approved copy: acc.gmtelect+timesheets@outlook.com
```

Only messages with the complete `[GMT][TIMESHEET]` subject prefix and the
expected XLSX/CSV attachments may be copied to the external Outlook address.
General `info@` mail must not be forwarded by this route. The source message
must remain in the GMT mailbox for audit.

## Gates

| Gate | Status | Evidence / owner |
| --- | --- | --- |
| Existing legacy intake remains available | Confirmed | `config.js`; active activated FormSubmit token; Power Platform operational build status. Owner: Accounts. |
| Dedicated FormSubmit destination created | Blocked | FormSubmit must issue an activation message for `info+timesheets@gmt-services.co.uk`; owner must activate it. |
| New token captured in deployment configuration | Blocked | Do not commit a token until activation is complete and the owner confirms it is safe to deploy. Owner: Website/App lead. |
| Native GMT mailbox/flow receives the new route | To verify | Confirm whether plus-addressing lands in `info@gmt-services.co.uk` or whether a dedicated mail-enabled recipient/flow trigger is required. Owner: M365 admin. |
| SharePoint filing | Confirmed baseline | Existing flow stores accepted XLSX/CSV in `GMT Web-App/Timesheets/Incoming`; metadata hierarchy remains a later gated step. Owner: Power Platform admin. |
| External copy | Approval needed | Configure a subject-filtered copy to `acc.gmtelect+timesheets@outlook.com`; do not enable unrestricted mailbox forwarding. Owner: M365 admin + Accounts. |
| Delivery and attachment test | Blocked | Requires the activated route and a harmless synthetic submission. Owner: Website/App lead + Accounts. |
| Production switch | Approval needed | Keep the current route until the new route passes inbound, attachment, SharePoint, external-copy and rollback tests. Owner: GMT owner. |

## Required test

Use a synthetic test employee and no payroll/holiday data. Verify:

1. one message reaches the native GMT intake;
2. XLSX and CSV attachments arrive intact;
3. inline images are excluded from filing;
4. the SharePoint item and files are created once;
5. exactly one filtered copy reaches `acc.gmtelect+timesheets@outlook.com`;
6. unrelated `info@` mail is not copied;
7. the source message remains available;
8. a repeat submission does not create a duplicate when the same submission ID
   is replayed; and
9. the legacy route can be restored by reverting the single FormSubmit endpoint
   change if any check fails.

Do not send a real employee's timesheet as the first test. Do not change MX,
SPF, DKIM, DMARC, forwarding defaults, mailbox deletion, or DNS for this work.

## Next actions

1. M365 admin confirms the native recipient/flow trigger for the new address.
2. Accounts owner activates the FormSubmit message received by `info@`.
3. Website/App lead records the new activated token without exposing it, updates
   only the timesheet route, and deploys after owner approval.
4. Power Platform admin configures and tests the subject-filtered external copy
   and SharePoint filing.
5. GMT owner approves the production switch after the test evidence is recorded.
