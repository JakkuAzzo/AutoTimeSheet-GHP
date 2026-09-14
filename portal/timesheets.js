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
  var historyPreview = document.getElementById("timesheet-history-preview");
  var calendarTitle = document.getElementById("timesheet-calendar-title");
  var calendarPrevious = document.getElementById("timesheet-calendar-previous");
  var calendarNext = document.getElementById("timesheet-calendar-next");
  var viewDate = new Date();
  var lastRecords = [];
  var lastMeta = {};
  var lastCompletion = null;
  var selectedHistory = -1;
  var requestInFlight = false;
  var previewRequest = 0;

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
    render(lastRecords);
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
    if (list && (!calendarTitle || !list.classList || typeof list.classList.contains !== 'function' || !list.classList.contains('timesheet-calendar-grid'))) list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + '</p>';
    if (historyPreview) historyPreview.innerHTML = '<p class="small-text">' + safe(message) + '</p>';
  }

  function actionKey(record) {
    var value = String(record && (record.kind || record.action || record.category || record.record_type || 'timesheet')).toLowerCase();
    if (value.indexOf('clock') !== -1 || value.indexOf('break') !== -1 || value.indexOf('absence') !== -1) return 'clock';
    if (value.indexOf('job') !== -1) return 'job-cards';
    if (value.indexOf('estimate') !== -1 || value.indexOf('quote') !== -1) return 'estimates';
    if (value.indexOf('calendar') !== -1 || value.indexOf('event') !== -1 || value.indexOf('leave') !== -1) return 'calendar';
    if (value.indexOf('task') !== -1 || value.indexOf('request') !== -1) return 'tasks';
    return 'timesheets';
  }

  function actionLabel(record) {
    return String(record && (record.action || record.kind || 'Timesheet')).replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function periodLabel(record) {
    var date = record && record.record_date || '';
    return date ? 'Date ' + date : 'Week ' + ((record && record.start_date) || 'not dated') + ' to ' + ((record && record.end_date) || 'not dated');
  }

  function currentPayMonth() {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === 'year'; });
    var month = parts.find(function (part) { return part.type === 'month'; });
    return (year && year.value ? year.value : '') + '-' + (month && month.value ? month.value : '');
  }

  function recordPayMonth(record) {
    return String(record && (record.start_date || record.record_date || record.end_date) || '').slice(0, 7);
  }

  function renderTimesheetPreview(record) {
    if (!historyPreview) return;
    if (!record) {
      historyPreview.innerHTML = '<p class="small-text">Select a timesheet to preview it.</p>';
      return;
    }
    var key = actionKey(record);
    var statusValue = String(record.status || 'Submitted');
    var statusClass = statusValue.toLowerCase().replace(/\s+/g, '-');
    var editable = record.can_edit === true && key === 'timesheets' && recordPayMonth(record) === currentPayMonth() && !!record.source_record_id;
    var sourceLabel = record.source === 'portal-d1' ? 'Protected GMT portal' : (record.source || 'Microsoft 365 history');
    var payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var rowTable = rows.length ? '<div class="table-scroll"><table class="timesheet-paper-rows"><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Break</th><th>Absence</th><th>Notes</th></tr></thead><tbody>' + rows.map(function (row) {
      return '<tr><td>' + safe(row.date || '') + '</td><td>' + safe(row.start || '') + '</td><td>' + safe(row.finish || '') + '</td><td>' + safe(row.lunchMinutes || 0) + ' min</td><td>' + safe(row.absenceStatus || 'None') + '</td><td>' + safe(row.description || row.note || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="small-text">The protected history response includes submission metadata. Spreadsheet rows are available when the record detail is returned.</p>';
    historyPreview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(record.employee_name || 'Timesheet') + '</h2></div><span class="portal-status ' + safe(statusClass) + '">' + safe(statusValue) + '</span></div>' +
      '<div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(actionLabel(record)) + '</p><p><strong>Period:</strong> ' + safe(periodLabel(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.submitted_at || 'Not recorded') + '</p><p><strong>Updated:</strong> ' + safe(record.updated_at || record.submitted_at || 'Not recorded') + '</p><p><strong>Source:</strong> ' + safe(sourceLabel) + '</p><p><strong>Pay month:</strong> ' + safe(recordPayMonth(record) || 'Not dated') + '</p></div>' +
      '<p class="small-text">Viewable at any time; editing is limited to the current pay month.</p>' +
      (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') + rowTable +
      (editable ? '<div class="portal-item-actions"><a class="button button-link" href="history-frame.html?edit=' + encodeURIComponent(record.source_record_id) + '">Edit spreadsheet</a></div>' : '<p class="small-text">This submission is view-only because it is outside the current pay month or has no editable portal record.</p>');
  }

  function dateOnly(value) {
    var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(value) {
    var date = value instanceof Date ? value : dateOnly(value);
    if (!date) return '';
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function dateRange(start, end) {
    var from = dateOnly(start);
    var to = dateOnly(end || start);
    if (!from || !to) return [];
    if (to < from) { var swap = from; from = to; to = swap; }
    var days = [];
    for (var date = new Date(from); date <= to && days.length < 62; date.setUTCDate(date.getUTCDate() + 1)) days.push(dateKey(date));
    return days;
  }

  function recordDateKeys(record) {
    if (!record) return [];
    var start = record.start_date || record.startDate;
    var end = record.end_date || record.endDate;
    if (start || end) {
      var range = dateRange(start || end, end || start);
      if (range.length) return range;
    }
    var single = record.record_date || record.date || record.event_date || record.eventDate;
    return single ? [dateKey(single)].filter(Boolean) : [];
  }

  function completionMissingLabels() {
    var labels = {};
    if (!(currentFilter() === 'all' || currentFilter() === 'timesheets') || !lastCompletion) return labels;
    (lastCompletion.employees || []).forEach(function (employee) {
      var selectedEmployee = currentEmployee().toLowerCase();
      var employeeValue = String(employee.employee_upn || employee.employee_name || '');
      if (selectedEmployee && employeeValue.toLowerCase() !== selectedEmployee && String(employee.employee_name || '').toLowerCase() !== selectedEmployee) return;
      (employee.missing || []).forEach(function (reason) {
        var match = String(reason || '').match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
        var keys = match ? dateRange(match[1], match[2]) : [currentPayMonth() + '-01'];
        keys.forEach(function (key) {
          if (!labels[key]) labels[key] = [];
          labels[key].push({ missing: true, label: 'Missing · ' + (employee.employee_name || employee.employee_upn || 'Employee'), detail: reason });
        });
      });
    });
    return labels;
  }

  function renderFallbackList(visible) {
    if (!list) return;
    list.innerHTML = visible.map(function (record, index) {
      var action = actionLabel(record);
      var statusValue = String(record.status || 'Submitted');
      var statusClass = statusValue.toLowerCase().replace(/\s+/g, '-');
      return '<button type="button" class="estimate-history-item" data-history-index="' + index + '" aria-current="' + String(index === selectedHistory) + '"><strong>' + safe(record.employee_name || 'Timesheet') + '</strong><span>' + safe(action) + '</span><small>' + safe(periodLabel(record)) + ' · ' + safe(statusValue) + '</small></button>';
    }).join('');
    if (typeof list.querySelectorAll === 'function') list.querySelectorAll('[data-history-index]').forEach(function (button) { button.addEventListener('click', function () { selectHistory(Number(button.getAttribute('data-history-index'))); }); });
  }

  function renderCalendar(visible) {
    if (!list || !calendarTitle || !list.classList || typeof list.classList.contains !== 'function' || !list.classList.contains('timesheet-calendar-grid')) {
      renderFallbackList(visible);
      return;
    }
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    calendarTitle.textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(viewDate);
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var days = new Date(year, month + 1, 0).getDate();
    var byDate = {};
    visible.forEach(function (record, index) {
      recordDateKeys(record).forEach(function (key) {
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push({ record: record, index: index });
      });
    });
    var missing = completionMissingLabels();
    var html = '';
    for (var blank = 0; blank < offset; blank += 1) html += '<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>';
    var today = dateKey(new Date());
    for (var day = 1; day <= days; day += 1) {
      var key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var entries = byDate[key] || [];
      var labels = entries.map(function (entry) {
        var record = entry.record;
        var employee = record.employee_name || record.employee_upn || 'My submission';
        var description = employee + ' · ' + actionLabel(record) + ' · ' + periodLabel(record);
        return '<button type="button" class="timesheet-calendar-label submitted" data-history-index="' + entry.index + '" aria-current="' + String(entry.index === selectedHistory) + '" aria-label="' + safe(description) + '" title="' + safe(description) + '"><strong>' + safe(employee) + '</strong><small>' + safe(actionLabel(record)) + '</small></button>';
      }).join('');
      labels += (missing[key] || []).map(function (entry) {
        return '<span class="timesheet-calendar-label missing" title="' + safe(entry.detail || entry.label) + '">' + safe(entry.label) + '</span>';
      }).join('');
      html += '<article class="calendar-day' + (key === today ? ' calendar-day-today' : '') + '"><time datetime="' + key + '">' + day + '</time>' + (labels || '<span class="timesheet-calendar-no-entry">No entry</span>') + '</article>';
    }
    list.innerHTML = html;
    if (typeof list.querySelectorAll === 'function') list.querySelectorAll('[data-history-index]').forEach(function (button) { button.addEventListener('click', function () { selectHistory(Number(button.getAttribute('data-history-index'))); }); });
  }

  function selectHistory(index) {
    selectedHistory = Number(index);
    if (list && typeof list.querySelectorAll === 'function') list.querySelectorAll('[data-history-index]').forEach(function (button) { button.setAttribute('aria-current', String(Number(button.getAttribute('data-history-index')) === selectedHistory)); });
    var visible = filteredRecords();
    var record = visible[selectedHistory];
    renderTimesheetPreview(record);
    var token = ++previewRequest;
    if (record && record.source === 'portal-d1' && record.source_record_id && window.GMTPortalApi && typeof window.GMTPortalApi.getRecord === 'function') {
      window.GMTPortalApi.getRecord(record.source_record_id).then(function (body) {
        if (token !== previewRequest || !body || !body.payload) return;
        record.payload = body.payload;
        renderTimesheetPreview(record);
      }).catch(function () {});
    }
  }

  function filteredRecords() {
    return (lastRecords || []).filter(function (record) {
      if (currentFilter() === 'all' && ['timesheets', 'clock', 'calendar'].indexOf(actionKey(record)) === -1) return false;
      if (currentFilter() !== 'all' && actionKey(record) !== currentFilter()) return false;
      var selectedEmployee = currentEmployee().toLowerCase();
      if (!selectedEmployee) return true;
      return String(record.employee_upn || '').toLowerCase() === selectedEmployee || String(record.employee_name || '').toLowerCase() === selectedEmployee;
    });
  }

  function render(records) {
    lastRecords = Array.isArray(records) ? records : [];
    var visible = filteredRecords();
    renderCalendar(visible);
    if (!visible.length) {
      if (list && calendarTitle && list.classList && typeof list.classList.contains === 'function' && list.classList.contains('timesheet-calendar-grid')) {
        if (historyPreview) historyPreview.innerHTML = '<p class="small-text">' + safe(lastRecords.length ? 'No submissions match this filter.' : 'No completed timesheets were found for this account.') + '</p>';
        return;
      }
      return showEmpty(lastRecords.length ? 'No submissions match this filter.' : 'No completed timesheets were found for this account.');
    }
    if (selectedHistory < 0 || selectedHistory >= visible.length) selectedHistory = 0;
    selectHistory(selectedHistory);
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
  if (calendarPrevious) calendarPrevious.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(filteredRecords()); });
  if (calendarNext) calendarNext.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(filteredRecords()); });
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
        render(lastRecords);
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
