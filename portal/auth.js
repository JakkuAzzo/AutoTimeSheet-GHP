(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.entraSpaAuth;
  if (!config || !config.enabled) {
    var unavailableMain = document.querySelector("main");
    if (unavailableMain) unavailableMain.hidden = false;
    return;
  }

  var appMain = document.querySelector("main");
  var signOutButton = document.getElementById("portal-sign-out");
  var postSignInKey = "gmt.portal.postSignInPath";
  var authSessionKey = "gmt.portal.authenticated.v1";
  var profileKey = "gmt.portal.profile.v1";
  var status = document.createElement("p");
  status.className = "portal-auth-status";
  status.setAttribute("role", "status");
  status.innerHTML = "Signing in to the GMT Staff Portal...<br><small>On first sign-in, Microsoft may ask you to register Authenticator or a passkey. Keep your GMT account and this browser open until setup is complete.</small>";
  document.body.appendChild(status);

  function revealApplication() {
    document.documentElement.dataset.gmtAuthenticated = "true";
    if (appMain) {
      // Safari can retain the initial hidden layout after an Entra redirect.
      appMain.hidden = false;
      appMain.removeAttribute("hidden");
      appMain.style.removeProperty("display");
    }
    if (status.isConnected) status.remove();
  }

  window.addEventListener("pageshow", function () {
    if (document.documentElement.dataset.gmtAuthenticated === "true") {
      revealApplication();
    }
  });

  function showFailure(message) {
    status.textContent = message;
    var help = document.createElement("p");
    help.innerHTML = "<small>If Microsoft cannot complete first-time security setup, choose <em>Other ways to sign in</em> and ask the GMT administrator for a Temporary Access Pass. You can manage registered methods at <a href=\"https://mysignins.microsoft.com/security-info\" target=\"_blank\" rel=\"noopener\">Microsoft Security info</a>.</small>";
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Sign in";
    retry.addEventListener("click", function () {
      window.location.reload();
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(help);
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

  function portalRootPath() {
    return config.redirectPath.replace(/portal\/?$/, "");
  }

  function requestedPath() {
    var candidate = sessionStorage.getItem(postSignInKey) || "";
    return candidate.indexOf(portalRootPath()) === 0 ? candidate : "";
  }

  function recordIdentity(account) {
    try {
      var profile = JSON.parse(localStorage.getItem(profileKey) || "{}");
      // The authenticated Entra account is authoritative. Do not retain a
      // previous user's name when another account signs in on this browser.
      var accountName = String(account.name || "").trim();
      var accountSubject = account.homeAccountId || "";
      var emailLikeName = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountName);
      // Keep a manually entered name for the same account when Microsoft has
      // only returned its email address as the display name.
      if (!emailLikeName) {
        profile.name = accountName;
      } else if (profile.subject !== accountSubject || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.name || "").trim())) {
        profile.name = "";
      }
      profile.username = account.username || "";
      profile.subject = accountSubject;
      localStorage.setItem(profileKey, JSON.stringify(profile));
      document.dispatchEvent(new CustomEvent("gmtportalidentity", { detail: profile }));
    } catch (_) {
      // The portal remains usable when browser storage is unavailable.
    }
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
    var account = (result && result.account) || msalApp.getActiveAccount();
    var rememberedAccountId = sessionStorage.getItem(authSessionKey) || "";

    // Only reuse an account that this tab explicitly authenticated. Do not
    // pick an arbitrary cached account from a shared browser session.
    if (!result && (!account || account.homeAccountId !== rememberedAccountId)) {
      account = null;
    }

    if (!account) {
      if (window.location.pathname !== config.redirectPath) {
        sessionStorage.setItem(postSignInKey, window.location.pathname + window.location.search + window.location.hash);
      }
      await msalApp.loginRedirect({
        scopes: ["openid", "profile", "email"],
        prompt: "select_account"
      });
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
    sessionStorage.setItem(authSessionKey, account.homeAccountId || account.username || "");
    recordIdentity(account);

    var returnTo = requestedPath();
    if (window.location.pathname === config.redirectPath && returnTo && returnTo !== window.location.pathname) {
      sessionStorage.removeItem(postSignInKey);
      window.location.replace(returnTo);
      return;
    }

    revealApplication();
    // Allow Safari to complete the redirect layout pass before revealing content.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(revealApplication);
    });
    if (signOutButton) {
      signOutButton.hidden = false;
      signOutButton.addEventListener("click", function () {
        sessionStorage.removeItem(authSessionKey);
        msalApp.setActiveAccount(null);
        msalApp.logoutRedirect({
          account: account,
          postLogoutRedirectUri: window.location.origin + config.redirectPath
        });
      }, { once: true });
    }
  }).catch(function (error) {
    showFailure(error && error.message ? error.message : "GMT Staff Portal sign-in could not be completed.");
  });
}());
