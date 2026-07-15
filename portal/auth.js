(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.entraSpaAuth;
  if (!config || !config.enabled) {
    var unavailableMain = document.querySelector(".app-main");
    if (unavailableMain) unavailableMain.hidden = false;
    return;
  }

  var appMain = document.querySelector(".app-main");
  var signOutButton = document.getElementById("portal-sign-out");
  var status = document.createElement("p");
  status.className = "portal-auth-status";
  status.setAttribute("role", "status");
  status.textContent = "Signing in to the GMT Staff Portal...";
  document.body.appendChild(status);

  function showFailure(message) {
    status.textContent = message;
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Sign in";
    retry.addEventListener("click", function () {
      window.location.reload();
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(retry);
  }

  function loadMsal() {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@azure/msal-browser@4.25.1/lib/msal-browser.min.js";
      script.async = true;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Microsoft sign-in library could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }

  loadMsal().then(async function () {
    var redirectUri = window.location.origin + config.redirectPath;
    var msalApp = new window.msal.PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: "https://login.microsoftonline.com/" + config.tenantId,
        redirectUri: redirectUri,
        navigateToLoginRequestUrl: false
      },
      cache: { cacheLocation: "sessionStorage" }
    });

    await msalApp.initialize();
    var result = await msalApp.handleRedirectPromise();
    var account = (result && result.account) || msalApp.getActiveAccount() || msalApp.getAllAccounts()[0];

    if (!account) {
      await msalApp.loginRedirect({ scopes: ["openid", "profile", "email"] });
      return;
    }

    if (account.tenantId !== config.tenantId) {
      throw new Error("This portal is restricted to GMT Microsoft 365 accounts.");
    }

    var permittedGroups = Array.isArray(config.allowedGroupIds) ? config.allowedGroupIds.filter(Boolean) : [];
    var accountGroups = account.idTokenClaims && Array.isArray(account.idTokenClaims.groups) ? account.idTokenClaims.groups : [];
    if (permittedGroups.length && !permittedGroups.some(function (groupId) {
      return accountGroups.indexOf(groupId) !== -1;
    })) {
      throw new Error("Your GMT account is not permitted to use this portal.");
    }

    msalApp.setActiveAccount(account);
    document.documentElement.dataset.gmtAuthenticated = "true";
    status.remove();
    if (appMain) appMain.hidden = false;
    if (signOutButton) {
      signOutButton.hidden = false;
      signOutButton.addEventListener("click", function () {
        msalApp.logoutRedirect({ account: account });
      }, { once: true });
    }
  }).catch(function (error) {
    showFailure(error && error.message ? error.message : "GMT Staff Portal sign-in could not be completed.");
  });
}());
