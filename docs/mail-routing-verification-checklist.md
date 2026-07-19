# GMT Mail Routing Verification Checklist

Use this checklist before requesting the Microsoft 365 Exchange DNS cutover from
bOnline. It is designed to prove actual delivery, not just account names in the
Microsoft 365 admin centre.

## Current Position

- `gmt-services.co.uk` inbound MX remains with the existing hosted mail
  service.
- The Microsoft 365 custom-domain Exchange setup is incomplete.
- Do not change MX, SPF, or `autodiscover` records while this checklist is
  incomplete.

## Address Inventory

For each address below, record its current provider, mailbox type, owner,
members, aliases, and whether it needs to receive external mail after cutover.

| Address or service | Current provider/type | Owner or members | Test result |
| --- | --- | --- | --- |
| `info@gmt-services.co.uk` | To confirm | To confirm | Pending |
| Accounts route | Existing Microsoft 365 Group; primary `onmicrosoft.com` address | 1 owner, 3 members | Not the planned shared mailbox; custom route unproven |
| Four renamed staff mailboxes | Exchange Online user mailboxes | Staff users | Primary custom-domain SMTP and retained tenant alias confirmed; external DNS test still pending |
| Timesheets intake | Legacy route until approved | Accounts team | Pending |
| Audit intake | Legacy route until approved | Accounts team | Pending |
| Job Cards intake | Legacy route until approved | Accounts team | Pending |

## Delivery Tests

Use a unique harmless subject for every line, for example:

```text
[GMT][MAIL-CUTOVER-TEST] 2026-07-19-01
```

| # | Sender | Recipient | Expected evidence | Result / message ID |
| --- | --- | --- | --- | --- |
| 1 | External personal mailbox | Each active `@gmt-services.co.uk` address | Arrives in the current live inbox | |
| 2 | Relevant `@gmtelectservsltd.onmicrosoft.com` mailbox | Matching `@gmt-services.co.uk` address | Delivery or a recorded rejection | |
| 3 | Existing hosted mailbox | Intended Microsoft 365 mailbox/address | Delivery or a recorded rejection | |
| 4 | Microsoft 365 mailbox | External personal mailbox | Outbound delivery works | |
| 5 | Existing hosted source | Proposed business shared Accounts mailbox after creation | Shared mailbox receives it | |
| 6 | FormSubmit activation/test | Final Timesheets destination after activation | Email and attachments arrive | |
| 7 | FormSubmit activation/test | Final Audit destination after activation | Email and attachments arrive | |
| 8 | FormSubmit activation/test | Final Job Cards destination after activation | Email and attachments arrive | |

### Initial observations

### Exchange alias audit: 19 July 2026

Exchange Online was queried directly for the four staff mailboxes whose sign-in
names changed during the domain work. Each has:

- its `@gmt-services.co.uk` address as the primary SMTP address; and
- the matching `@gmtelectservsltd.onmicrosoft.com` address retained as a
  secondary SMTP alias.

That means both addresses route to the same Exchange mailbox once mail reaches
Microsoft 365. The change was not just a sign-in-name change.

A harmless internal delivery message was sent from Amanda's business mailbox
to all four current custom-domain addresses. Outlook accepted the message and
recorded it in Sent Items without an immediate rejection. This is an internal
Exchange delivery smoke test only: it does not prove external mail reaches
Microsoft 365 while the public MX record still points to the hosted service.

- `info@gmt-services.co.uk` has an existing Microsoft 365 undeliverable notice
  reporting that the recipient was not found. Do not route operational mail to
  it through Microsoft 365 until a mail-enabled object is confirmed.
- A 19 July 2026 message to the resolved `accounts@gmt-services.co.uk`
  directory object entered the sender's Sent Items without an immediate
  rejection. This is not a pass: confirm the recipient object's SMTP address,
  mailbox type, members, and actual destination inbox before relying on it.
- Exchange identifies `Accounts` as a private Teams-connected Microsoft 365
  Group whose primary address remains `Accounts@GMTElectServsLtd.onmicrosoft.com`.
  Do not use this group as the app's Accounts intake destination unless its
  role, custom-domain alias, and membership are explicitly approved.

## Backup and Forwarding Sign-Off

- [ ] bOnline/OpenSRS DNS-zone export saved in restricted company storage.
- [ ] Existing hosted mailboxes exported or migration backup confirmed.
- [ ] Contacts, calendars, aliases, forwarding rules, and shared-mailbox
      memberships inventoried.
- [ ] Source-side forwarding is configured to keep a source copy during the
      validation period.
- [ ] No forwarding loop exists.
- [ ] Legacy app submission route remains available for rollback.
- [ ] Business owner approves the maintenance window and rollback owner.

## Cutover Approval Gate

Proceed only when all required active addresses have a passing delivery test,
backups are verified, the bOnline request contains the current Microsoft 365
wizard values, and the named business owner approves the cutover window.

The full DNS, validation, and rollback procedure is in
[business-mailbox-power-automate-migration-plan.md](business-mailbox-power-automate-migration-plan.md).
