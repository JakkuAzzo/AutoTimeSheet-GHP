# GMT Microsoft 365 and bOnline mail cutover

Status: prepared; target cut-over is **15 September 2026 at the earliest**.
Production DNS and provider cancellation remain pending the final live-record,
delivery-test and notice-period checks below.

## Advice

Do not cancel bOnline immediately after changing DNS. Use a defined effective
date after Microsoft 365 has accepted the live DNS records, inbound and
outbound delivery has passed, and the legacy mailbox has been monitored for at
least one full working day. This gives the team a rollback window while DNS
caches expire and prevents a cancellation from removing the only remaining
copy of an undelivered message.

The effective cancellation date should be the first date after that validation
window and any contractual notice period. Previous GMT correspondence records
a 30-day cancellation notice, but bOnline must confirm the current contract,
notice start date, final billing date, and whether mail hosting remains active
until that date.

## Current public evidence (1 September 2026)

| Record | Current result | Meaning |
| --- | --- | --- |
| MX | `mx.gmt-services.co.uk.cust.a.hostedemail.com` | Inbound mail still goes to bOnline/hostedemail. |
| SPF | `v=spf1 include:_spf.hostedemail.com ~all` | Microsoft 365 is not yet authorised by the public SPF record. |
| `autodiscover` | No public CNAME answer | Outlook autodiscover is not connected to Microsoft 365. |
| `selector1._domainkey` | No public CNAME answer | Microsoft 365 DKIM selector 1 is not published. |
| `selector2._domainkey` | No public CNAME answer | Microsoft 365 DKIM selector 2 is not published. |
| `_dmarc` | `v=DMARC1; p=none` | Monitoring only; do not harden until legitimate senders pass. |

## Required implementation sequence

1. In the Microsoft 365 domain wizard, capture the current exact MX target,
   `autodiscover` CNAME target, and both DKIM CNAME targets. Do not reuse
   values from an old screenshot or infer a tenant name.
2. Confirm every active `@gmt-services.co.uk` mailbox, alias, shared mailbox,
   forwarding rule, and application sender exists in Exchange Online before
   changing MX.
3. Export the current bOnline/OpenSRS DNS zone and retain the verified mailbox
   and contacts archives in restricted company storage.
4. At the DNS provider, replace the hostedemail MX with the current Microsoft
   365 MX, publish `autodiscover`, publish both DKIM CNAMEs, and update the
   single SPF TXT record to include Microsoft 365 and any still-authorised
   sender required during the transition. Leave website, verification and
   unrelated records unchanged.
5. Re-query authoritative and public DNS, then test external-to-GMT and
   GMT-to-external delivery for `info`, Accounts, staff mailboxes, and every
   active application route. Record message IDs and observed destinations.
6. Enable Microsoft 365 DKIM only after both selector CNAMEs resolve and the
   tenant reports the domain as healthy. Keep DMARC at `p=none` during the
   observation period; review aggregate results before a later policy change.
7. Monitor Exchange message trace and the legacy bOnline mailbox for at least
   one full working day. Keep source forwarding/copies available during this
   period and confirm there is no loop.
8. Send bOnline a cancellation request with the agreed effective date and ask
   them to confirm the final billing date, DNS ownership, mailbox retention,
   and export access in writing. Do not delete or close the hosted mailbox
   before that confirmation and the final backup check.

## Acceptance evidence

- [ ] Current Microsoft 365 wizard values captured by a tenant admin.
- [ ] All active Exchange recipients and application routes confirmed.
- [ ] bOnline/OpenSRS zone export and mailbox/contact archives verified.
- [ ] MX, SPF, autodiscover and DKIM records resolve publicly.
- [ ] Microsoft 365 domain status is healthy and DKIM is enabled.
- [ ] Inbound and outbound tests pass for every operational address.
- [ ] Message trace and legacy mailbox monitored for one full working day.
- [ ] Rollback owner and maintenance window recorded.
- [ ] bOnline cancellation effective date and final billing date confirmed.

## Approval required

The working target is **15 September 2026 at the earliest**. bOnline cancellation
must take effect on the first date that is both after successful DNS and mail
validation and permitted by the confirmed notice period. If those conditions
are not met by 15 September, defer cancellation rather than interrupt service.
