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
  var calendarPicker = document.getElementById("timesheet-calendar-picker");
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
    if (historyLink) {
      historyLink.hidden = true;
      if (isAdmin && String(meta && meta.upstream || "") === "flow-permission-not-configured") {
        historyLink.hidden = false;
        historyLink.innerHTML = '<a class="portal-text-link" href="timesheets.html?connect-history=1">Connect Microsoft 365 history access <span aria-hidden="true">→</span></a>';
      }
    }
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
    var sourceCount = Number(meta && meta.upstream_source_row_count || 0);
    var normalizedCount = Number(meta && meta.upstream_normalized_record_count || 0);
    var matchedCount = Number(meta && meta.upstream_employee_matched_record_count || 0);
    if (upstream === "ok" && Object.prototype.hasOwnProperty.call(meta || {}, "upstream_source_row_count")) {
      sourceMessage += " Source rows: " + sourceCount + "; recognised: " + normalizedCount + "; matched: " + matchedCount + ".";
    }
    var syntheticMessage = Number(meta && meta.synthetic_record_count || 0) ? " Synthetic test rows are excluded from completion counts and the default Accounts list." : "";
    if (completionNote) completionNote.textContent = sourceMessage + (completion.directory_configured ? " The employee roster is configured." : " The employee roster is not configured, so missing rows are limited to employees present in the returned history.") + syntheticMessage;
    var selectedEmployee = currentEmployee().toLowerCase();
    var employees = (completion.employees || []).filter(function (employee) {
      if (!selectedEmployee) return true;
      return String(employee.employee_upn || "").toLowerCase() === selectedEmployee || String(employee.employee_name || "").toLowerCase() === selectedEmployee;
    });
    if (!employees.length) {
      completionTable.innerHTML = '<tbody><tr><td colspan="8">No employee rows were returned.</td></tr></tbody>';
      return;
    }
    completionTable.innerHTML = '<thead><tr><th>Employee</th><th>Status</th><th>Submitted records</th><th>Daily entries</th><th>Recorded hours</th><th>Completed weeks</th><th>Absence / requests</th><th>Missing / needs attention</th></tr></thead><tbody>' + employees.map(function (employee) {
      var statusValue = String(employee.status || "missing");
      var statusLabel = statusValue === "completed" ? "Completed" : statusValue === "incomplete" ? "Incomplete" : "Missing";
      var submitted = Number(employee.submitted_records || 0);
      var completed = (employee.completed_weeks || []).join(", ") || "None";
      var metrics = employeeMetrics(employee);
      var missingItems = (employee.missing || []).slice();
      if (metrics.flags) missingItems.push(metrics.flags + ' daily review flag' + (metrics.flags === 1 ? '' : 's'));
      var missing = missingItems.join("; ") || "None";
      var daySummary = metrics.daySummary.join(" · ") || "None";
      var hoursLabel = metrics.rows.length ? formatHours(metrics.hours) : "Not available";
      var absenceRequests = metrics.absences.concat(metrics.requests || []).filter(function (value, index, values) { return value && values.indexOf(value) === index; });
      var absenceLabel = absenceRequests.join("; ") || "None";
      return '<tr><td data-label="Employee"><strong>' + safe(employee.employee_name || employee.employee_upn || "Unnamed employee") + '</strong><br><span class="small-text">' + safe(employee.employee_upn || "") + '</span></td><td data-label="Status"><span class="portal-status ' + safe(statusValue) + '">' + safe(statusLabel) + '</span></td><td data-label="Submitted records">' + safe(submitted) + '</td><td data-label="Daily entries">' + safe(metrics.dailyEntries) + '</td><td data-label="Recorded hours"><strong>' + safe(hoursLabel) + '</strong><br><span class="small-text">' + safe(daySummary) + '</span></td><td data-label="Completed weeks">' + safe(completed) + '</td><td data-label="Absence / requests">' + safe(absenceLabel) + '</td><td data-label="Missing / needs attention">' + safe(missing) + '</td></tr>';
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
    var kind = actionKey(record);
    var start = record && (record.start_date || record.startDate) || '';
    var end = record && (record.end_date || record.endDate) || '';
    if (kind === 'timesheets' && (start || end)) return 'Week ' + (start || 'not dated') + ' to ' + (end || 'not dated');
    var date = record && (record.record_date || record.date) || '';
    return date ? 'Date ' + date : 'Week ' + (start || 'not dated') + ' to ' + (end || 'not dated');
  }

  function currentPayMonth() {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === 'year'; });
    var month = parts.find(function (part) { return part.type === 'month'; });
    return (year && year.value ? year.value : '') + '-' + (month && month.value ? month.value : '');
  }

  function recordPayMonth(record) {
    // Pay months follow the week-ending date so a Monday week that starts in
    // the previous calendar month (for example 31 Aug–6 Sep) is included in
    // the September payroll window.
    return String(record && (record.end_date || record.start_date || record.record_date) || '').slice(0, 7);
  }

  function objectValue(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    var actualKeys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var wanted = String(keys[i]).toLowerCase();
      var actual = actualKeys.find(function (key) { return key.toLowerCase() === wanted; });
      if (actual) return value[actual];
    }
    return '';
  }

  function parseJsonValue(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !/^[\[{]/.test(value.trim())) return null;
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function payloadForRecord(record) {
    if (!record) return {};
    var payload = parseJsonValue(record.payload);
    if (payload && typeof payload === 'object') return payload;
    payload = parseJsonValue(record.payload_json || record.payloadJson);
    if (payload && typeof payload === 'object') return payload;
    return {};
  }

  function rawTimesheetRows(record) {
    if (!record) return [];
    var payload = payloadForRecord(record);
    var candidates = [
      Array.isArray(payload) ? payload : null,
      payload.rows, payload.daily_rows, payload.dailyRows, payload.records, payload.row,
      record.rows, record.daily_rows, record.dailyRows
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = parseJsonValue(candidates[i]);
      if (Array.isArray(candidate)) return candidate.filter(function (row) { return row && typeof row === 'object'; }).slice(0, 80);
      if (candidate && typeof candidate === 'object' && (objectValue(candidate, ['date', 'record_date', 'recordDate', 'workDate', 'Date']) || objectValue(candidate, ['action', 'clockAction', 'clock_action', 'time', 'start', 'startTime', 'finish', 'finishTime', 'Start', 'Finish']))) return [candidate];
    }
    var directDate = objectValue(record, ['date', 'record_date', 'recordDate', 'workDate']);
    var directTime = objectValue(record, ['start', 'startTime', 'start_time', 'clockIn', 'clock_in', 'finish', 'finishTime', 'finish_time', 'clockOut', 'clock_out']);
    if (directDate && directTime) return [record];
    return [];
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || value === '') return null;
    if (/^(true|yes|y|1|taken|added)$/i.test(String(value).trim())) return true;
    if (/^(false|no|no\s*break|n|0|none|not[- ]?taken|na)$/i.test(String(value).trim())) return false;
    return null;
  }

  function breakMinutesValue(value) {
    var numeric = numberValue(value);
    if (numeric !== null) return numeric;
    if (value === null || value === undefined || value === '') return null;
    var raw = String(value).trim().toLowerCase();
    if (/^(?:no\s*break|none|not[- ]?taken|no)$/.test(raw)) return 0;
    var hours = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    var minutes = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
    if (hours || minutes) return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
    return null;
  }

  function breakMinutesFromNote(value) {
    var raw = String(value || '');
    var match = raw.match(/\bbreak\s*:\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
    if (!match) return null;
    var amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    return /hours?|hrs?|h/i.test(match[2]) ? amount * 60 : amount;
  }

  function timeMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value >= 0 && value <= 1) return Math.round(value * 1440);
      if (value >= 0 && value < 1440) return Math.round(value);
    }
    var raw = value instanceof Date ? value.toISOString() : String(value).trim().toLowerCase();
    // Some clock records carry an ISO timestamp instead of the time entered
    // in the form. Use the explicit clock portion so it remains stable when
    // the record is viewed in another timezone.
    var isoMatch = raw.match(/(?:t|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/i);
    if (isoMatch) {
      var isoHour = Number(isoMatch[1]);
      var isoMinute = Number(isoMatch[2]);
      return isoHour >= 0 && isoHour <= 23 && isoMinute <= 59 ? isoHour * 60 + isoMinute : null;
    }
    var match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2] || 0);
    if (minute > 59) return null;
    if (match[3]) {
      if (hour < 1 || hour > 12) return null;
      if (match[3].toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (match[3].toLowerCase() === 'am' && hour === 12) hour = 0;
    }
    return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
  }

  function formatHours(value) {
    var number = numberValue(value);
    if (number === null) return 'Not recorded';
    var rounded = Math.round(number * 10) / 10;
    return String(rounded).replace(/\.0$/, '') + 'h';
  }

  function formatMinutes(value) {
    var minutes = numberValue(value);
    if (minutes === null) return 'Not recorded';
    minutes = Math.max(0, Math.round(minutes));
    var hours = Math.floor(minutes / 60);
    var remainder = minutes % 60;
    if (!hours) return remainder + 'm';
    if (!remainder) return hours + 'h';
    return hours + 'h ' + String(remainder).padStart(2, '0') + 'm';
  }

  function normaliseTimesheetRow(row, record) {
    row = row || {};
    var date = String(objectValue(row, ['date', 'record_date', 'recordDate', 'workDate', 'day']) || '').slice(0, 10);
    var start = String(objectValue(row, ['start', 'startTime', 'start_time', 'clockIn', 'clock_in', 'dayStart', 'day_start', 'Start']) || '');
    var finish = String(objectValue(row, ['finish', 'finishTime', 'finish_time', 'clockOut', 'clock_out', 'dayFinish', 'day_finish', 'Finish']) || '');
    var lunchStart = String(objectValue(row, ['lunchStart', 'lunch_start', 'breakStart', 'break_start', 'Lunch start']) || '');
    var lunchEnd = String(objectValue(row, ['lunchEnd', 'lunch_end', 'breakEnd', 'break_end', 'Lunch end']) || '');
    var lunchMinutes = breakMinutesValue(objectValue(row, ['lunchMinutes', 'lunch_minutes', 'breakMinutes', 'break_minutes', 'break', 'Break']));
    var lunchHad = booleanValue(objectValue(row, ['lunchHad', 'lunch_had', 'breakTaken', 'break_taken', 'hadBreak']));
    var absence = String(objectValue(row, ['absenceStatus', 'absence_status', 'absenceReason', 'absence_reason', 'absence', 'Absence reason']) || 'NA');
    var note = String(objectValue(row, ['description', 'note', 'notes', 'Note']) || '');
    var statusValue = String(objectValue(row, ['status', 'Status']) || record && record.status || 'Recorded');
    var workedHours = numberValue(objectValue(row, ['workedHours', 'worked_hours', 'hours', 'totalHours', 'Worked hours']));
    var workedMinutes = numberValue(objectValue(row, ['workedMinutes', 'worked_minutes']));
    if (workedMinutes === null && workedHours !== null) workedMinutes = workedHours * 60;
    var basicHours = numberValue(objectValue(row, ['basicHours', 'basic_hours', 'Basic hours']));
    var ot15Hours = numberValue(objectValue(row, ['ot15Hours', 'ot15_hours', 'overtime15Hours', 'OT x1.5 hours']));
    var ot20Hours = numberValue(objectValue(row, ['ot20Hours', 'ot20_hours', 'overtime20Hours', 'OT x2.0 hours']));
    var explicitBreakStatus = String(objectValue(row, ['breakStatus', 'break_status', 'Break']) || '');
    var absenceIsNone = !absence || /^(na|none|no absence|not applicable|n\/a)$/i.test(absence.trim());
    if (lunchMinutes === null) lunchMinutes = breakMinutesFromNote(note);
    if (/^(?:no\s*break|none|not[- ]?taken|no|0)$/i.test(explicitBreakStatus.trim())) explicitBreakStatus = 'not-taken';
    if (/^(?:yes|taken|added)$/i.test(explicitBreakStatus.trim())) explicitBreakStatus = 'added';
    if (/\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(explicitBreakStatus)) explicitBreakStatus = 'added';
    if (!explicitBreakStatus && lunchHad === false) explicitBreakStatus = 'not-taken';
    if (!explicitBreakStatus && lunchHad === true) explicitBreakStatus = 'added';
    if (!explicitBreakStatus && lunchMinutes !== null && lunchMinutes > 0) explicitBreakStatus = 'added';
    if (!explicitBreakStatus && /break:\s*(?:no break|none|not taken)/i.test(note)) explicitBreakStatus = 'not-taken';
    if (!date) date = String(record && (record.record_date || record.start_date) || '').slice(0, 10);
    var recordId = String(objectValue(row, ['recordId', 'record_id', 'sourceRecordId', 'source_record_id']) || '');
    var submissionId = String(objectValue(row, ['submissionId', 'submission_id']) || '');
    if (!submissionId && recordId && recordId.indexOf('|') !== -1) submissionId = recordId.split('|')[0];
    if (workedMinutes === null && (basicHours !== null || ot15Hours !== null || ot20Hours !== null)) {
      var componentHours = (basicHours || 0) + (ot15Hours || 0) + (ot20Hours || 0);
      if (componentHours > 0) {
        workedMinutes = componentHours * 60;
        workedHours = componentHours;
      }
    }
    return {
      raw: row,
      recordId: recordId,
      submissionId: submissionId,
      date: date,
      start: start,
      finish: finish,
      lunchStart: lunchStart,
      lunchEnd: lunchEnd,
      lunchMinutes: lunchMinutes,
      lunchHad: lunchHad,
      breakStatus: explicitBreakStatus,
      absenceStatus: absenceIsNone ? 'None' : absence,
      status: statusValue,
      workedHours: workedHours,
      workedMinutes: workedMinutes,
      basicHours: basicHours,
      ot15Hours: ot15Hours,
      ot20Hours: ot20Hours,
      weightedHours: numberValue(objectValue(row, ['weightedHours', 'weighted_hours'])),
      note: note,
      absenceIsNone: absenceIsNone,
      issues: []
    };
  }

  function employeeMatches(record, employee) {
    if (!record || !employee) return false;
    var wanted = String(employee).toLowerCase();
    return String(record.employee_upn || '').toLowerCase() === wanted || String(record.employee_name || '').toLowerCase() === wanted;
  }

  function clockEvents() {
    var events = [];
    (lastRecords || []).forEach(function (record) {
      if (actionKey(record) !== 'clock') return;
      var payload = payloadForRecord(record);
      var rows = rawTimesheetRows(record);
      if (!rows.length) rows = [record];
      rows.forEach(function (row) {
        var item = row || {};
        var date = String(objectValue(item, ['date', 'record_date', 'recordDate', 'workDate']) || record.record_date || record.start_date || '').slice(0, 10);
        var action = String(objectValue(item, ['clockAction', 'clock_action', 'action', 'type', 'eventType']) || record.action || '').toLowerCase().replace(/[\s-]+/g, '_');
        var pushEvent = function (eventAction, value) {
          if (!date || value === null || value === undefined || value === '') return;
          events.push({ record: record, row: item, date: date, action: eventAction, time: String(value), minutes: timeMinutes(value), payload: payload });
        };
        var time = objectValue(item, ['time', 'clockTime', 'clock_time', 'at', 'timestamp']);
        if (time) pushEvent(action || 'clock_event', time);
        if (!time && action.indexOf('in') !== -1) pushEvent('clock_in', objectValue(item, ['start', 'startTime', 'start_time', 'dayStart', 'day_start', 'Start']));
        if (!time && action.indexOf('out') !== -1) pushEvent('clock_out', objectValue(item, ['finish', 'finishTime', 'finish_time', 'dayFinish', 'day_finish', 'Finish']));
        if (!time && action.indexOf('lunch_start') !== -1) pushEvent('lunch_start', objectValue(item, ['lunchStart', 'lunch_start', 'breakStart', 'Lunch start']));
        if (!time && action.indexOf('lunch_end') !== -1) pushEvent('lunch_end', objectValue(item, ['lunchEnd', 'lunch_end', 'breakEnd', 'Lunch end']));
        // A full-day clock record contains both sides of the interval in one
        // row. Expose those values as two joinable events for weekly rows.
        if (!time && (action === 'full_day' || action === 'full-day' || action === 'day' || action === 'clock' || action === 'recorded' || (action === 'timesheet' && actionKey(record) === 'clock'))) {
          pushEvent('clock_in', objectValue(item, ['start', 'startTime', 'start_time', 'dayStart', 'day_start', 'Start']));
          pushEvent('clock_out', objectValue(item, ['finish', 'finishTime', 'finish_time', 'dayFinish', 'day_finish', 'Finish']));
          pushEvent('lunch_start', objectValue(item, ['lunchStart', 'lunch_start', 'breakStart', 'Lunch start']));
          pushEvent('lunch_end', objectValue(item, ['lunchEnd', 'lunch_end', 'breakEnd', 'Lunch end']));
        }
      });
    });
    return events;
  }

  function enrichTimesheetRows(record) {
    var rows = rawTimesheetRows(record).map(function (row) { return normaliseTimesheetRow(row, record); });
    var employee = record && (record.employee_upn || record.employee_name || '');
    var events = clockEvents().filter(function (event) { return employeeMatches(event.record, employee) || employeeMatches({ employee_upn: event.row.employeeUpn || event.row.employee_upn, employee_name: event.row.employeeName || event.row.employee_name }, employee); });
    var byDate = {};
    events.forEach(function (event) { if (!byDate[event.date]) byDate[event.date] = []; byDate[event.date].push(event); });
    rows.forEach(function (row) {
      var matching = byDate[row.date] || [];
      var findEvent = function (pattern) { return matching.find(function (event) { return pattern.test(event.action); }); };
      var clockIn = findEvent(/clock_?in|start/);
      var clockOut = findEvent(/clock_?out|finish/);
      var lunchIn = findEvent(/lunch_?start|break_?start/);
      var lunchOut = findEvent(/lunch_?end|break_?end/);
      if (!row.start && clockIn) row.start = clockIn.time;
      if (!row.finish && clockOut) row.finish = clockOut.time;
      if (!row.lunchStart && lunchIn) row.lunchStart = lunchIn.time;
      if (!row.lunchEnd && lunchOut) row.lunchEnd = lunchOut.time;
      if (row.lunchMinutes === null && row.lunchStart && row.lunchEnd && timeMinutes(row.lunchStart) !== null && timeMinutes(row.lunchEnd) !== null) row.lunchMinutes = Math.max(0, timeMinutes(row.lunchEnd) - timeMinutes(row.lunchStart));
      if (!row.breakStatus && row.lunchStart && row.lunchEnd) row.breakStatus = 'added';
      if (!row.breakStatus && row.lunchMinutes !== null && row.lunchMinutes > 0) row.breakStatus = 'added';
      row.clockInSource = clockIn ? clockIn.record.source || 'clock record' : '';
      row.clockOutSource = clockOut ? clockOut.record.source || 'clock record' : '';
    });
    if (!rows.length && events.length) {
      var dates = events.map(function (event) { return event.date; }).filter(function (value, index, values) { return values.indexOf(value) === index; });
      rows = dates.map(function (date) { return normaliseTimesheetRow({ date: date }, record); });
      rows.forEach(function (row) {
        var matching = byDate[row.date] || [];
        var findEvent = function (pattern) { return matching.find(function (event) { return pattern.test(event.action); }); };
        var clockIn = findEvent(/clock_?in|start/);
        var clockOut = findEvent(/clock_?out|finish/);
        var lunchIn = findEvent(/lunch_?start|break_?start/);
        var lunchOut = findEvent(/lunch_?end|break_?end/);
        row.start = clockIn ? clockIn.time : '';
        row.finish = clockOut ? clockOut.time : '';
        row.lunchStart = lunchIn ? lunchIn.time : '';
        row.lunchEnd = lunchOut ? lunchOut.time : '';
        row.lunchMinutes = row.lunchStart && row.lunchEnd ? Math.max(0, timeMinutes(row.lunchEnd) - timeMinutes(row.lunchStart)) : null;
        row.breakStatus = row.lunchStart && row.lunchEnd ? 'added' : '';
      });
    }
    rows.forEach(function (row) {
      var start = timeMinutes(row.start);
      var finish = timeMinutes(row.finish);
      var breakMinutes = row.lunchMinutes === null ? 0 : Math.max(0, row.lunchMinutes);
      if (row.workedMinutes === null && start !== null && finish !== null && finish >= start) {
        row.workedMinutes = finish - start - breakMinutes;
        row.workedHours = row.workedMinutes / 60;
      }
      if (row.absenceIsNone && start === null) row.issues.push('Clock in missing');
      if (row.absenceIsNone && finish === null) row.issues.push('Clock out missing');
      if (row.breakStatus === 'added' && row.lunchMinutes === null) row.issues.push('Break duration missing');
      if (row.absenceIsNone && start !== null && finish !== null && !row.breakStatus && row.lunchMinutes === null) row.issues.push('Break not recorded');
      if (!row.absenceIsNone && start === null && finish === null) row.breakStatus = row.breakStatus || 'not-required';
      if (start !== null && finish !== null && finish < start) row.issues.push('Finish is earlier than clock in');
      var weekStart = dateOnly(record && record.start_date);
      var weekEnd = dateOnly(record && record.end_date);
      var rowDate = dateOnly(row.date);
      if (weekStart && weekEnd && rowDate && (rowDate < weekStart || rowDate > weekEnd)) row.issues.push('Date is outside the submitted week');
      row.hasClockIn = start !== null;
      row.hasClockOut = finish !== null;
      row.displayBreak = row.breakStatus === 'added'
        ? 'Added · ' + formatMinutes(row.lunchMinutes || 0)
        : row.breakStatus === 'not-taken'
          ? 'Confirmed not taken'
          : row.breakStatus === 'not-required'
            ? 'Not required'
        : row.lunchMinutes !== null && row.lunchMinutes > 0
              ? 'Added · ' + formatMinutes(row.lunchMinutes)
              : row.absenceIsNone && start !== null && finish !== null
                ? 'Not recorded'
                : 'Not recorded';
    });
    rows.sort(function (left, right) { return String(left.date || '').localeCompare(String(right.date || '')); });
    return rows;
  }

  function recordRows(record) {
    return ['timesheets', 'clock'].indexOf(actionKey(record)) !== -1 ? enrichTimesheetRows(record) : [];
  }

  function recordDailyDates(record) {
    return recordRows(record).map(function (row) { return dateKey(row.date); }).filter(Boolean).filter(function (value, index, values) { return values.indexOf(value) === index; });
  }

  function rowIssueText(row) {
    return row && row.issues && row.issues.length ? row.issues.join('; ') : '';
  }

  function rowCompleteness(row) {
    if (!row) return 0;
    var score = 0;
    if (row.date) score += 1;
    if (row.start) score += 2;
    if (row.finish) score += 2;
    if (row.workedMinutes !== null) score += 3;
    if (row.breakStatus) score += 1;
    if (row.note) score += 1;
    return score;
  }

  function uniqueMetricRows(rows) {
    var byDate = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.date) return;
      var key = row.date;
      var existing = byDate[key];
      if (!existing || rowCompleteness(row) > rowCompleteness(existing)) byDate[key] = row;
      else if (existing && rowCompleteness(row) === rowCompleteness(existing)) {
        // Preserve a useful issue from a clock-only record when the selected
        // weekly row has the same amount of data.
        row.issues.forEach(function (issue) { if (existing.issues.indexOf(issue) === -1) existing.issues.push(issue); });
      }
    });
    return Object.keys(byDate).sort().map(function (date) { return byDate[date]; });
  }

  function requestStatusLabel(value) {
    var status = String(value || 'Pending').trim();
    if (/^pending(?: approval)?$/i.test(status)) return 'Pending';
    if (/^approved?$/i.test(status)) return 'Approved';
    if (/^denied$|^rejected$/i.test(status)) return 'Denied';
    return status || 'Pending';
  }

  function calendarRequestsForEmployee(employee) {
    return (lastRecords || []).filter(function (record) {
      var wanted = employee.employee_upn || employee.employee_name;
      return actionKey(record) === 'calendar' && (employeeMatches(record, wanted) || String(record.owner || '').toLowerCase() === String(wanted || '').toLowerCase());
    }).map(function (record) {
      var date = record.event_date || record.record_date || record.start_date || '';
      var end = record.end_date && record.end_date !== date ? ' to ' + record.end_date : '';
      var title = record.event_title || record.event_type || 'Calendar request';
      return [date + end, title, requestStatusLabel(record.status)].filter(Boolean).join(' · ');
    });
  }

  function employeeMetrics(employee) {
    var records = (lastRecords || []).filter(function (record) { return ['timesheets', 'clock'].indexOf(actionKey(record)) !== -1 && employeeMatches(record, employee.employee_upn || employee.employee_name); });
    var rows = [];
    records.forEach(function (record) { rows = rows.concat(recordRows(record)); });
    rows = uniqueMetricRows(rows);
    var hours = rows.reduce(function (total, row) { return total + (row.workedMinutes === null ? 0 : row.workedMinutes); }, 0) / 60;
    var byDate = {};
    rows.forEach(function (row) {
      if (!row.date) return;
      if (!byDate[row.date]) byDate[row.date] = 0;
      if (row.workedMinutes !== null) byDate[row.date] += row.workedMinutes / 60;
    });
    var daySummary = Object.keys(byDate).sort().map(function (date) { return date + ': ' + formatHours(byDate[date]); });
    var absences = rows.filter(function (row) { return !row.absenceIsNone; }).map(function (row) { return row.date + ' ' + row.absenceStatus; });
    var flags = rows.reduce(function (total, row) { return total + row.issues.length; }, 0);
    return { rows: rows, dailyEntries: rows.length, hours: hours, daySummary: daySummary, absences: absences, requests: calendarRequestsForEmployee(employee), flags: flags };
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
    var sourceLabel = record.source === 'portal-d1' ? 'Protected GMT portal' : (record.source || 'Microsoft 365 history');
    if (key === 'calendar') {
      var eventDate = record.event_date || record.eventDate || record.record_date || record.start_date || 'Not dated';
      var eventEnd = record.end_date && record.end_date !== eventDate ? ' to ' + record.end_date : '';
      var eventTitle = record.event_title || record.title || record.event_type || 'Calendar request';
      var eventType = record.event_type || record.type || 'General';
      historyPreview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT request</p><h2>' + safe(eventTitle) + '</h2></div><span class="portal-status ' + safe(statusClass) + '">' + safe(requestStatusLabel(statusValue)) + '</span></div>' +
        '<div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(eventType) + '</p><p><strong>Date:</strong> ' + safe(eventDate + eventEnd) + '</p><p><strong>Requested by:</strong> ' + safe(record.employee_name || record.owner || 'Not recorded') + '</p><p><strong>Submitted:</strong> ' + safe(record.submitted_at || 'Not recorded') + '</p><p><strong>Updated:</strong> ' + safe(record.updated_at || record.submitted_at || 'Not recorded') + '</p><p><strong>Source:</strong> ' + safe(sourceLabel) + '</p></div>' +
        '<p class="small-text">Calendar requests remain visible in this history. Their approval status is controlled by Accounts.</p>' +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') +
        '<section class="timesheet-request-notes"><h3>Notes</h3><p>' + safe(record.notes || record.message || 'No notes recorded.') + '</p></section>';
      return;
    }
    var editable = record.can_edit === true && key === 'timesheets' && recordPayMonth(record) === currentPayMonth() && !!record.source_record_id;
    var rows = recordRows(record);
    var totalMinutes = rows.reduce(function (total, row) { return total + (row.workedMinutes === null ? 0 : row.workedMinutes); }, 0);
    var basicHours = rows.reduce(function (total, row) { return total + (row.basicHours === null ? 0 : row.basicHours); }, 0);
    var ot15Hours = rows.reduce(function (total, row) { return total + (row.ot15Hours === null ? 0 : row.ot15Hours); }, 0);
    var ot20Hours = rows.reduce(function (total, row) { return total + (row.ot20Hours === null ? 0 : row.ot20Hours); }, 0);
    var absenceRows = rows.filter(function (row) { return !row.absenceIsNone; });
    var flaggedRows = rows.filter(function (row) { return row.issues.length; });
    var hasDailyRows = rows.length > 0;
    var summary = '<div class="timesheet-summary" aria-label="Timesheet totals"><div><span>Recorded days</span><strong>' + safe(rows.length) + '</strong></div><div><span>Total hours</span><strong>' + safe(hasDailyRows ? formatMinutes(totalMinutes) : 'Not available') + '</strong></div><div><span>Basic</span><strong>' + safe(hasDailyRows ? formatHours(basicHours) : 'Not available') + '</strong></div><div><span>OT x1.5 / x2</span><strong>' + safe(hasDailyRows ? formatHours(ot15Hours) + ' / ' + formatHours(ot20Hours) : 'Not available') + '</strong></div><div><span>Absence</span><strong>' + safe(absenceRows.length ? absenceRows.length + ' day' + (absenceRows.length === 1 ? '' : 's') : 'None') + '</strong></div><div><span>Review flags</span><strong class="' + (flaggedRows.length ? 'timesheet-flag-count' : '') + '">' + safe(flaggedRows.length) + '</strong></div></div>';
    var rowTable = rows.length ? '<div class="table-scroll timesheet-rows-scroll"><table class="timesheet-paper-rows"><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Break</th><th>Worked</th><th>Basic</th><th>OT x1.5</th><th>OT x2</th><th>Absence / status</th><th>Notes</th></tr></thead><tbody>' + rows.map(function (row) {
      var issue = rowIssueText(row);
      var note = row.note || '';
      if (issue) note = (note ? note + ' · ' : '') + issue;
      return '<tr class="' + (issue ? 'has-timesheet-issue' : '') + '"><td data-label="Date"><strong>' + safe(row.date || 'Not dated') + '</strong></td><td data-label="Clock in">' + safe(row.start || 'Missing') + (row.clockInSource ? '<small class="timesheet-row-source">' + safe(row.clockInSource) + '</small>' : '') + '</td><td data-label="Clock out">' + safe(row.finish || 'Missing') + (row.clockOutSource ? '<small class="timesheet-row-source">' + safe(row.clockOutSource) + '</small>' : '') + '</td><td data-label="Break"><span class="timesheet-break-status ' + (row.breakStatus === 'not-taken' ? 'confirmed' : row.breakStatus === 'added' ? 'added' : issue.indexOf('Break') !== -1 ? 'flagged' : '') + '">' + safe(row.displayBreak) + '</span></td><td data-label="Worked">' + safe(row.workedMinutes === null ? 'Not recorded' : formatMinutes(row.workedMinutes)) + '</td><td data-label="Basic">' + safe(formatHours(row.basicHours)) + '</td><td data-label="OT x1.5">' + safe(formatHours(row.ot15Hours)) + '</td><td data-label="OT x2">' + safe(formatHours(row.ot20Hours)) + '</td><td data-label="Absence / status">' + safe(row.absenceStatus || 'None') + '<small class="timesheet-row-status">' + safe(row.status || '') + '</small></td><td data-label="Notes">' + safe(note || '—') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="small-text">Daily spreadsheet rows were not included in this protected history response, so only the submission header is available.</p>';
    var weekStart = dateOnly(record.start_date);
    var weekEnd = dateOnly(record.end_date);
    var outsideRows = rows.filter(function (row) { var date = dateOnly(row.date); return weekStart && weekEnd && date && (date < weekStart || date > weekEnd); });
    var dateWarning = outsideRows.length ? '<p class="portal-history-warning">Review needed: ' + safe(outsideRows.length + ' daily entr' + (outsideRows.length === 1 ? 'y is' : 'ies are') + ' dated outside the submitted week (' + (record.start_date || 'not dated') + ' to ' + (record.end_date || 'not dated') + '). Check the source email before approving.</p>') : '';
    var editFooter = key === 'timesheets'
      ? (editable ? '<div class="portal-item-actions"><a class="button button-link" href="history-frame.html?edit=' + encodeURIComponent(record.source_record_id) + '">Edit spreadsheet</a></div>' : '<p class="small-text">This submission is view-only because it is outside the current pay month or has no editable portal record.</p>')
      : '';
    historyPreview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(record.employee_name || 'Timesheet') + '</h2></div><span class="portal-status ' + safe(statusClass) + '">' + safe(statusValue) + '</span></div>' +
      '<div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(actionLabel(record)) + '</p><p><strong>Period:</strong> ' + safe(periodLabel(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.submitted_at || 'Not recorded') + '</p><p><strong>Updated:</strong> ' + safe(record.updated_at || record.submitted_at || 'Not recorded') + '</p><p><strong>Source:</strong> ' + safe(sourceLabel) + '</p><p><strong>Pay month:</strong> ' + safe(recordPayMonth(record) || 'Not dated') + '</p></div>' +
      '<p class="small-text">' + (key === 'timesheets' ? 'Viewable at any time; editing is limited to the current pay month. Clock in/out records are joined by employee and date when available; missing clock or break data is flagged for review.' : 'This clock record is joined to the employee\'s daily timesheet by date when available. Missing clock or break data is flagged for review.') + '</p>' +
      (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') + dateWarning + summary + rowTable +
      editFooter;
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

  function calendarDateKeys(record, monthDate) {
    if (!record) return [];
    if (actionKey(record) === 'timesheets') {
      var dailyDates = recordDailyDates(record);
      if (dailyDates.length) {
        return dailyDates.filter(function (key) {
          var parsed = dateOnly(key);
          return parsed && parsed.getUTCFullYear() === monthDate.getFullYear() && parsed.getUTCMonth() === monthDate.getMonth();
        });
      }
      // A legacy weekly row may not have its record attachment yet. Keep one
      // selectable label for that submission until the daily data arrives.
      var start = dateOnly(record.start_date || record.startDate || record.record_date || record.recordDate);
      var end = dateOnly(record.end_date || record.endDate || record.start_date || record.record_date);
      var anchor = dateOnly(record.record_date || record.recordDate || record.start_date || record.startDate || record.end_date || record.endDate);
      if (anchor && anchor.getUTCFullYear() === monthDate.getFullYear() && anchor.getUTCMonth() === monthDate.getMonth()) return [dateKey(anchor)];
      var monthStart = new Date(Date.UTC(monthDate.getFullYear(), monthDate.getMonth(), 1));
      var monthEnd = new Date(Date.UTC(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
      if (start && end && start <= monthEnd && end >= monthStart) return [dateKey(monthStart)];
      return [];
    }
    return recordDateKeys(record);
  }

  function calendarGroupKey(record, index, date) {
    var kind = actionKey(record);
    if (kind !== 'timesheets') return kind + '|record|' + index;
    var employee = String(record && (record.employee_upn || record.employee_name || '') || '').toLowerCase();
    var week = String(record && (record.start_date || record.record_date || record.end_date || '') || '').slice(0, 10);
    var status = String(record && record.status || 'Submitted').toLowerCase();
    return kind + '|' + employee + '|' + week + '|' + String(date || '') + '|' + status;
  }

  function completionMissingLabels(monthDate) {
    var labels = {};
    if (!(currentFilter() === 'all' || currentFilter() === 'timesheets') || !lastCompletion) return labels;
    (lastCompletion.employees || []).forEach(function (employee) {
      var selectedEmployee = currentEmployee().toLowerCase();
      var employeeValue = String(employee.employee_upn || employee.employee_name || '');
      if (selectedEmployee && employeeValue.toLowerCase() !== selectedEmployee && String(employee.employee_name || '').toLowerCase() !== selectedEmployee) return;
      (employee.missing || []).forEach(function (reason) {
        var match = String(reason || '').match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
        var monthFirst = dateKey(new Date(Date.UTC(monthDate.getFullYear(), monthDate.getMonth(), 1)));
        var keys = match
          ? calendarDateKeys({ kind: 'timesheets', start_date: match[1], end_date: match[2] }, monthDate)
          : (currentPayMonth() + '-01' === monthFirst ? [monthFirst] : []);
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
    if (calendarPicker) {
      calendarPicker.value = year + '-' + String(month + 1).padStart(2, '0');
      calendarPicker.hidden = true;
    }
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var days = new Date(year, month + 1, 0).getDate();
    var byDate = {};
    visible.forEach(function (record, index) {
      calendarDateKeys(record, viewDate).forEach(function (key) {
        if (!byDate[key]) byDate[key] = [];
        var groupKey = calendarGroupKey(record, index, key);
        var existing = byDate[key].find(function (entry) { return entry.groupKey === groupKey; });
        if (existing) existing.count += 1;
        else byDate[key].push({ record: record, index: index, groupKey: groupKey, count: 1 });
      });
    });
    var missing = completionMissingLabels(viewDate);
    var html = '';
    for (var blank = 0; blank < offset; blank += 1) html += '<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>';
    var today = dateKey(new Date());
    for (var day = 1; day <= days; day += 1) {
      var key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var entries = byDate[key] || [];
      var labels = entries.map(function (entry) {
        var record = entry.record;
        var employee = record.employee_name || record.employee_upn || 'My submission';
        var countLabel = entry.count > 1 ? ' · ' + entry.count + ' submissions' : '';
        var daily = ['timesheets', 'clock'].indexOf(actionKey(record)) !== -1 ? recordRows(record).find(function (row) { return dateKey(row.date) === key; }) : null;
        var dailyInterval = daily && (daily.start || daily.finish) ? (daily.start || 'Missing') + '–' + (daily.finish || 'Missing') : '';
        var dailyDetail = daily
          ? (daily.absenceIsNone ? (daily.workedMinutes === null ? 'Clock issue' : formatMinutes(daily.workedMinutes)) : daily.absenceStatus) + (dailyInterval ? ' · ' + dailyInterval : '')
          : actionLabel(record);
        var issueLabel = daily && daily.issues.length ? ' · Review' : '';
        var description = employee + ' · ' + (daily ? key + ' · ' + dailyDetail : actionLabel(record)) + countLabel + issueLabel + ' · ' + periodLabel(record);
        return '<button type="button" class="timesheet-calendar-label submitted' + (daily && daily.issues.length ? ' has-timesheet-issue' : '') + '" data-history-index="' + entry.index + '" aria-current="' + String(entry.index === selectedHistory) + '" aria-label="' + safe(description) + '" title="' + safe(description) + '"><strong>' + safe(employee) + '</strong><small>' + safe(daily ? dailyDetail + (entry.count > 1 ? ' ×' + entry.count : '') : actionLabel(record) + (entry.count > 1 ? ' ×' + entry.count : '')) + '</small></button>';
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
  if (calendarTitle) calendarTitle.addEventListener("click", function () {
    if (!calendarPicker) return;
    if (typeof calendarPicker.showPicker === "function") calendarPicker.showPicker();
    else { calendarPicker.hidden = false; calendarPicker.focus(); }
  });
  if (calendarPicker) calendarPicker.addEventListener("change", function () {
    var match = String(calendarPicker.value || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return;
    viewDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    calendarPicker.hidden = true;
    renderCalendar(filteredRecords());
  });
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
