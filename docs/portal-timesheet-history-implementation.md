# Portal completed-timesheet history

The `portal/timesheets.html` page now has a complete authenticated history
view. It handles loading, refresh, empty, sign-in-expired, unauthorised, and
service-error states, and renders only the fields defined by the protected
history contract.

The browser calls `config.timesheetHistoryEndpoint` with `credentials:
include` and, when configured, a just-in-time Entra access token from
`auth.js`. It does not call SharePoint directly, persist tokens, or render raw
workbook links. The endpoint must return `{ "records": [...] }` and enforce
the signed-in employee's identity on the server.

The endpoint and API scopes remain blank in `config.js` intentionally. Before
filling them, deploy the protected Microsoft 365 service that:

1. validates the Entra token and checks `tid`, `oid`, and the signed-in UPN;
2. maps that identity to the employee's submitted records server-side;
3. returns only the projection in
   `power-platform/portal-timesheet-history-contract.json`;
4. returns `401` or `403` when authentication or authorisation fails; and
5. never exposes a raw SharePoint URL or falls back to an unfiltered register.

The contract test exercises the authenticated request, projection-only
rendering, HTML escaping, and the deliberate setup state while the endpoint is
not configured.
