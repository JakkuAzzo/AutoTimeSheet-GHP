(function () {
  "use strict";
  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("timesheet-history-status");
  var historyLink = document.getElementById("timesheet-history-link");
  var list = document.getElementById("timesheet-history-list");
  var refreshButton = document.getElementById("timesheet-history-refresh");
  var lastRecords = [];
  var requestInFlight = false;

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char];
    });
  }

  function normaliseScopes(value) {
    if (Array.isArray(value)) return value.map(function (scope) { return String(scope || "").trim(); }).filter(Boolean);
    if (typeof value === "string") return value.split(/\s+/).map(function (scope) { return scope.trim(); }).filter(Boolean);
    return [];
  }

  function projectedRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    return {
      employee_name: record.employee_name || record.employeeName || "",
      start_date: record.start_date || record.weekStart || "",
      end_date: record.end_date || record.weekEnd || "",
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

  function setBusy(isBusy) {
    requestInFlight = isBusy;
    if (!refreshButton) return;
    refreshButton.disabled = isBusy;
    refreshButton.textContent = isBusy ? "Refreshing…" : "Refresh";
  }

  function showEmpty(message) {
    list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + '</p>';
  }

  function diagnosticSuffix(error) {
    if (!/[?&]debug=1(?:&|$)/.test(window.location.search || "")) return "";
    var detail = error && (error.errorCode || error.message || error.name) || "unknown";
    return " [diagnostic: " + String(detail) + "]";
  }

  function showSetupState() {
    status.textContent = "Your completed timesheets will appear here when the protected Microsoft 365 history connection is enabled.";
    if (config.timesheetHistoryAppUrl) {
      historyLink.hidden = false;
      historyLink.innerHTML = '<a class="portal-text-link" href="' + safe(config.timesheetHistoryAppUrl) + '" target="_blank" rel="noopener">Open protected timesheet records <span aria-hidden="true">→</span></a>';
    }
    showEmpty("History is securely unavailable until the protected connection is enabled.");
  }

  function render(records) {
    if (!records.length) {
      showEmpty("No completed timesheets were found for this account.");
      return;
    }
    list.innerHTML = records.map(function (record) {
      var statusClass = String(record.status || "Submitted").toLowerCase().replace(/\s+/g, "-");
      return '<article class="portal-item"><strong>' + safe(record.employee_name || record.employeeName || "Timesheet") + '</strong>' +
        '<span class="portal-status ' + safe(statusClass) + '">' + safe(record.status || "Submitted") + '</span>' +
        '<p class="portal-item-meta">Week ' + safe(record.start_date || record.weekStart || "not dated") + ' to ' + safe(record.end_date || record.weekEnd || "not dated") + '</p>' +
        '<p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || record.submittedAt || "not recorded") + '</p>' +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') +
        '</article>';
    }).join("");
  }

  async function load() {
    if (requestInFlight) return;
    if (!config.timesheetHistoryEndpoint) {
      showSetupState();
      return;
    }
    setBusy(true);
    status.textContent = "Loading your completed timesheets…";
    try {
      var headers = { Accept: "application/json" };
      var scopes = normaliseScopes(config.timesheetHistoryScopes);
      var auth = window.GMT_PORTAL_AUTH || {};
      if (scopes.length) {
        if (typeof auth.acquireToken !== "function" && window.GMT_PORTAL_AUTH_READY) {
          auth = await window.GMT_PORTAL_AUTH_READY;
        }
        if (typeof auth.acquireToken !== "function") throw new Error("Sign-in context unavailable");
        var accessToken = await auth.acquireToken(scopes);
        if (!accessToken) throw new Error("History access token unavailable");
        headers.Authorization = "Bearer " + accessToken;
      }
      var response = await fetch(config.timesheetHistoryEndpoint, {
        credentials: "include",
        cache: "no-store",
        headers: headers
      });
      if (response.status === 401) throw new Error("Your GMT sign-in has expired");
      if (response.status === 403) throw new Error("Your GMT account is not authorised to view these records");
      if (!response.ok) throw new Error("History request failed");
      var body = await response.json();
      var records = readRecords(body);
      if (!records) throw new Error("History response was not valid");
      lastRecords = records;
      render(records);
      status.textContent = records.length
        ? "Showing " + records.length + " completed timesheet" + (records.length === 1 ? "" : "s") + " authorised for your signed-in GMT identity."
        : "No completed timesheets were found for this account.";
    } catch (error) {
      status.textContent = error && error.message === "Your GMT sign-in has expired"
        ? "Your GMT sign-in has expired. Sign in again and refresh this page."
        : error && error.message === "Your GMT account is not authorised to view these records"
          ? "Your GMT account is not authorised to view these records. Contact Accounts if this is unexpected."
          : "Your completed timesheets could not be loaded. Please try again or contact Accounts." + diagnosticSuffix(error);
      if (!lastRecords.length) showEmpty("No records are displayed until the protected history service responds." + diagnosticSuffix(error));
    } finally {
      setBusy(false);
    }
  }

  if (refreshButton) refreshButton.addEventListener("click", load);
  document.addEventListener("DOMContentLoaded", load);
}());
