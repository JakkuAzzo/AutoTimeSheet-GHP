# Entra Authentication for the GMT GitHub Pages Staff Portal

## Decision

GitHub Pages can require employees to sign in with GMT Microsoft 365 accounts
before the staff-portal interface is used. It must be implemented as a
Microsoft Entra single-page application (SPA), using MSAL Browser and OAuth
2.0 authorization-code flow with PKCE.

The public `clientId`, tenant ID and redirect path are safe to ship in browser
code. A client secret, Microsoft Graph application permission, SharePoint token
or mailbox credential must never be shipped to GitHub Pages.

## Scope and limitations

This protects the portal UI and allows it to identify the signed-in employee.
It does **not** make a static GitHub Pages site a secure Microsoft data API:

- Static files remain publicly downloadable by design.
- FormSubmit cannot be made a trusted authenticated backend merely by hiding a
  form behind a client-side sign-in screen.
- Reading or writing private Lists, SharePoint files, calendars or mailboxes
  must go through Power Automate, an authenticated backend/worker, or a
  Microsoft-hosted internal app with least-privilege access.

The existing email-based submission route therefore remains the operational
baseline until the protected service layer is approved.

## Entra setup

The trial registration is now created in the GMT tenant:

- App registration: `GMT Staff Portal`
- Tenant: GMT Electrical Services Ltd
- Single-tenant account type: **Accounts in this organizational directory only**
- Client ID: `01b5a6c6-f6c1-47cb-aebe-67f07f415e4b`
- No client secret and no Microsoft Graph data permissions

Its SPA redirect URIs are:

   - `https://jakkuazzo.github.io/AutoTimeSheet-GHP/portal/`
   - `https://jakkuazzo.github.io/AutoTimeSheet-GHP/timesheets/`

The portal currently requests only OpenID Connect scopes: `openid`, `profile`,
and `email`. Optionally create an Entra security group for permitted staff and record its
   group object ID in `allowedGroupIds` after an access-policy decision.

Release checks remain: test with a non-admin employee account, a permitted
account and a denied account. When `allowedGroupIds` is empty, every account in
the GMT tenant may reach the UI; populate it before using the portal for a
restricted staff group.

## Repository configuration

`config.js` now enables the trial app registration:

```js
entraSpaAuth: {
  enabled: true,
  tenantId: "8b182d6b-6f34-4ca2-84ad-50ca712b5488",
  clientId: "01b5a6c6-f6c1-47cb-aebe-67f07f415e4b",
  redirectPath: "/AutoTimeSheet-GHP/portal/",
  allowedGroupIds: ["<optional GMT security group object ID>"]
}
```

The MSAL implementation now redirects unauthenticated users before rendering
the Staff Portal, Timesheets, Audit, Job Cards, Tools, Tasks and Calendar UI.
It uses the configured tenant authority, validates the returned account/tenant,
preserves a requested internal route through sign-in, and provides a portal
sign-out action. It does not use an implicit grant, a password grant, or a
hard-coded allow-list of personal email addresses.

Automated browser tests serve a test-only version of `config.js` with Entra
disabled. This keeps their test server local and does not change the deployed
configuration.

## Production target

When the portal moves under `https://gmt-services.co.uk/portal/` or
`https://portal.gmt-services.co.uk/`, register those new exact redirect URIs
and retire the GitHub Pages URIs only after end-to-end tests pass.
