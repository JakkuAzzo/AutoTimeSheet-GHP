(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("timesheet-history-status");
  var historyLink = document.getElementById("timesheet-history-link");
  var list = document.getElementById("timesheet-history-list");
  var filterControl = document.getElementById("portal-history-filter");
  var refreshButton = document.getElementById("timesheet-history-refresh");
  var frame = document.getElementById("portal-history-frame");
  var lastRecords = [];
  var requestInFlight = false;

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

  function currentFilter() {
    return filterControl && filterControl.value ? filterControl.value : "all";
  }

  function setBusy(isBusy) {
    if (!refreshButton) return;
    refreshButton.disabled = isBusy;
    refreshButton.textContent = isBusy ? "Refreshing…" : "Refresh";
  }

  function send(type, extra) {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(Object.assign({ type: type }, extra || {}), window.location.origin);
  }

  function sendCurrentFilter() {
    send("gmt:history-filter", { filter: currentFilter() });
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
      source_record_id: record.source_record_id || record.sourceRecordId || ""
    };
  }

  function readRecords(body) {
    if (!body || typeof body !== "object" || !Array.isArray(body.records)) return null;
    return body.records.map(projectedRecord).filter(Boolean);
  }

  function showEmpty(message) {
    if (list) list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + "</p>";
  }

  function editHref(record) {
    var sourceId = String(record && (record.source_record_id || record.sourceRecordId) || "").trim();
    var recordStatus = String(record && record.status || "").toLowerCase();
    var action = String(record && (record.action || record.category || "") || "").toLowerCase();
    if (!sourceId || recordStatus === "recorded" || action.indexOf("clock") !== -1) return "";
    return "../timesheets/create.html?edit=" + encodeURIComponent(sourceId);
  }

  function render(records) {
    if (!list) return;
    if (!records.length) {
      showEmpty("No completed timesheets were found for this account.");
      return;
    }
    list.innerHTML = records.map(function (record) {
      var statusClass = String(record.status || "Submitted").toLowerCase().replace(/\s+/g, "-");
      var action = String(record.action || "Timesheet").replace(/_/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
      var date = record.record_date || "";
      var period = date ? "Date " + date : "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
      var edit = editHref(record);
      return '<article class="portal-item"><strong>' + safe(record.employee_name || "Timesheet") + '</strong>' +
        '<span class="portal-status ' + safe(statusClass) + '">' + safe(record.status || "Submitted") + '</span>' +
        '<p class="portal-item-meta">' + safe(action) + ' · ' + safe(period) + '</p>' +
        '<p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || "not recorded") + '</p>' +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') +
        (edit ? '<div class="portal-item-actions"><a class="button button-link" href="' + safe(edit) + '">Edit submission</a></div>' : '') +
        '</article>';
    }).join("");
  }

  function showSetupState() {
    if (status) status.textContent = "Your completed timesheets will appear here when the protected Microsoft 365 history connection is enabled.";
    if (historyLink && config.timesheetHistoryAppUrl) {
      historyLink.hidden = false;
      historyLink.innerHTML = '<a class="portal-text-link" href="' + safe(config.timesheetHistoryAppUrl) + '" target="_blank" rel="noopener">Open protected timesheet records <span aria-hidden="true">→</span></a>';
    }
    showEmpty("History is securely unavailable until the protected connection is enabled.");
  }

  function diagnosticSuffix(error) {
    if (!/[?&]debug=1(?:&|$)/.test(window.location.search || "")) return "";
    return " [diagnostic: " + safe(error && (error.errorCode || error.message || error.name) || "unknown") + "]";
  }

  async function loadDirect() {
    if (requestInFlight) return;
    var endpoint = String(config.portalHistoryEndpoint || config.portalApiEndpoint || config.timesheetHistoryEndpoint || "").trim();
    if (!endpoint) {
      showSetupState();
      return;
    }
    requestInFlight = true;
    setBusy(true);
    if (status) status.textContent = "Loading your completed timesheets…";
    try {
      var headers = { Accept: "application/json" };
      var scopes = normaliseScopes(config.portalHistoryScopes || config.portalApiScopes || config.timesheetHistoryScopes);
      var auth = window.GMT_PORTAL_AUTH || {};
      if (scopes.length) {
        if (typeof auth.acquireToken !== "function" && window.GMT_PORTAL_AUTH_READY) auth = await window.GMT_PORTAL_AUTH_READY;
        if (!auth || typeof auth.acquireToken !== "function") throw new Error("Sign-in context unavailable");
        var accessToken = await auth.acquireToken(scopes);
        if (!accessToken) throw new Error("History access token unavailable");
        headers.Authorization = "Bearer " + accessToken;
      }
      var response = await fetch(endpoint, { credentials: "include", cache: "no-store", headers: headers });
      if (response.status === 401) throw new Error("Your GMT sign-in has expired");
      if (response.status === 403) throw new Error("Your GMT account is not authorised to view these records");
      if (!response.ok) throw new Error("History request failed");
      var body = await response.json();
      var records = readRecords(body);
      if (!records) throw new Error("History response was not valid");
      lastRecords = records;
      render(records);
      if (status) status.textContent = records.length
        ? "Showing " + records.length + " completed timesheet" + (records.length === 1 ? "" : "s") + " authorised for your signed-in GMT identity."
        : "No completed timesheets were found for this account.";
    } catch (error) {
      if (status) status.textContent = error && error.message === "Your GMT sign-in has expired"
        ? "Your GMT sign-in has expired. Sign in again and refresh this page."
        : error && error.message === "Your GMT account is not authorised to view these records"
          ? "Your GMT account is not authorised to view these records. Contact Accounts if this is unexpected."
          : "Your completed timesheets could not be loaded. Please try again or contact Accounts." + diagnosticSuffix(error);
      if (!lastRecords.length) showEmpty("No records are displayed until the protected history service responds." + diagnosticSuffix(error));
    } finally {
      requestInFlight = false;
      setBusy(false);
    }
  }

  function refresh() {
    if (frame) {
      setBusy(true);
      if (status) status.textContent = "Refreshing your submissions…";
      send("gmt:history-refresh");
      return;
    }
    return loadDirect();
  }

  if (filterControl) filterControl.addEventListener("change", sendCurrentFilter);
  if (refreshButton) refreshButton.addEventListener("click", refresh);
  if (frame) frame.addEventListener("load", sendCurrentFilter);
  if (typeof window.addEventListener === "function") {
    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "gmt:history-ready") {
        setBusy(false);
        sendCurrentFilter();
      } else if (event.data.type === "gmt:history-status") {
        setBusy(false);
        if (status && event.data.message) status.textContent = String(event.data.message);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (frame) sendCurrentFilter();
    else return loadDirect();
  });
}());
