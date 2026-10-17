# GMT protected portal API

This Worker stores authenticated GMT portal records in Cloudflare D1 and
exposes projection-only history. Microsoft Entra access tokens are verified
against the GMT tenant signing keys before any record is read or written.
Corrections can be queued with their generated XLSX/CSV attachments and sent
through the existing FormSubmit intake during the configured weekly window.
Accounts can also replay due queued corrections from Submitted Documents without
waiting for that window. The protected `POST /api/admin/dispatch-queue` endpoint
accepts `{ "dryRun": true }` for a no-send preview; only verified Accounts
administrators can invoke it. A successful outbound response is not proof that
Power Automate updated the target SharePoint workbook.
Customer enquiries can also be stored as protected records with their customer
details, Outlook conversation ID/link, and an append-only message projection.

## Provision and deploy

1. Create a D1 database named `gmt-portal` in the GMT Cloudflare account.
2. Replace the placeholder `database_id` in `wrangler.toml` with the returned
   ID. Apply the numbered migrations in order with Wrangler D1 migrations
   (`wrangler d1 migrations apply gmt-portal --remote`); do not use
   `schema.sql` as a substitute for the migration history. For local checks,
   use `--local` and a disposable database. The estimate archive contract is
   added by `migrations/0009_estimate_archive.sql` and has not been applied to
   production by this change.
3. Deploy the Worker from this directory.
4. Set `HISTORY_UPSTREAM_URL` to the existing protected timesheet history
   trigger only when that flow is still the approved source. Leave it blank
   while the flow is unavailable.
5. Set `ADMIN_UPNS`, `ADMIN_OIDS`, or `ADMIN_GROUP_IDS` to the approved GMT
   administrator identities in Cloudflare variables. Do not hard-code them in
   the client bundle. The Worker deployment workflow uses `--keep-vars`, so
   existing Cloudflare admin UPN, object ID, group, operations, and job-card
   variables remain authoritative. `ADDITIONAL_ADMIN_UPNS` adds administrators
   without replacing that existing list. `HR_ADMIN_UPNS` grants access to
   shared calendar requests and each HR user's own submissions.
   `TIMESHEET_VIEWER_UPNS` grants read-only access to all employee timesheets
   and clock records without granting portal administrator access. Set its
   production value in the Cloudflare Worker dashboard so staff UPNs stay out
   of this public repository; the deploy workflow preserves dashboard vars.
   `XERO_ADMIN_UPNS` grants Xero invoice access without broader portal
   administration. The checked-in GMT defaults include Michelle and Lidia for
   HR and Xero and `accounts@gmt-services.co.uk` as an additional full admin.
   Apply
   `migrations/0011_portal_access_assignments.sql` before deploying code that
   enables `/portal/users.html`. That page can grant or revoke HR, Xero,
   operations, and job-card roles with an audit record, but cannot grant full
   administrator status.
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

The Worker does not fabricate SharePoint, Excel, or mailbox records. The public
enquiry form includes a stable `gmt_record_id` and customer metadata so the
approved Microsoft 365 intake flow can create the protected enquiry record and
link its Outlook conversation. Until that flow is connected, the portal shows
the enquiry as awaiting inbox synchronisation. Replies entered in the portal
are saved to the protected thread with `Reply queued` status; actual mailbox
delivery remains owned by the Microsoft 365 flow.

Portal-created client estimates are archived before delivery. The protected
`POST /api/estimates/send` route calls the tenant-owned Power Automate send flow
using the Worker secret `ESTIMATE_SEND_FLOW_URL`; never put the trigger URL in
the public Pages configuration. The flow must return a success JSON response
only after the Outlook send action completes, always copy Accounts, and enforce
its own idempotency key before sending. Until the secret and verified flow are
configured, the portal preserves the estimate in protected history and the
shared archive but does not send it.

Existing intake
flows remain responsible for filing generated attachments; D1 is the durable
protected portal history and edit source. The scheduled dispatcher records
`Queued for Accounts`, `Sent to Accounts`, or `Delivery failed`; `Sent to
Accounts` means FormSubmit accepted the message and does not claim that a
SharePoint workbook has finished processing it.

Job-card payloads preserve the card reference, revision, lifecycle status,
invoice number, Xero reference, previous-card ID, and optional Outlook message
link. Each submitted revision receives a new protected record ID, so an update
can be assigned a new invoice while the earlier card remains in the chain.

## Estimate email archive data contract

`estimate_index` remains the canonical estimate-number/client lookup used by
the existing Accounts invoice correlation path. Migration
`migrations/0009_estimate_archive.sql` adds message, attachment, and association
records without creating a second estimate master. An email is keyed by its
Internet Message-ID where available; a mailbox plus provider message ID is the
fallback idempotency key. The existing `estimate_mail_sources` table retains
each approved mailbox copy, while each archive message retains its source,
classification, searchable metadata, SharePoint EML/manifest item IDs, and
non-sensitive provenance JSON.

Keep original `.eml` bytes, full message bodies, conversation exports, and
attachment bytes in the restricted SharePoint archive. D1 stores searchable
metadata, hashes, and opaque SharePoint item IDs for authenticated server-side
fetches. `archive_associations` records estimate, job-card, and invoice edges
with confidence, review state, evidence, and the matching rule; a conversation
ID or shared customer is a candidate signal, not proof by itself. Do not apply
this migration to production until the archive ingest/query Worker endpoints,
SharePoint access policy, and bounded read-only backfill have been verified.

## Xero connection

The Worker contains a protected, Accounts-only Xero OAuth connection and
invoice register. It uses Xero's server-side authorisation-code flow, discovers
the connected tenant through the Connections endpoint, and encrypts rotating
refresh tokens before storing them in D1. `XERO_SCOPES` is the existing scope
configuration; this integration work does not add or broaden scopes. No Xero
secret or token is sent to the Pages bundle.

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

Apply `migrations/0004_profile_settings.sql` to persist each user's GMT app
display name and optional submission-copy address by their verified Entra
object ID. The Pages bundle keeps only a browser cache for fast rendering; the
Worker remains the source of truth.

## API behavior

The protected API exposes `GET /api/profile`, `PUT /api/profile`,
`GET /api/history`, `POST /api/records`,
`GET/PATCH/DELETE /api/records/:id`, `POST /api/records/:id/attachments`, and
`GET /api/health`. Accounts also have `POST /api/admin/dispatch-queue`, `POST /api/xero/connect`,
`GET /api/xero/status`, `POST /api/xero/invoices/lookup`, and
`POST /api/xero/job-cards/:id/sync`; the OAuth callback is
`GET /api/xero/callback`. Record history is filtered by the verified Entra owner.
DELETE is a soft delete: submitted records remain in `record_versions` and
are removed from ordinary history responses. The attachment route replaces the
queued files for the same stable record ID, so a correction edited again before
dispatch sends only the latest version.

### Xero invoice history archive

`GET /api/xero/invoices` reads a validated page from the SharePoint document
library first. A page miss is fetched from Xero and saved as
`Invoices/Xero/<xero-tenant-id>/page-<page>-<page-size>-<status>.json` using
Microsoft Graph app-only credentials. The envelope records its tenant, page,
filter, schema version, and cache time; invoice rows contain the portal's
existing read projection. This cache does not copy or delete Xero source
invoices. An empty page is stored too, so the end of the register does not
trigger another Xero request on each visit.

The Accounts “Refresh from Xero” action adds `refresh=1`, bypasses cached pages,
and replaces each SharePoint page with the current Xero result. Ordinary visits
read the SharePoint pages. The response's `archive.source`, `archive.stored`,
and `archive.cached_at` fields distinguish archive hits, live Xero reads, and a
successful Xero read whose SharePoint write failed, and carry the source page
timestamp. `pagination.page_limit` is 1000; `pagination.has_more` stays true
when a full page is returned, including a full page 1000, so the browser can
label a capped walk incomplete. Only a SharePoint 404 is treated as a cache
miss; authentication or service errors are surfaced instead of silently
re-reading old history from Xero. The browser reports the page source counts
and oldest/newest page timestamps without applying an automatic freshness
expiry. Its `sessionStorage` snapshot is bound to a tenant ID and replaced only
after a complete walk; a failed or capped walk can remain visible for the
current visit but cannot overwrite that complete snapshot. Refresh remains the
explicit way to reread archived pages from Xero. The endpoint remains
restricted to the authenticated Accounts administrator check and requires the
configured `SHAREPOINT_GRAPH_CLIENT_SECRET`, site, and drive settings.

`GET /api/xero/status` refreshes each distinct saved token once and verifies
the saved tenant ID and connection ID against Xero `GET /connections`. Tenant
rows that shared a token receive its rotation together. Migration
`0015_xero_refresh_locks.sql` adds a short-lived D1 lock so concurrent Worker
requests cannot consume the same rotating token at once. It follows the Tasks
and Job Cards migrations 0013 and 0014. Each connection
reports `refresh_health` (`healthy`, `reconnect_required`,
`unavailable`, or `not_configured`), `identity_status` (`verified`, `mismatch`,
or `unverified`), and `checked_at`; transient Xero failures remain distinct
from a rejected refresh token. Safe error text is returned for Accounts
diagnostics. Access and refresh tokens remain server-side. The status probe may
rotate the stored OAuth refresh token, but it does not create, edit, send, void,
or pay an Xero invoice.

`GET /api/xero/records?q=&limit=&offset=` is the Accounts job-card and estimate
picker. It searches record IDs, references and payload fields, archived
candidate/confirmed metadata, source filenames, and job-card OCR text. Pages
contain at most 100 records and include `pagination.has_more` and
`pagination.next_offset`; search results remain protected by the Xero Accounts
administrator check. OCR-derived values continue to be labelled as candidates
until Accounts confirms them.

These read paths do not perform Xero invoice create, edit, send, void, or payment
actions, and do not change the configured scope list. Existing SharePoint archive
pages are replaced only by the explicit refresh path; this flow does not delete
archived pages or Xero source invoices.
