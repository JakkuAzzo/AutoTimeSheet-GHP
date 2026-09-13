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
6. Store the activated timesheet FormSubmit endpoint as the Worker secret
   `FORM_SUBMIT_TIMESHEET_ENDPOINT`. The endpoint is never returned to the
   browser. The default dispatch window is Friday at 18:00 Europe/London and
   can be changed with `DISPATCH_WEEKDAY`, `DISPATCH_HOUR`, and
   `DISPATCH_TIMEZONE`.

The Pages `config.js` should point `portalApiEndpoint` and
`portalHistoryEndpoint` at the deployed Worker origin. The portal can use the
OIDC scopes `openid profile email`; the Worker validates the signed SPA ID token
against the SPA audience so portal CRUD does not depend on Power Automate
permissions. When the delegated Power Automate Flow Service permission is
configured, a Flow-scoped access token is also accepted and enables the
optional upstream history merge.

The Worker does not fabricate SharePoint or Excel records. Existing intake
flows remain responsible for filing generated attachments; D1 is the durable
protected portal history and edit source. The scheduled dispatcher records
`Queued for Accounts`, `Sent to Accounts`, or `Delivery failed`; `Sent to
Accounts` means FormSubmit accepted the message and does not claim that a
SharePoint workbook has finished processing it.

## API behavior

The protected API exposes `GET /api/history`, `POST /api/records`,
`GET/PATCH/DELETE /api/records/:id`, `POST /api/records/:id/attachments`, and
`GET /api/health`. Record history is filtered by the verified Entra owner.
DELETE is a soft delete: submitted records remain in `record_versions` and
are removed from ordinary history responses. The attachment route replaces the
queued files for the same stable record ID, so a correction edited again before
dispatch sends only the latest version.
