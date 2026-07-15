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

## Entra setup (administrator action)

1. In the GMT tenant, create an **App registration** named `GMT Staff Portal`.
2. Choose **Accounts in this organizational directory only**.
3. Add SPA redirect URIs for the exact GitHub Pages routes used in the trial:
   - `https://jakkuazzo.github.io/AutoTimeSheet-GHP/portal/`
   - `https://jakkuazzo.github.io/AutoTimeSheet-GHP/timesheets/`
4. Do not create a client secret.
5. Start with OpenID Connect scopes only: `openid`, `profile`, `email`.
6. Optionally create an Entra security group for permitted staff and record its
   group object ID in `allowedGroupIds` after an access-policy decision.
7. Test with a non-admin employee account, a permitted account and a denied
   account.

Creating the app registration creates a persistent OAuth identity and needs a
GMT administrator's review at the time of creation.

## Repository configuration

`config.js` includes a disabled `entraSpaAuth` block. Enable it only after the
app registration exists:

```js
entraSpaAuth: {
  enabled: true,
  tenantId: "<GMT tenant ID>",
  clientId: "<public Entra application client ID>",
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
