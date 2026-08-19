# GMT Estimate Workflow Contract

## Browser responsibilities

The authenticated static portal may collect estimate details, calculate totals, show a client-facing preview, and generate a Word-compatible download or print-ready PDF. It must not contain Microsoft credentials, upload directly to OneDrive, or claim that a client email was sent.

## Protected Microsoft 365 workflow

Power Automate should receive a dedicated `[GMT][ESTIMATE]` submission in the approved Accounts intake mailbox, validate the envelope, store the estimate document and metadata in the approved `GMT Web-App/Estimates/{year}/{month}/{estimate-number}/` SharePoint path, and record the file link and status in an Estimates list.

The flow may prepare or send a client message from the approved GMT mailbox only after the recipient, attachment, sender and approval status are validated. The browser's estimate route must not reuse the timesheet FormSubmit endpoint.

## Release gates

- Dedicated estimate intake mailbox/route and FormSubmit token confirmed.
- SharePoint Estimates library/list and exact root confirmed.
- Named Accounts approver and second flow owner confirmed.
- Harmless test estimate stored once, with duplicate handling verified.
- Preview, Word download, PDF print and mobile Safari checks passed.
- Client delivery tested to an approved test address before production use.
