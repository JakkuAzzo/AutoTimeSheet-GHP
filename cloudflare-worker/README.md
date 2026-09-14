# GMT protected portal API

This Worker stores authenticated GMT portal records in Cloudflare D1 and
exposes projection-only history. Microsoft Entra access tokens are verified
against the GMT tenant signing keys before any record is read or written.
Corrections can be queued with their generated XLSX/CSV attachments and sent
through the existing FormSubmit intake during the configured weekly window.

## Provision and deploy

1. Create a D1 database named `gmt-portal` in the GMT Cloudflare account.
2. Replace the placeholder `database_id` in `wrangler.toml` with the returned
   ID, then apply `schema.sql` with Wrangler's D1 execute command.
3. Deploy the Worker from this directory.
4. Set `HISTORY_UPSTREAM_URL` to the existing protected timesheet history
   trigger only when that flow is still the approved source. Leave it blank
   while the flow is unavailable.
5. Set `ADMIN_UPNS`, `ADMIN_OIDS`, or `ADMIN_GROUP_IDS` to the approved GMT
   administrator identities in Cloudflare variables. Do not hard-code them in
   the client bundle.
   `OPERATIONS_ADMIN_UPNS` can grant an Accounts or office identity access to
   all non-timesheet submissions while keeping employee timesheets and clock
   records owner-filtered. `JOB_CARD_ADMIN_UPNS` can additionally grant job-card
   access to identities such as `info@gmt-services.co.uk`. Full administrators
   retain access to all categories.
6. Store the activated timesheet FormSubmit endpoint as the Worker secret
   `FORM_SUBMIT_TIMESHEET_ENDPOINT`. The endpoint is never returned to the
   browser. The default dispatch window is Friday at 18:00 Europe/London and
   can be changed with `DISPATCH_WEEKDAY`, `DISPATCH_HOUR`, and
   `DISPATCH_TIMEZONE`.

The Pages `config.js` should point `portalApiEndpoint` and
`portalHistoryEndpoint` at the deployed Worker origin. The portal can use the
OIDC scopes `openid profile email`; the Worker validates the signed SPA ID token
against the SPA audience so portal CRUD does not depend on Power Automate
permissions. The history request optionally acquires the delegated Power
Automate Flow Service token and sends it in a separate Worker-only header; the
Worker verifies that token belongs to the same Entra identity before calling
`HISTORY_UPSTREAM_URL`. When that permission is unavailable, the response
retains the D1 records and reports `flow-permission-not-configured` in
`meta.upstream` rather than presenting the D1 test record as the complete
Microsoft 365 history.

`STAFF_DIRECTORY_JSON` is an optional Worker variable containing the approved
employee roster. Accounts uses it to show current pay-month submissions,
missing weeks and rows that need review. Employees not present in the roster
but returned by the protected history source are added to the completion view
as unconfigured rows. Synthetic test records are retained in D1 for audit but
are excluded from the default history and completion view; an Accounts request
with `includeSynthetic=1` can include them for diagnostics.

The Worker does not fabricate SharePoint or Excel records. Existing intake
flows remain responsible for filing generated attachments; D1 is the durable
protected portal history and edit source. The scheduled dispatcher records
`Queued for Accounts`, `Sent to Accounts`, or `Delivery failed`; `Sent to
Accounts` means FormSubmit accepted the message and does not claim that a
SharePoint workbook has finished processing it.

Job-card payloads preserve the card reference, revision, lifecycle status,
invoice number, Xero reference, previous-card ID, and optional Outlook message
link. Each submitted revision receives a new protected record ID, so an update
can be assigned a new invoice while the earlier card remains in the chain.

## Xero connection

The Worker contains a protected, Accounts-only Xero OAuth connection and
read-only invoice-linking flow. It uses Xero's server-side authorisation-code
flow, requests `offline_access` plus the granular
`accounting.invoices.read` scope, discovers the connected tenant through the
Connections endpoint, and encrypts rotating refresh tokens before storing them
in D1. No Xero secret or token is sent to the Pages bundle.

Create a Xero OAuth 2.0 app with the **Auth Code** grant type and register this
exact redirect URI:

`https://gmt-portal-api.raspy-breeze-e230.workers.dev/api/xero/callback`

Set the following Worker secrets before using the Accounts connection button:

```sh
wrangler secret put XERO_CLIENT_ID
wrangler secret put XERO_CLIENT_SECRET
wrangler secret put XERO_TOKEN_ENCRYPTION_KEY # 32 bytes, base64 or 64-char hex
```

The public Xero variables and redirect URI are in `wrangler.toml`. Apply the
`migrations/0002_xero.sql` D1 migration before deploying the Worker. Accounts
can then connect from the job-card page, see the connected organisation, look
up an assigned invoice number, and save the returned Xero invoice ID/status on
the job-card chain. This first integration does not create, edit, void, or pay
Xero invoices; those financial writes require a separate approved scope and
explicit workflow.

## API behavior

The protected API exposes `GET /api/history`, `POST /api/records`,
`GET/PATCH/DELETE /api/records/:id`, `POST /api/records/:id/attachments`, and
`GET /api/health`. Accounts also have `POST /api/xero/connect`,
`GET /api/xero/status`, `POST /api/xero/invoices/lookup`, and
`POST /api/xero/job-cards/:id/sync`; the OAuth callback is
`GET /api/xero/callback`. Record history is filtered by the verified Entra owner.
DELETE is a soft delete: submitted records remain in `record_versions` and
are removed from ordinary history responses. The attachment route replaces the
queued files for the same stable record ID, so a correction edited again before
dispatch sends only the latest version.
