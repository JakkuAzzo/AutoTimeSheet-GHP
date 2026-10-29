(function () {
  "use strict";
  var link = document.getElementById("staff-portal-link");
  var settings = window.GMT_APP_CONFIG || {};
  var config = settings.entraSpaAuth;
  if (!link || !config || !config.enabled || !window.msal || !settings.portalApiEndpoint) return;

  // This is a passive check: never begin an interactive sign-in from a 404.
  (async function () {
    var remembered = sessionStorage.getItem("gmt.portal.authenticated.v1");
    if (!remembered) return;
    var client = new window.msal.PublicClientApplication({
      auth: { clientId: config.clientId, authority: "https://login.microsoftonline.com/" + config.tenantId, redirectUri: window.location.origin + config.redirectPath, navigateToLoginRequestUrl: false },
      cache: { cacheLocation: "sessionStorage" }
    });
    await client.initialize();
    var account = client.getActiveAccount();
    if (!account || account.homeAccountId !== remembered || account.tenantId !== config.tenantId) return;
    var requiredGroups = Array.isArray(config.allowedGroupIds) ? config.allowedGroupIds.filter(Boolean) : [];
    var groups = account.idTokenClaims && Array.isArray(account.idTokenClaims.groups) ? account.idTokenClaims.groups : [];
    if (requiredGroups.length && !requiredGroups.some(function (group) { return groups.indexOf(group) !== -1; })) return;
    var result = await client.acquireTokenSilent({ account: account, scopes: settings.portalApiScopes || ["openid", "profile", "email"] });
    var token = result && (result.idToken || result.accessToken);
    if (!token) return;
    var response = await fetch(String(settings.portalApiEndpoint).replace(/\/+$/, "") + "/api/profile", {
      method: "GET", headers: { Accept: "application/json", Authorization: "Bearer " + token }, cache: "no-store", credentials: "include"
    });
    if (response.ok) link.hidden = false;
  }()).catch(function () { /* Keep the link hidden when the session cannot be verified. */ });
}());
