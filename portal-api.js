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
    if (Array.isArray(settings.upstreamScopes) && settings.upstreamScopes.length) {
      var upstreamAuth = await authContext();
      if (upstreamAuth && typeof upstreamAuth.acquireToken === "function") {
        var upstreamToken = await upstreamAuth.acquireToken(settings.upstreamScopes, { optional: true });
        if (upstreamToken) headers["X-GMT-Upstream-Authorization"] = "Bearer " + upstreamToken;
      }
    }
    if (Array.isArray(settings.requiredUpstreamScopes) && settings.requiredUpstreamScopes.length) {
      var requiredUpstreamAuth = await authContext();
      if (!requiredUpstreamAuth || typeof requiredUpstreamAuth.acquireToken !== "function") throw new Error("Flow Service sign-in context unavailable");
      var requiredUpstreamToken = await requiredUpstreamAuth.acquireToken(settings.requiredUpstreamScopes);
      if (!requiredUpstreamToken) throw new Error("Flow Service access token unavailable");
      headers["X-GMT-Upstream-Authorization"] = "Bearer " + requiredUpstreamToken;
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

  function queueAttachments(recordId, attachments) {
    return request("/api/records/" + encodeURIComponent(recordId) + "/attachments", {
      method: "POST",
      body: { attachments: Array.isArray(attachments) ? attachments : [] }
    });
  }

  function getRecord(recordId) {
    return request("/api/records/" + encodeURIComponent(recordId), { method: "GET" });
  }

  function deleteRecord(recordId, day) {
    var path = "/api/records/" + encodeURIComponent(recordId);
    var value = String(day || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) path += "?day=" + encodeURIComponent(value);
    return request(path, { method: "DELETE" });
  }

  function history(kind, options) {
    var value = String(kind || "all").trim() || "all";
    return request("/api/history?kind=" + encodeURIComponent(value), {
      method: "GET",
      upstreamScopes: Array.isArray(config.timesheetHistoryScopes) ? config.timesheetHistoryScopes : []
    });
  }

  function estimateIndexList() {
    return request("/api/estimates/index?limit=500", { method: "GET" });
  }

  function searchEstimateArchive(filters) {
    var params = new URLSearchParams();
    var values = filters && typeof filters === "object" ? filters : {};
    Object.keys(values).forEach(function (key) {
      var value = String(values[key] == null ? "" : values[key]).trim();
      if (value) params.set(key, value);
    });
    return request("/api/archive/estimates" + (params.toString() ? "?" + params.toString() : ""), { method: "GET" });
  }

  function getEstimateArchiveRecord(archiveId) {
    return request("/api/archive/estimates/" + encodeURIComponent(String(archiveId || "")), { method: "GET" });
  }

  function archiveAppEstimate(record) {
    return request("/api/archive/estimates/app", { method: "POST", body: record || {} });
  }

  function sendEstimate(record) {
    return request("/api/estimates/send", {
      method: "POST", body: record || {},
      requiredUpstreamScopes: Array.isArray(config.estimateSendScopes) ? config.estimateSendScopes : []
    });
  }

  async function getEstimateArchiveContent(archiveId, contentId, fileName) {
    var endpoint = baseUrl();
    if (!endpoint) throw new Error("Protected portal archive is not configured");
    var headers = {};
    var requestedScopes = scopes();
    if (requestedScopes.length) {
      var auth = await authContext();
      if (!auth || typeof auth.acquireToken !== "function") throw new Error("Sign-in context unavailable");
      var token = await auth.acquireToken(requestedScopes);
      if (!token) throw new Error("Protected portal access token unavailable");
      headers.Authorization = "Bearer " + token;
    }
    var path = "/api/archive/estimates/" + encodeURIComponent(String(archiveId || "")) + "/content/" + encodeURIComponent(String(contentId || ""));
    var response = await fetch(endpoint + path, { method: "GET", headers: headers, credentials: "include", cache: "no-store" });
    if (!response.ok) {
      var message = "Archived file could not be downloaded (" + response.status + ")";
      try { var body = await response.json(); if (body && body.error) message = body.error; } catch (_) {}
      throw new Error(message);
    }
    var disposition = response.headers.get("content-disposition") || "";
    var match = disposition.match(/filename="?([^";]+)"?/i);
    var name = String(fileName || (match && match[1]) || "archived-file").replace(/[\\/\r\n]/g, "_");
    var blob = await response.blob();
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
  }

  function getProfile() {
    return request("/api/profile", { method: "GET" });
  }

  function saveProfile(profile) {
    var value = profile && typeof profile === "object" ? profile : {};
    return request("/api/profile", {
      method: "PUT",
      body: { name: value.name || "", notificationEmail: value.notificationEmail || "" }
    });
  }

  function dispatchCorrections(dryRun) {
    return request('/api/admin/dispatch-queue', { method: 'POST', body: { dryRun: dryRun === true } });
  }

  function correctionQueueStatus() {
    return request('/api/admin/dispatch-queue', { method: 'GET' });
  }

  function xeroConnect() {
    return request("/api/xero/connect", { method: "POST", body: {} });
  }

  function xeroStatus() {
    return request("/api/xero/status", { method: "GET" });
  }

  function xeroInvoices(tenantId, limit, page, status) {
    var params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (limit) params.set("limit", String(limit));
    if (page) params.set("page", String(page));
    if (status) params.set("status", status);
    return request("/api/xero/invoices" + (params.toString() ? "?" + params.toString() : ""), { method: "GET" });
  }

  function xeroSetupData(tenantId) {
    var params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    return request("/api/xero/setup-data" + (params.toString() ? "?" + params.toString() : ""), { method: "GET" });
  }

  function xeroRecords() {
    return request("/api/xero/records", { method: "GET" });
  }

  function xeroInvoice(invoiceId, tenantId) {
    var params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId) + (params.toString() ? "?" + params.toString() : ""), { method: "GET" });
  }

  function xeroCreateInvoice(body) {
    return request("/api/xero/invoices", { method: "POST", body: body || {} });
  }

  function xeroUpdateInvoice(invoiceId, body) {
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId), { method: "PATCH", body: body || {} });
  }

  function xeroSendInvoice(invoiceId, tenantId) {
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId) + "/send", { method: "POST", body: { tenantId: tenantId || "" } });
  }

  function xeroDeleteInvoice(invoiceId, tenantId) {
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId) + "/delete", { method: "POST", body: { tenantId: tenantId || "" } });
  }

  function xeroLinkInvoice(invoiceId, recordIds, tenantId) {
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId) + "/links", { method: "POST", body: { tenantId: tenantId || "", recordIds: Array.isArray(recordIds) ? recordIds : [] } });
  }

  function xeroInvoiceLinks(invoiceId, tenantId) {
    var params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    return request("/api/xero/invoices/" + encodeURIComponent(invoiceId) + "/links" + (params.toString() ? "?" + params.toString() : ""), { method: "GET" });
  }

  function recordInvoiceLinks(kind, recordId) {
    return request("/api/records/" + encodeURIComponent(kind) + "/" + encodeURIComponent(recordId) + "/invoices", { method: "GET" });
  }

  function estimateIndexUpsert(estimate) {
    return request("/api/estimates/index", { method: "POST", body: estimate || {} });
  }

  function xeroLookupInvoice(invoiceNumber, tenantId) {
    return request("/api/xero/invoices/lookup", { method: "POST", body: { invoiceNumber: invoiceNumber, tenantId: tenantId || "" } });
  }

  function xeroSyncJobCard(recordId, invoiceNumber, tenantId) {
    return request("/api/xero/job-cards/" + encodeURIComponent(recordId) + "/sync", { method: "POST", body: { invoiceNumber: invoiceNumber || "", tenantId: tenantId || "" } });
  }

  window.GMTPortalApi = {
    enabled: enabled,
    request: request,
    saveRecord: saveRecord,
    updateRecord: updateRecord,
    queueAttachments: queueAttachments,
    getRecord: getRecord,
    deleteRecord: deleteRecord,
    history: history,
    estimateIndexList: estimateIndexList,
    searchEstimateArchive: searchEstimateArchive,
    getEstimateArchiveRecord: getEstimateArchiveRecord,
    getEstimateArchiveContent: getEstimateArchiveContent,
    archiveAppEstimate: archiveAppEstimate,
    sendEstimate: sendEstimate,
    getProfile: getProfile,
    saveProfile: saveProfile,
    dispatchCorrections: dispatchCorrections,
    correctionQueueStatus: correctionQueueStatus,
    xeroConnect: xeroConnect,
    xeroStatus: xeroStatus,
    xeroInvoices: xeroInvoices,
    xeroSetupData: xeroSetupData,
    xeroRecords: xeroRecords,
    xeroInvoice: xeroInvoice,
    xeroCreateInvoice: xeroCreateInvoice,
    xeroUpdateInvoice: xeroUpdateInvoice,
    xeroSendInvoice: xeroSendInvoice,
    xeroDeleteInvoice: xeroDeleteInvoice,
    xeroLinkInvoice: xeroLinkInvoice,
    xeroInvoiceLinks: xeroInvoiceLinks,
    recordInvoiceLinks: recordInvoiceLinks,
    estimateIndexUpsert: estimateIndexUpsert,
    xeroLookupInvoice: xeroLookupInvoice,
    xeroSyncJobCard: xeroSyncJobCard
  };
}());
