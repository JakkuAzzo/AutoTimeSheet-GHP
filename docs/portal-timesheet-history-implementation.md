# Portal completed-timesheet history

The `portal/timesheets.html` page provides an authenticated, identity-filtered
submission history. It renders the protected history in a same-origin iframe,
shows all submission categories by default, and lets the employee filter weekly
timesheets, clock events, job cards, estimates, calendar requests or tasks.
Clock events are visible in history but remain immutable; weekly submissions
include an Edit submission link that restores the protected daily rows.

The browser never calls SharePoint directly or stores access tokens. The
Cloudflare Worker in `cloudflare-worker/` validates the Microsoft Entra token,
uses the verified tenant/object/UPN identity, stores records in D1, and returns
projection-only history. `portal-api.js` sends just-in-time bearer tokens with
`credentials: include` and `cache: no-store`.

The Worker accepts `GET /api/history`, `POST /api/records`,
`GET/PATCH/DELETE /api/records/:id`, and `GET /api/health`. DELETE is a protected
soft delete for drafts or administrators so submitted versions remain available
in the audit table. Existing Power Automate intake remains responsible for
filing generated XLSX/CSV attachments into SharePoint/Excel; D1 is the durable
cross-device history and edit source.

The contract tests exercise the authenticated request, projection-only
rendering, HTML escaping, and the deliberate setup state while the protected
origin is not configured. The browser smoke test also verifies iframe rendering
and category filtering against a local protected-API stub.
