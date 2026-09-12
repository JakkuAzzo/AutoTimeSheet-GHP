(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.entraSpaAuth;
  var authReadyResolve;
  window.GMT_PORTAL_AUTH_READY = new Promise(function (resolve) {
    authReadyResolve = resolve;
  });
  if (!config || !config.enabled) {
    authReadyResolve({});
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
      var claims = account.idTokenClaims || {};
      var accountName = "";
      var nameCandidates = [claims.name, account.name];
      for (var candidateIndex = 0; candidateIndex < nameCandidates.length; candidateIndex += 1) {
        var candidate = String(nameCandidates[candidateIndex] || "").trim();
        if (candidate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
          accountName = candidate;
          break;
        }
      }
      if (!accountName) {
        accountName = [claims.given_name || claims.givenName, claims.family_name || claims.familyName]
          .map(function (part) { return String(part || "").trim(); })
          .filter(Boolean)
          .join(" ");
      }
      var accountSubject = account.homeAccountId || "";
      var accountEmail = String(account.username || claims.preferred_username || claims.email || claims.upn || "").trim();
      // Keep a manually entered name for the same account when Microsoft has
      // only returned its email address as the display name.
      if (accountName) {
        profile.name = accountName;
      } else if (profile.subject !== accountSubject || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.name || "").trim())) {
        profile.name = "";
      }
      profile.username = accountEmail;
      profile.subject = accountSubject;
      localStorage.setItem(profileKey, JSON.stringify(profile));
      renderIdentityLabels(profile);
      document.dispatchEvent(new CustomEvent("gmtportalidentity", { detail: profile }));
    } catch (_) {
      // The portal remains usable when browser storage is unavailable.
    }
  }

  function renderIdentityLabels(profile) {
    var identity = profile || {};
    var label = String(identity.name || identity.username || "").trim();
    document.querySelectorAll("[data-portal-identity-name]").forEach(function (element) {
      element.textContent = label;
      element.hidden = !label;
    });
  }

  // Paint a cached identity immediately while the current Entra account is
  // being restored. The authenticated result below replaces it before the
  // protected application is revealed, so a prior account is never used for
  // data access.
  try {
    renderIdentityLabels(JSON.parse(localStorage.getItem(profileKey) || "{}"));
  } catch (_) {
    // A malformed profile is ignored; the authenticated result will replace it.
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
    var initialIdToken = result && result.idToken ? result.idToken : "";
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

    // Make the authenticated MSAL context available to protected portal
    // features. Tokens are acquired just-in-time for the configured scope;
    // no token is written to localStorage or exposed in the page. The Worker
    // can validate the SPA's signed ID token when a separate API permission
    // is unavailable, and will use a Flow Service access token when that
    // delegated permission is configured later.
    window.GMT_PORTAL_AUTH = {
      acquireToken: function (scopes) {
        var requestedScopes = Array.isArray(scopes) ? scopes.filter(Boolean) : [];
        if (!requestedScopes.length) return Promise.resolve(initialIdToken);
        var oidcOnly = requestedScopes.every(function (scope) {
          return /^(openid|profile|email|offline_access)$/i.test(String(scope || "").trim());
        });
        var request = { account: account, scopes: requestedScopes };
        return msalApp.acquireTokenSilent(request)
          .catch(function (error) {
            // Use a redirect so Safari does not depend on a popup being
            // allowed by the browser when an interactive token request is needed.
            var code = String(error && error.errorCode || "").toLowerCase();
            var message = String(error && (error.errorMessage || error.message) || "").toLowerCase();
            var needsConsent = code === "invalid_grant" || message.indexOf("aadsts65001") !== -1 || message.indexOf("consent") !== -1;
            if (!needsConsent && code !== "interaction_required" && code !== "consent_required" && code !== "login_required") throw error;
            var interactiveRequest = Object.assign({}, request, { prompt: "consent" });
            sessionStorage.setItem(postSignInKey, window.location.pathname + window.location.search + window.location.hash);
            return msalApp.acquireTokenRedirect(Object.assign({}, interactiveRequest, {
              redirectStartPage: window.location.href
            }));
          })
          .then(function (tokenResult) {
            // AuthenticationResult includes an ID token even when no API
            // access token is issued for the requested OIDC-only scopes. Use
            // that signed identity token for the first-party Worker; resource
            // access tokens remain preferred for any configured API scopes.
            var token = oidcOnly
              ? (tokenResult.idToken || tokenResult.accessToken)
              : (tokenResult.accessToken || tokenResult.idToken);
            return token || initialIdToken || "";
          });
      }
    };
    authReadyResolve(window.GMT_PORTAL_AUTH);

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
        signOutButton.disabled = true;
        signOutButton.textContent = "Signing out…";
        sessionStorage.removeItem(authSessionKey);
        sessionStorage.removeItem(postSignInKey);
        msalApp.setActiveAccount(null);
        try {
          localStorage.removeItem(profileKey);
        } catch (_) {
          // A storage failure must not prevent the portal sign-out.
        }
        // Remove only this application's cached account. Do not call Microsoft's
        // global logout endpoint: the browser's Microsoft 365 session must remain
        // available for Outlook and other GMT services.
        var tokenCache = typeof msalApp.getTokenCache === "function" ? msalApp.getTokenCache() : null;
        try {
          if (tokenCache && typeof tokenCache.removeAccount === "function") {
            Promise.resolve(tokenCache.removeAccount(account)).catch(function () {});
          }
        } catch (_) {
          // Cache cleanup is best effort; the portal session keys are already gone.
        }
        window.location.replace(window.location.origin + portalRootPath());
      }, { once: true });
    }
  }).catch(function (error) {
    showFailure(error && error.message ? error.message : "GMT Staff Portal sign-in could not be completed.");
  });
}());
