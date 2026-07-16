# Portal Request Approval Flow

## Purpose

The GMT GitHub Pages portal lets every authenticated staff account submit task
and calendar requests. It does not grant unlicensed users direct access to
Microsoft Lists or Outlook calendars.

`Amanda.BB@gmt-services.co.uk` owns the `GMT Operational Calendar` and is the
recommended Power Automate Outlook connection owner.

## Staff Request Path

1. A staff member signs in to the portal through Entra.
2. The portal pre-fills their display name and submits a structured FormSubmit
   email with `gmt_type`, `gmt_record_id`, `gmt_status=Pending approval`, and
   requester metadata.
3. Power Automate creates or updates a company-owned Microsoft List record.
4. A licensed accounts/admin user approves or rejects the request in Microsoft
   365.
5. For approved calendar requests, Power Automate creates the Outlook event in
   `GMT Operational Calendar`; it records the Outlook event ID on the List row.
6. The requester receives the resulting status notification.

## Permission Model

| Role | Portal | Submit request | Approve request | Direct List / calendar write |
| --- | --- | --- | --- | --- |
| Unlicensed employee | Entra-gated portal | Yes | No | No |
| Licensed accounts/admin | Entra-gated portal and Microsoft 365 | Yes | Yes | Yes, through controlled flow |
| Amanda | Calendar owner / flow owner | Yes | Yes | Flow connection owner |

## Current Technical Boundary

- Task and calendar requests are intentionally stored locally only for immediate
  browser feedback until the email is processed. Local storage is not the
  approval record.
- The client-side portal does not display a trusted approve button for these
  records, because it cannot validate a Microsoft 365 accounts role securely.
- The authoritative status is the Microsoft List row created by the flow.
- Timesheet absence events are separate: the Timesheet Intake flow may publish
  those directly to the shared calendar after a valid timesheet submission.

## Release Checklist

- Create `Tasks` and `Calendar Requests` Lists with the fields in
  `power-automate-build-runbook.md`.
- Configure task and calendar FormSubmit destinations, or temporarily use the
  approved fallback endpoint and Outlook subject rules.
- Build the two approval flows under Amanda's connection and add a second
  licensed accounts co-owner.
- Submit one request as an unlicensed employee and one as a licensed employee.
- Approve one request, reject one request, and verify that only the approved
  calendar request appears in `GMT Operational Calendar`.
