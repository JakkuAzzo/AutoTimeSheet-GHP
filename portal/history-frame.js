(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("history-frame-status");
  var list = document.getElementById("history-frame-list");
  var filter = new URLSearchParams(window.location.search).get("filter") || "all";
  var records = [];
  var requestInFlight = false;

  function notify(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "gmt:history-status", message: message }, window.location.origin);
    }
  }

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function normaliseScopes(value) {
    if (Array.isArray(value)) return value.map(function (scope) { return String(scope || "").trim(); }).filter(Boolean);
    if (typeof value === "string") return value.split(/\s+/).map(function (scope) { return scope.trim(); }).filter(Boolean);
    return [];
  }

  function actionKey(record) {
    var value = String(record.kind || record.action || record.category || record.record_type || "timesheet").toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1 || value.indexOf("request") !== -1) return "tasks";
    return "timesheets";
  }

  function projectedRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    return {
      kind: record.kind || record.record_kind || "timesheets",
      employee_name: record.employee_name || record.employeeName || "",
      start_date: record.start_date || record.weekStart || "",
      end_date: record.end_date || record.weekEnd || "",
      record_date: record.record_date || record.recordDate || record.date || "",
      action: record.action || record.category || record.record_type || record.kind || "Timesheet",
      status: record.status || "Submitted",
      submitted_at: record.submitted_at || record.submittedAt || "",
      updated_at: record.updated_at || record.updatedAt || "",
      issue: record.issue || "",
      source_record_id: record.source_record_id || record.sourceRecordId || "",
      edit_url: record.edit_url || record.editUrl || ""
    };
  }

  function readRecords(body) {
    if (!body || typeof body !== "object" || !Array.isArray(body.records)) return null;
    return body.records.map(projectedRecord).filter(Boolean);
  }

  function showEmpty(message) {
    list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + "</p>";
  }

  function editHref(record) {
    var sourceId = String(record.source_record_id || "").trim();
    var explicit = String(record.edit_url || "").trim();
    if (explicit && explicit.charAt(0) === "/" && !explicit.startsWith("//")) return explicit;
    var key = actionKey(record);
    var state = String(record.status || "").toLowerCase();
    if (!sourceId || state === "recorded" || key === "clock") return "";
    return "../timesheets/create.html?edit=" + encodeURIComponent(sourceId);
  }

  function render() {
    var visible = filter === "all" ? records : records.filter(function (record) { return actionKey(record) === filter; });
    if (!visible.length) {
      showEmpty(records.length ? "No submissions match this filter." : "No records are displayed until the protected history service responds.");
      return;
    }
    list.innerHTML = visible.map(function (record) {
      var key = actionKey(record);
      var statusClass = String(record.status || "Submitted").toLowerCase().replace(/\s+/g, "-");
      var action = String(record.action || "Timesheet").replace(/_/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
      var date = record.record_date || "";
      var period = date ? "Date " + date : "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
      var edit = editHref(record);
      return '<article class="portal-item" data-history-kind="' + safe(key) + '"><strong>' + safe(record.employee_name || action) + '</strong>' +
        '<span class="portal-status ' + safe(statusClass) + '">' + safe(record.status || "Submitted") + '</span>' +
        '<p class="portal-item-meta">' + safe(action) + " · " + safe(period) + "</p>" +
        '<p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || "not recorded") + "</p>" +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + "</p>" : "") +
        (edit ? '<div class="portal-item-actions"><a class="button button-link" href="' + safe(edit) + '">Edit submission</a></div>' : "") +
        "</article>";
    }).join("");
  }

  function authContext() {
    if (window.parent && window.parent !== window && window.parent.GMT_PORTAL_AUTH) return Promise.resolve(window.parent.GMT_PORTAL_AUTH);
    if (window.parent && window.parent !== window && window.parent.GMT_PORTAL_AUTH_READY) return window.parent.GMT_PORTAL_AUTH_READY;
    return window.GMT_PORTAL_AUTH_READY || Promise.resolve(window.GMT_PORTAL_AUTH || {});
  }

  async function load() {
    if (requestInFlight) return;
    var endpoint = String(config.portalHistoryEndpoint || config.portalApiEndpoint || config.timesheetHistoryEndpoint || "").trim();
    if (!endpoint) {
      status.textContent = "Protected submission history is not connected.";
      notify("Protected submission history is not connected.");
      showEmpty("No records are displayed until the protected history service responds.");
      return;
    }
    requestInFlight = true;
    status.textContent = "Loading your records…";
    notify("Loading your records…");
    try {
      var headers = { Accept: "application/json" };
      var scopes = normaliseScopes(config.portalHistoryScopes || config.portalApiScopes || config.timesheetHistoryScopes);
      var auth = await authContext();
      if (scopes.length) {
        if (!auth || typeof auth.acquireToken !== "function") throw new Error("Sign-in context unavailable");
        var token = await auth.acquireToken(scopes);
        if (!token) throw new Error("History access token unavailable");
        headers.Authorization = "Bearer " + token;
      }
      var response = await fetch(endpoint, { credentials: "include", cache: "no-store", headers: headers });
      if (response.status === 401) throw new Error("Your GMT sign-in has expired");
      if (response.status === 403) throw new Error("Your GMT account is not authorised to view these records");
      if (!response.ok) throw new Error("History request failed");
      var body = await response.json();
      records = readRecords(body);
      if (!records) throw new Error("History response was not valid");
      render();
      status.textContent = records.length ? "Showing authorised submissions for your signed-in GMT identity." : "No submissions were found for this account.";
      notify(status.textContent);
    } catch (error) {
      status.textContent = error && error.message ? error.message : "Your submissions could not be loaded.";
      notify(status.textContent);
      showEmpty("No records are displayed until the protected history service responds.");
    } finally {
      requestInFlight = false;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "gmt:history-filter") {
      filter = String(event.data.filter || "all");
      render();
    }
    if (event.data.type === "gmt:history-refresh") load();
  });

  window.parent && window.parent !== window && window.parent.postMessage({ type: "gmt:history-ready" }, window.location.origin);
  document.addEventListener("DOMContentLoaded", load);
}());
