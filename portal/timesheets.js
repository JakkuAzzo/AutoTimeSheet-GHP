(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("timesheet-history-status");
  var historyLink = document.getElementById("timesheet-history-link");
  var scope = document.getElementById("timesheet-history-scope");
  var list = document.getElementById("timesheet-history-list");
  var filterControl = document.getElementById("portal-history-filter");
  var employeeFilterWrap = document.getElementById("portal-history-employee-filter");
  var employeeControl = document.getElementById("portal-history-employee");
  var completionSection = document.getElementById("timesheet-completion");
  var completionStatus = document.getElementById("timesheet-completion-status");
  var completionTable = document.getElementById("timesheet-completion-table");
  var completionNote = document.getElementById("timesheet-completion-note");
  var editPolicy = document.getElementById("timesheet-history-edit-policy");
  var refreshButton = document.getElementById("timesheet-history-refresh");
  var frame = document.getElementById("portal-history-frame");
  var lastRecords = [];
  var lastMeta = {};
  var lastCompletion = null;
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

  function currentEmployee() {
    return employeeControl && employeeControl.value ? employeeControl.value : "";
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
    send("gmt:history-filter", { filter: currentFilter(), employee: currentEmployee() });
  }

  function updateMeta(meta) {
    lastMeta = meta || {};
    lastCompletion = lastMeta.completion || null;
    var isAdmin = meta && meta.is_admin === true;
    if (scope) {
      scope.hidden = false;
      scope.textContent = isAdmin ? "Accounts admin view: all employee submissions are visible." : "Showing this account's authorised submissions only.";
    }
    if (editPolicy) editPolicy.textContent = isAdmin
      ? "All employee timesheets are viewable; editing is limited to records made within the current pay month."
      : "All timesheets made by this user may be viewed, but only timesheets made within the current pay month may be edited.";
    if (employeeFilterWrap) employeeFilterWrap.hidden = !isAdmin;
    if (employeeControl && isAdmin) {
      populateEmployees(meta.completion && meta.completion.employees || []);
    }
    if (completionSection) completionSection.hidden = !isAdmin;
    if (isAdmin) {
      renderCompletion(meta.completion || null, meta);
    }
  }

  function populateEmployees(employees) {
    if (!employeeControl) return;
    var selected = currentEmployee();
    var options = ['<option value="">All employees</option>'];
    (employees || []).forEach(function (employee) {
      var value = String(employee.employee_upn || employee.employee_name || "");
      var label = String(employee.employee_name || employee.employee_upn || "Unnamed employee");
      if (!value) return;
      options.push('<option value="' + safe(value) + '">' + safe(label) + '</option>');
    });
    employeeControl.innerHTML = options.join("");
    employeeControl.value = selected;
  }

  function renderCompletion(completion, meta) {
    if (!completionSection || !completionTable || !completionStatus) return;
    if (!completion) {
      completionStatus.textContent = "Completion status is unavailable until the protected history service returns the Accounts view.";
      completionTable.innerHTML = "";
      if (completionNote) completionNote.textContent = "";
      return;
    }
    var counts = completion.counts || {};
    completionStatus.textContent = "Pay month " + safe(completion.pay_month || "current") + " · " + Number(counts.completed || 0) + " completed · " + Number(counts.incomplete || 0) + " incomplete · " + Number(counts.missing || 0) + " missing.";
    var upstream = String(meta && meta.upstream || "not-configured");
    var sourceMessage = upstream === "ok"
      ? "Microsoft 365 history is included in this Accounts view."
      : upstream === "flow-permission-not-configured"
        ? "Portal history is loaded, but the Microsoft 365 history source is not connected for this signed-in session. Grant the protected Flow Service permission to include older filed submissions."
        : "Portal history is loaded; Microsoft 365 history source status: " + upstream + ".";
    var syntheticMessage = Number(meta && meta.synthetic_record_count || 0) ? " Synthetic test rows are excluded from completion counts and the default Accounts list." : "";
    if (completionNote) completionNote.textContent = sourceMessage + (completion.directory_configured ? " The employee roster is configured." : " The employee roster is not configured, so missing rows are limited to employees present in the returned history.") + syntheticMessage;
    var selectedEmployee = currentEmployee().toLowerCase();
    var employees = (completion.employees || []).filter(function (employee) {
      if (!selectedEmployee) return true;
      return String(employee.employee_upn || "").toLowerCase() === selectedEmployee || String(employee.employee_name || "").toLowerCase() === selectedEmployee;
    });
    if (!employees.length) {
      completionTable.innerHTML = '<tbody><tr><td colspan="4">No employee rows were returned.</td></tr></tbody>';
      return;
    }
    completionTable.innerHTML = '<thead><tr><th>Employee</th><th>Status</th><th>Completed weeks</th><th>Missing / needs attention</th></tr></thead><tbody>' + employees.map(function (employee) {
      var statusValue = String(employee.status || "missing");
      var statusLabel = statusValue === "completed" ? "Completed" : statusValue === "incomplete" ? "Incomplete" : "Missing";
      var completed = (employee.completed_weeks || []).join(", ") || "None";
      var missing = (employee.missing || []).join("; ") || "None";
      return '<tr><td><strong>' + safe(employee.employee_name || employee.employee_upn || "Unnamed employee") + '</strong><br><span class="small-text">' + safe(employee.employee_upn || "") + '</span></td><td><span class="portal-status ' + safe(statusValue) + '">' + safe(statusLabel) + '</span></td><td>' + safe(completed) + '</td><td>' + safe(missing) + '</td></tr>';
    }).join("") + '</tbody>';
  }

  function showEmpty(message) {
    if (list) list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + '</p>';
  }

  function render(records) {
    if (!list) return;
    if (!records.length) return showEmpty('No completed timesheets were found for this account.');
    list.innerHTML = records.map(function (record) {
      var action = String(record.action || 'Timesheet').replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
      var date = record.record_date || '';
      var period = date ? 'Date ' + date : 'Week ' + (record.start_date || 'not dated') + ' to ' + (record.end_date || 'not dated');
      return '<article class="portal-item"><strong>' + safe(record.employee_name || 'Timesheet') + '</strong><span class="portal-status">' + safe(record.status || 'Submitted') + '</span><p class="portal-item-meta">' + safe(action) + ' · ' + safe(period) + '</p><p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || 'not recorded') + '</p>' + (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') + '</article>';
    }).join('');
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
    var endpoint = String(config.portalHistoryEndpoint || config.portalApiEndpoint || config.timesheetHistoryEndpoint || '').trim();
    if (!endpoint) {
      showSetupState();
      return;
    }
    requestInFlight = true;
    setBusy(true);
    if (status) status.textContent = 'Loading your completed timesheets…';
    try {
      var headers = { Accept: 'application/json' };
      var scopes = normaliseScopes(config.portalHistoryScopes || config.portalApiScopes || config.timesheetHistoryScopes);
      var auth = window.GMT_PORTAL_AUTH || {};
      if (scopes.length) {
        if (typeof auth.acquireToken !== 'function' && window.GMT_PORTAL_AUTH_READY) auth = await window.GMT_PORTAL_AUTH_READY;
        if (!auth || typeof auth.acquireToken !== 'function') throw new Error('Sign-in context unavailable');
        var token = await auth.acquireToken(scopes);
        if (!token) throw new Error('History access token unavailable');
        headers.Authorization = 'Bearer ' + token;
      }
      var upstreamScopes = normaliseScopes(config.timesheetHistoryScopes);
      if (upstreamScopes.length && auth && typeof auth.acquireToken === 'function') {
        var upstreamToken = await auth.acquireToken(upstreamScopes, { optional: true });
        if (upstreamToken) headers['X-GMT-Upstream-Authorization'] = 'Bearer ' + upstreamToken;
      }
      var response = await fetch(endpoint, { credentials: 'include', cache: 'no-store', headers: headers });
      if (response.status === 401) throw new Error('Your GMT sign-in has expired');
      if (response.status === 403) throw new Error('Your GMT account is not authorised to view these records');
      if (!response.ok) throw new Error('History request failed');
      var body = await response.json();
      var records = body && Array.isArray(body.records) ? body.records : null;
      if (!records) throw new Error('History response was not valid');
      lastRecords = records;
      updateMeta(body.meta || {});
      renderCompletion(body.meta && body.meta.completion || null, body.meta || {});
      render(records);
      status.textContent = records.length ? 'Showing ' + records.length + ' completed timesheet' + (records.length === 1 ? '' : 's') + ' authorised for your signed-in GMT identity.' : 'No completed timesheets were found for this account.';
    } catch (error) {
      status.textContent = error && error.message ? error.message : 'Your completed timesheets could not be loaded. Please try again or contact Accounts.' + diagnosticSuffix(error);
      if (!lastRecords.length) showEmpty('No records are displayed until the protected history service responds.' + diagnosticSuffix(error));
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
    } else return loadDirect();
  }

  if (filterControl) filterControl.addEventListener("change", sendCurrentFilter);
  if (employeeControl) employeeControl.addEventListener("change", function () {
    sendCurrentFilter();
    if (lastMeta.is_admin === true) renderCompletion(lastCompletion, lastMeta);
  });
  if (refreshButton) refreshButton.addEventListener("click", refresh);
  if (frame) frame.addEventListener("load", sendCurrentFilter);
  if (typeof window.addEventListener === "function") {
    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "gmt:history-ready") {
        setBusy(false);
        sendCurrentFilter();
      } else if (event.data.type === "gmt:history-meta") {
        updateMeta(event.data.meta || {});
      } else if (event.data.type === "gmt:history-records") {
        lastRecords = Array.isArray(event.data.records) ? event.data.records : [];
        updateMeta(event.data.meta || {});
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
