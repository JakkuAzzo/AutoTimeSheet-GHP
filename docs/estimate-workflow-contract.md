# GMT Estimate Workflow Contract

## Browser responsibilities

The authenticated static portal may collect estimate details, calculate totals, show a client-facing preview, and generate a Word-compatible download or print-ready PDF. It must not contain Microsoft credentials, upload directly to OneDrive, or claim that a client email was sent.

## Protected Microsoft 365 workflow

Power Automate should receive a dedicated `[GMT][ESTIMATE]` submission in the approved Accounts intake mailbox, validate the envelope, store the estimate document and metadata in the approved `GMT Web-App/Estimates/{year}/{month}/{estimate-number}/` SharePoint path, and record the file link and status in an Estimates list.

The flow may prepare or send a client message from the approved GMT mailbox only after the recipient, attachment, sender and approval status are validated. The client recipient comes from the required `gmt_client_email` field and the approved Accounts mailbox is added as BCC for filing. The browser's estimate route must not reuse the timesheet FormSubmit endpoint.

The protected history route returns a projection-only `records` array within the existing record-read policy: a user can read their own estimate records, while administrators and operations administrators can read shared estimate records. Each projection includes the estimate number, client company, date, status, totals and a safe source record ID; raw SharePoint links and unfiltered list data stay server-side. Ordinary employee history shares job cards, not estimate records. Email-imported estimates use a shared archive owner and therefore remain outside ordinary employee history until Identity/Permissions defines and approves a policy change.

The full estimate mail archive and estimate index are administrator-only under the current Worker route guard. The static builder's archive panel is authenticated but currently presents shared-archive language to users whose role may receive `403` from those API routes. This UI and role boundary mismatch is tracked as an Identity/Permissions integration finding in `docs/integrations/estimate-mail-sharepoint-flow.md`; this workflow does not alter read authorization.

## Release gates

- Dedicated estimate intake mailbox/route and FormSubmit token confirmed.
- SharePoint Estimates library/list and exact root confirmed.
- Named Accounts approver and second flow owner confirmed.
- Harmless test estimate stored once, with duplicate handling verified.
- Preview, Word download, PDF print and mobile Safari checks passed.
- Client delivery tested to an approved test address before production use.
