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

The actual MSAL implementation must redirect unauthenticated users before
rendering internal tools, use the configured tenant authority, validate the
returned account/tenant, and provide a clear sign-out action. It must not use
an implicit grant, a password grant, or a hard-coded allow-list of personal
email addresses.

## Production target

When the portal moves under `https://gmt-services.co.uk/portal/` or
`https://portal.gmt-services.co.uk/`, register those new exact redirect URIs
and retire the GitHub Pages URIs only after end-to-end tests pass.
