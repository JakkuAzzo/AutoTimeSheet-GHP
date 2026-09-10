# GMT protected portal API

This Worker stores authenticated GMT portal records in Cloudflare D1 and
exposes projection-only history. Microsoft Entra access tokens are verified
against the GMT tenant signing keys before any record is read or written.

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

The Pages `config.js` should point `portalApiEndpoint` and
`portalHistoryEndpoint` at the deployed Worker origin and use the same
`https://service.flow.microsoft.com//.default` scope used by the existing
Entra-protected Power Automate route.

The Worker does not fabricate SharePoint or Excel records. Existing intake
flows remain responsible for filing generated attachments; D1 is the durable
protected portal history and edit source.

## API behavior

The protected API exposes `GET /api/history`, `POST /api/records`,
`GET/PATCH/DELETE /api/records/:id`, and `GET /api/health`. Record history is
filtered by the verified Entra owner. DELETE is a soft delete: submitted records
remain in `record_versions` and are removed from ordinary history responses.
