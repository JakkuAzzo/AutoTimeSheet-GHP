(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG || {};

  function baseUrl() {
    return String(config.portalApiEndpoint || "").trim().replace(/\/+$/, "");
  }

  function scopes() {
    var value = config.portalApiScopes || config.portalHistoryScopes || config.timesheetHistoryScopes || [];
    if (Array.isArray(value)) return value.map(function (scope) { return String(scope || "").trim(); }).filter(Boolean);
    return String(value || "").split(/\s+/).map(function (scope) { return scope.trim(); }).filter(Boolean);
  }

  function authContext() {
    if (window.parent && window.parent !== window && window.parent.GMT_PORTAL_AUTH) return Promise.resolve(window.parent.GMT_PORTAL_AUTH);
    if (window.parent && window.parent !== window && window.parent.GMT_PORTAL_AUTH_READY) return window.parent.GMT_PORTAL_AUTH_READY;
    if (window.GMT_PORTAL_AUTH && typeof window.GMT_PORTAL_AUTH.acquireToken === "function") return Promise.resolve(window.GMT_PORTAL_AUTH);
    return window.GMT_PORTAL_AUTH_READY || Promise.resolve(window.GMT_PORTAL_AUTH || {});
  }

  async function request(path, options) {
    var endpoint = baseUrl();
    if (!endpoint) return null;
    var settings = options || {};
    var headers = Object.assign({ Accept: "application/json" }, settings.headers || {});
    var requestedScopes = scopes();
    if (requestedScopes.length) {
      var auth = await authContext();
      if (!auth || typeof auth.acquireToken !== "function") throw new Error("Sign-in context unavailable");
      var token = await auth.acquireToken(requestedScopes);
      if (!token) throw new Error("Protected portal access token unavailable");
      headers.Authorization = "Bearer " + token;
    }
    var fetchOptions = {
      method: settings.method || "GET",
      headers: headers,
      credentials: "include",
      cache: "no-store"
    };
    if (settings.body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(settings.body);
    }
    var response = await fetch(endpoint + (String(path || "").charAt(0) === "/" ? path : "/" + path), fetchOptions);
    var text = await response.text();
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      var error = new Error(body && body.error ? body.error : "Protected portal request failed (" + response.status + ")");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function enabled() {
    return !!baseUrl();
  }

  function saveRecord(record) {
    return request("/api/records", { method: "POST", body: record });
  }

  function updateRecord(recordId, record) {
    return request("/api/records/" + encodeURIComponent(recordId), { method: "PATCH", body: record });
  }

  function getRecord(recordId) {
    return request("/api/records/" + encodeURIComponent(recordId), { method: "GET" });
  }

  function deleteRecord(recordId) {
    return request("/api/records/" + encodeURIComponent(recordId), { method: "DELETE" });
  }

  function history(kind) {
    var value = String(kind || "all").trim() || "all";
    return request("/api/history?kind=" + encodeURIComponent(value), { method: "GET" });
  }

  window.GMTPortalApi = {
    enabled: enabled,
    request: request,
    saveRecord: saveRecord,
    updateRecord: updateRecord,
    getRecord: getRecord,
    deleteRecord: deleteRecord,
    history: history
  };
}());
