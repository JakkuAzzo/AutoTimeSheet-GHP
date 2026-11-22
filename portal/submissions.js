(function () {
  "use strict";

  var status = document.getElementById("submissions-status");
  var list = document.getElementById("submissions-list");
  var preview = document.getElementById("submissions-preview");
  var filter = document.getElementById("submissions-filter");
  var payMonthFilter = document.getElementById("submissions-pay-month");
  var dayFilter = document.getElementById("submissions-day");
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll("[data-submission-tab]"));
  var listTitle = document.getElementById("pay-month-list-title");
  var listCount = document.getElementById("pay-month-list-count");
  var listKicker = document.querySelector("[data-pay-month-list-kicker]");
  var employeeFilterWrap = document.getElementById("submissions-employee-filter");
  var employeeFilter = document.getElementById("submissions-employee");
  var refresh = document.getElementById("submissions-refresh");
  var deliveryTrigger = document.getElementById("submissions-delivery-trigger");
  var deliveryDialog = document.getElementById("submissions-delivery-dialog");
  var deliveryDetails = document.getElementById("submissions-delivery-details");
  var downloadGroupButtons = Array.prototype.slice.call(document.querySelectorAll("[data-download-sheet-group]"));
  var downloadGroupStatus = document.getElementById("download-team-sheets-status");
  var records = [];
  var realRecordCount = 0;
  var historyMeta = {};
  var selected = -1;
  var selectedDay = requestedDay();
  if (dayFilter && /^\d{4}-\d{2}-\d{2}$/.test(selectedDay)) dayFilter.value = selectedDay;
  var selectedSheet = null;
  var currentTab = requestedTab();
  var payMonthSheets = [];
  var preferredSheetKey = "";
  var payMonthFilterInitialised = false;
  var requestedSheetApplied = false;
  var busy = false;
  var stagedTimesheet = null;

  function payMonthWorkbookApi() {
    return window.GMTPayMonthWorkbook && typeof window.GMTPayMonthWorkbook.toWorkbookData === "function"
      ? window.GMTPayMonthWorkbook
      : null;
  }

  function requestedRecordId() {
    try { return new URLSearchParams(window.location.search).get("record") || ""; } catch (_) { return ""; }
  }
  function requestedDay() {
    try { return new URLSearchParams(window.location.search).get("day") || ""; } catch (_) { return ""; }
  }
  function requestedTab() {
    try {
      var value = new URLSearchParams(window.location.search).get("tab") || "timesheets";
      return ["timesheets", "all", "enquiries", "job-cards", "tasks", "estimates", "invoices", "calendar", "upload"].indexOf(value) >= 0 ? value : "timesheets";
    } catch (_) { return "timesheets"; }
  }
  function requestedMonth() {
    try {
      var value = new URLSearchParams(window.location.search).get("month") || "";
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : "";
    } catch (_) { return ""; }
  }

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }
  function money(value) {
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value) || 0); } catch (_) { return "£" + (Number(value) || 0).toFixed(2); }
  }
  function actionKey(record) {
    var value = [record && record.kind, record && record.action, record && record.category, record && record.record_type].filter(Boolean).join(" ").toLowerCase() || "timesheet";
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1 || value.indexOf("contact") !== -1) return "enquiries";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("invoice") !== -1) return "invoices";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1) return "tasks";
    return "timesheets";
  }
  function isTimesheetLike(record) {
    var key = actionKey(record);
    return key === "timesheets" || key === "clock";
  }
  function typeLabel(record) {
    var key = actionKey(record);
    var labels = { timesheets: "Timesheet", clock: "Clock / breaks", enquiries: "Enquiry", "job-cards": "Job card", estimates: "Estimate", invoices: "Invoice", tasks: "Task", calendar: "Calendar request" };
    if (labels[key]) return labels[key];
    return String(record && (record.demo_label || record.action || record.kind || "Document")).replace(/[_-]/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }
  function displayName(record) {
    if (record && record.is_demo) return record.demo_name || "Example record";
    if (record && actionKey(record) === "enquiries") return record.customer_name || record.employee_name || record.employee_upn || "Customer enquiry";
    return (record && (record.employee_name || record.employee_upn)) || "GMT submission";
  }
  function period(record) {
    if (record && record.record_date) return "Date " + record.record_date;
    if (record && (record.start_date || record.end_date)) return "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
    return "Not dated";
  }
  function currentEmployee() { return employeeFilter && employeeFilter.value ? String(employeeFilter.value).toLowerCase() : ""; }
  function employeeKey(record) {
    if (!record || record.is_demo || actionKey(record) === "enquiries") return "";
    // Keep audit-list filtering on the same exact roster/name resolution used
    // to group pay-month sheets. The history response is already authorized;
    // this only maps a unique roster name to its UPN within that response.
    return sheetEmployeeKey(record);
  }
  function compactDate(record) {
    if (record && record.record_date) return String(record.record_date);
    var start = String(record && (record.start_date || record.startDate) || "");
    var end = String(record && (record.end_date || record.endDate) || "");
    if (start && end && start !== end) return start + " – " + end;
    return start || end || "Not dated";
  }
  function payMonthForRecord(record) {
    if (!record || record.is_demo) return "";
    var payload = payloadFor(record);
    var direct = String(record.pay_month || record.payMonth || payload.payMonth || payload.pay_month || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(direct)) return direct;
    var dates = [];
    var rows = recordRows(record);
    rows.forEach(function (row) { var date = rowDate(row); if (date) dates.push(date); });
    [record.record_date, record.start_date, record.end_date].forEach(function (value) { if (/^\d{4}-\d{2}-\d{2}/.test(String(value || ""))) dates.push(String(value).slice(0, 10)); });
    if (window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function") {
      var routed = dates.map(function (date) { return window.GMTPayPeriods.payMonthKeyForDate(date); }).filter(Boolean);
      if (routed.length) return routed.sort()[0];
    }
    return dates.length ? dates[0].slice(0, 7) : "";
  }
  function payMonthKeyForDate(date) {
    if (!date) return "";
    return window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function"
      ? window.GMTPayPeriods.payMonthKeyForDate(date)
      : date.slice(0, 7);
  }
  function matchesPayMonth(record, month) {
    if (!month) return true;
    var months = recordRows(record).map(function (row) {
      return payMonthKeyForDate(rowDate(row));
    }).filter(Boolean);
    return months.length ? months.indexOf(month) !== -1 : payMonthForRecord(record) === month;
  }
  function hasDayInPayMonth(record, day, month) {
    return recordRows(record).some(function (row) {
      var date = rowDate(row);
      return date === day && (!month || payMonthKeyForDate(date) === month);
    });
  }
  function rowDate(row) {
    if (!row || typeof row !== "object") return "";
    var value = row.date || row.recordDate || row.record_date || row.workDate || row.Date || "";
    return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : "";
  }
  function recordRows(record) {
    if (window.GMTCalendarData && typeof window.GMTCalendarData.rowsFor === "function") {
      var rows = window.GMTCalendarData.rowsFor(record);
      if (Array.isArray(rows) && rows.length) return rows;
    }
    var payload = payloadFor(record);
    if (Array.isArray(payload.rows) && payload.rows.length) return payload.rows;
    // Clock-in and break events can arrive as a single partial record rather
    // than a submitted weekly rows array. Keep that event in the employee's
    // pay-month sheet so a missing finish/break remains visible and editable.
    if (actionKey(record) === "clock") {
      var date = rowDate({ date: record.record_date || record.recordDate || payload.recordDate || payload.date || payload.eventDate });
      if (date) return [{
        date: date,
        start: rowValue(record, ["start_time", "startTime"], rowValue(payload, ["startTime", "start", "clockIn", "clock_in"], "")),
        finish: rowValue(record, ["finish_time", "finishTime"], rowValue(payload, ["finishTime", "finish", "clockOut", "clock_out"], "")),
        lunchMinutes: breakMinutes(payload),
        absenceStatus: rowValue(payload, ["absenceReason", "absence", "absenceStatus"], "NA"),
        note: rowValue(payload, ["note", "notes", "description"], "")
      }];
    }
    return [];
  }
  function emptyHistoricalDemo(record) {
    var label = String(record && record.employee_name || "").trim();
    return (label === "Canonical employee month workbook replay 2026-09-17-02" || label === "ARCHIVE REAL") && recordRows(record).length === 0;
  }
  function recordId(record) { return String(record && (record.source_record_id || record.record_id || record.id) || ""); }
  function authoritativeSourceRecordId(record) { return String(record && (record.source_record_id || record.record_id) || ""); }
  function sourceRecordIdDetail(record) {
    var id = authoritativeSourceRecordId(record);
    return id ? '<p><strong>Source record ID:</strong> ' + safe(id) + '</p>' : '';
  }
  function recordUpdated(record) {
    var value = record && (record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || "");
    var time = Date.parse(String(value));
    return Number.isFinite(time) ? time : 0;
  }
  function currentPayMonth() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    var part = function (type) { return String((parts.find(function (entry) { return entry.type === type; }) || {}).value || ""); };
    var today = part("year") + "-" + part("month") + "-" + part("day");
    if (window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function") return window.GMTPayPeriods.payMonthKeyForDate(today);
    return new Date().toISOString().slice(0, 7);
  }
  function monthLabel(month) {
    var match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return "Pay month " + month;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    var label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
    return month === currentPayMonth() ? "Current - " + label : label;
  }
  function sheetEmployeeKey(record) {
    var upn = String(record && (record.employee_upn || record.employee_email || "")).trim().toLowerCase();
    var name = String(record && record.employee_name || "").trim().toLowerCase();
    var roster = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    var match = roster.find(function (employee) { return upn && upn === String(employee.employee_upn || employee.upn || "").trim().toLowerCase(); });
    if (!match && name) {
      var matches = roster.filter(function (employee) { return name === String(employee.employee_name || employee.name || "").trim().toLowerCase(); });
      if (matches.length === 1) match = matches[0];
    }
    if (match) return String(match.employee_upn || match.upn || match.employee_name || "").trim().toLowerCase();
    // A history-only source may have a name but no mailbox. Join it to a
    // signed-in record only when that name has exactly one known mailbox.
    if (!upn && name) {
      var known = Array.from(new Set(records.filter(function (entry) {
        return !entry.is_demo && String(entry.employee_name || "").trim().toLowerCase() === name;
      }).map(function (entry) { return String(entry.employee_upn || entry.employee_email || "").trim().toLowerCase(); }).filter(Boolean)));
      if (known.length === 1) return known[0];
    }
    return upn || name;
  }
  function canEditSheet(sheet) {
    if (!sheet) return false;
    if (sheet.conflictingDays && sheet.conflictingDays.length) return false;
    if (historyMeta && historyMeta.is_submission_admin === true) return true;
    var canEditAcrossEmployees = historyMeta && historyMeta.is_admin === true && historyMeta.can_view_all_timesheets === true;
    var months = canEditAcrossEmployees
      ? (Array.isArray(historyMeta.editable_pay_months) ? historyMeta.editable_pay_months : [])
      : (historyMeta && Array.isArray(historyMeta.self_editable_pay_months) ? historyMeta.self_editable_pay_months : [currentPayMonth()]);
    return months.indexOf(sheet.payMonth) !== -1
      && (canEditAcrossEmployees || sheet.records.some(function (record) { return record.can_edit === true; }));
  }
  function sourcePriority(record) {
    if (String(record && record.action || "") === "pay_month_correction") return 3;
    var status = String(payloadFor(record).reconciliation && payloadFor(record).reconciliation.status || "").toLowerCase();
    if (status === "authoritative") return 2;
    if (status === "source-variant") return 0;
    return 1;
  }
  function rowValue(row, keys, fallback) {
    for (var i = 0; i < keys.length; i += 1) if (row && row[keys[i]] !== undefined && row[keys[i]] !== null) return row[keys[i]];
    return fallback === undefined ? "" : fallback;
  }
  function timeMinutes(value) {
    var match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    var hour = Number(match[1]); var minute = Number(match[2] || 0);
    if (minute > 59) return null;
    if (match[3]) { if (hour < 1 || hour > 12) return null; if (match[3].toLowerCase() === "pm" && hour < 12) hour += 12; if (match[3].toLowerCase() === "am" && hour === 12) hour = 0; }
    return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
  }
  function breakMinutes(row) {
    var api = payMonthWorkbookApi();
    if (api && typeof api.breakMinutesForRow === "function") return api.breakMinutesForRow(row);
    var value = rowValue(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break"], "");
    if (value === "" || value === null || value === true) return null;
    if (value === false || /^no break$/i.test(String(value))) return 0;
    var number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : null;
  }
  function rowTotalMinutes(row) {
    if (/^un-paid$/i.test(String(rowValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"], "NA")).trim())) return 0;
    var api = payMonthWorkbookApi();
    if (api && typeof api.workedMinutesForRow === "function") return api.workedMinutesForRow(row);
    var start = timeMinutes(rowValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"], ""));
    var finish = timeMinutes(rowValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], ""));
    if (start !== null && finish !== null && finish >= start && breakMinutes(row) !== null) return Math.max(0, finish - start - breakMinutes(row));
    var directValue = rowValue(row, ["workedMinutes", "worked_minutes"], "");
    var direct = directValue === "" ? NaN : Number(directValue);
    return Number.isFinite(direct) ? Math.max(0, direct) : start !== null && finish !== null && finish >= start ? finish - start : null;
  }
  function dailyRollupDetail(record) {
    var payload = payloadFor(record);
    if (payload.dailyRollup !== true) return "";
    var row = recordRows(record)[0] || {};
    var start = rowValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"], "");
    var finish = rowValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], "");
    var lunchStart = rowValue(row, ["lunchStart", "lunch_start", "breakStart", "break_start"], "");
    var lunchEnd = rowValue(row, ["lunchEnd", "lunch_end", "breakEnd", "break_end"], "");
    var breakTotal = breakMinutes(row);
    var worked = rowTotalMinutes(row);
    var sourceCount = Array.isArray(record.source_record_ids) ? record.source_record_ids.length : 0;
    return '<div class="portal-timesheet-daily-rollup"><p><strong>Clock in and out:</strong> ' + safe(start || "Not recorded") + '–' + safe(finish || "Not recorded") + '</p><p><strong>Lunch:</strong> ' + safe(lunchStart || "Not recorded") + '–' + safe(lunchEnd || "Not recorded") + (breakTotal === null ? "" : ' · ' + safe(displayHours(breakTotal))) + '</p><p><strong>Worked:</strong> ' + safe(worked === null ? "Not calculated" : displayHours(worked)) + '</p><p class="small-text">Combined from ' + sourceCount + ' source entr' + (sourceCount === 1 ? "y" : "ies") + '; original entries remain available for audit.</p></div>';
  }
  function rowWorkedMinutes(row) { var total = rowTotalMinutes(row); return total === null ? 0 : total; }
  function displayHours(minutes) { var value = Math.max(0, Math.round(Number(minutes) || 0)); var hours = Math.floor(value / 60); var rest = value % 60; return hours + "h" + (rest ? " " + rest + "m" : ""); }
  function rowMetrics(row) {
    var date = rowDate(row); var dateObj = date ? new Date(date + "T00:00:00Z") : null; var day = dateObj ? dateObj.getUTCDay() : 1; var absence = String(rowValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"], "NA")); var worked = rowWorkedMinutes(row); var result = { workedActual: worked, basic: 0, ot15: 0, ot20: 0, holiday: 0, sick: 0, timeOff: 0, unpaid: 0, absent: 0 };
    if (/^un-paid$/i.test(absence)) { result.workedActual = 0; result.unpaid = 1; result.absent = 1; return result; }
    if (/^holiday$/i.test(absence)) { result.workedActual = 480; result.basic = 480; result.holiday = 1; result.absent = 1; return result; }
    if (/^sick$/i.test(absence)) { result.sick = 1; result.absent = 1; return result; }
    if (/^time off$/i.test(absence)) { result.timeOff = 1; result.absent = 1; }
    if (day >= 1 && day <= 5) { result.basic = Math.min(480, worked); result.ot15 = Math.max(0, worked - 480); }
    else if (day === 6) { result.ot15 = Math.min(300, worked); result.ot20 = Math.max(0, worked - 300); }
    else result.ot20 = worked;
    return result;
  }
  function combinedSheet(recordsForMonth, sheetMonth, employeeIdentity) {
    var sourceRecords = (recordsForMonth || []).filter(function (record) { return isTimesheetLike(record) && !record.is_demo; });
    if (!sourceRecords.length) return null;
    sourceRecords.sort(function (left, right) { return recordUpdated(right) - recordUpdated(left); });
    sheetMonth = sheetMonth || payMonthForRecord(sourceRecords[0]);
    var selectedDays = Object.create(null);
    var originalRates = Object.create(null);
    function rateFingerprint(row) {
      var evidence = row && row.sourceEvidence && typeof row.sourceEvidence === 'object' ? row.sourceEvidence : {};
      return [evidence.rateEvidenceVersion ?? null,evidence.claimedBasic ?? null,evidence.claimedOt15 ?? null,evidence.claimedOt20 ?? null];
    }
    function normalizedCandidate(entry) {
      var api = payMonthWorkbookApi();
      var value = api && typeof api.toWorkbookData === 'function' ? api.toWorkbookData({rows:[{row:entry.item.row}]},{}).dailyEntries[0] : entry.item.row;
      return {value:value,rateEvidence:rateFingerprint(entry.item.row)};
    }
    function chooseDay(date, candidate) {
      var previous = selectedDays[date];
      if (previous && candidate.priority === previous.priority && candidate.priority < 3) {
        var differs = candidate.deleted !== previous.deleted || (!candidate.deleted && JSON.stringify(normalizedCandidate(candidate)) !== JSON.stringify(normalizedCandidate(previous)));
        var conflict = Boolean(previous.conflict || differs);
        if (candidate.updated > previous.updated) { candidate.conflict = conflict; selectedDays[date] = candidate; }
        else previous.conflict = conflict;
        return;
      }
      if (!previous || candidate.priority > previous.priority || (candidate.priority === previous.priority && candidate.updated > previous.updated)) {
        selectedDays[date] = candidate;
      } else if (candidate.priority === previous.priority && candidate.updated === previous.updated) {
        if(candidate.deleted !== previous.deleted || (!candidate.deleted && JSON.stringify(normalizedCandidate(candidate))!==JSON.stringify(normalizedCandidate(previous))))previous.conflict = true;
      }
    }
    var roster = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    var employee = roster.find(function (entry) { return String(entry.employee_upn || entry.upn || "").trim().toLowerCase() === employeeIdentity; });
    var employeeSchedule = employee && Array.isArray(employee.schedule_weekdays) ? employee.schedule_weekdays : [];
    sourceRecords.forEach(function (record) {
      if (String(record.action || "") === "pay_month_correction") {
        (payloadFor(record).deletedDays || []).forEach(function (date) { if (window.GMTPayPeriods.payMonthKeyForDate(date) === sheetMonth) chooseDay(date, { deleted:true, priority:sourcePriority(record), updated:recordUpdated(record) }); });
      }
      recordRows(record).forEach(function (row, index) {
        var date = rowDate(row);
        var recordPayload = payloadFor(record);
        var scheduledDays = Array.isArray(record.schedule_weekdays) ? record.schedule_weekdays
          : Array.isArray(record.scheduleWeekdays) ? record.scheduleWeekdays
            : Array.isArray(record.workdays) ? record.workdays
              : Array.isArray(recordPayload.scheduleWeekdays) ? recordPayload.scheduleWeekdays
                : Array.isArray(recordPayload.workdays) ? recordPayload.workdays : employeeSchedule;
        var weekday = date ? (new Date(date + "T12:00:00Z").getUTCDay() || 7) : 0;
        var rowMonth = window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function"
          ? window.GMTPayPeriods.payMonthKeyForDate(date)
          : payMonthForRecord({ payload: { rows: [row] }, start_date: date });
        if (!date || (sheetMonth && rowMonth && rowMonth !== sheetMonth)) return;
        var candidate = { row: Object.assign({}, row), date: date, scheduled: row.scheduled !== false && (!scheduledDays.length || scheduledDays.indexOf(weekday) !== -1), scheduleWeekdays: scheduledDays.slice(), sourceRecordId: recordId(record), sourceIndex: index, sourceRecord: record };
        var priority=sourcePriority(record), rateEvidence=rateFingerprint(row);
        if(priority<3 && rateEvidence[0]===1 && rateEvidence.slice(1).some(function(value){return value!==null;})) (originalRates[date]||(originalRates[date]=[])).push(rateEvidence);
        chooseDay(date, { deleted:false, priority:priority, updated:recordUpdated(record), item:candidate });
      });
    });
    Object.keys(selectedDays).forEach(function(date){
      var selected=selectedDays[date];
      if(!selected.deleted && selected.priority===3 && (originalRates[date]||[]).some(function(rates){return JSON.stringify(rates)!==JSON.stringify(rateFingerprint(selected.item.row));})) selected.conflict=true;
    });
    var conflictingDays = Object.keys(selectedDays).filter(function (date) { return selectedDays[date].conflict; }).sort();
    var reviewRows = Object.keys(selectedDays).sort().filter(function (date) { return !selectedDays[date].deleted && !selectedDays[date].conflict; }).map(function (date) { return selectedDays[date].item; });
    // Accounts needs to see off-roster source rows in the editable sheet so
    // they can remove erroneous weekend entries. Keep the calendar/pay-month
    // row set on the configured schedule, and retain all source rows separately
    // for the editor.
    var rows = reviewRows.filter(function (item) { return item.scheduled; });
    var first = sourceRecords[0];
    var identified = sourceRecords.find(function (record) { return String(record.employee_upn || record.employee_email || "").trim(); }) || first;
    var totals = rows.reduce(function (sum, item) { var metrics = rowMetrics(item.row); Object.keys(metrics).forEach(function (key) { sum[key] = (sum[key] || 0) + (Number(metrics[key]) || 0); }); return sum; }, {});
    var sheet = { key: (employeeIdentity || sheetEmployeeKey(first) || "all") + "|" + sheetMonth, employeeName: employee && (employee.employee_name || employee.name) || first.employee_name || identified.employee_name || first.employee_upn || "GMT staff", employeeUpn: employee && (employee.employee_upn || employee.upn) || identified.employee_upn || identified.employee_email || "", payMonth: sheetMonth, records: sourceRecords, rows: rows, reviewRows: reviewRows, conflictingDays:conflictingDays, totals: totals, updatedAt: recordUpdated(first) };
    sheet.canEdit = canEditSheet(sheet);
    return sheet;
  }
  function buildPayMonthSheets() {
    var groups = {};
    records.filter(function (record) { return isTimesheetLike(record) && !record.is_demo; }).forEach(function (record) {
      var employee = sheetEmployeeKey(record); if (!employee) return;
      var months = recordRows(record).map(function (row) { return rowDate(row); }).filter(Boolean).map(function (date) { return window.GMTPayPeriods && window.GMTPayPeriods.payMonthKeyForDate ? window.GMTPayPeriods.payMonthKeyForDate(date) : date.slice(0, 7); });
      var declared = payMonthForRecord(record);
      if (!months.length && declared) months.push(declared);
      months.filter(function (month, index) { return month && months.indexOf(month) === index; }).forEach(function (month) {
        var key = employee + "|" + month; (groups[key] = groups[key] || []).push(record);
      });
    });
    payMonthSheets = Object.keys(groups).map(function (key) { var divider = key.lastIndexOf("|"); return combinedSheet(groups[key], key.slice(divider + 1), key.slice(0, divider)); }).filter(Boolean);
    if (stagedTimesheet && !payMonthSheets.some(function(sheet){return sheet.key===stagedTimesheet.key;})) {
      var target=stagedTimesheet.target;
      payMonthSheets.push({key:stagedTimesheet.key,employeeName:target.employeeName,employeeUpn:target.employeeUpn,payMonth:target.payMonth,records:[],rows:[],reviewRows:[],totals:{workedActual:0},updatedAt:0,canEdit:true});
    }
    var selectedMonth = payMonthFilter && payMonthFilter.value || "";
    var editableMonths = historyMeta && Array.isArray(historyMeta.editable_pay_months) ? historyMeta.editable_pay_months : [];
    if ((historyMeta.is_admin === true && editableMonths.indexOf(selectedMonth) !== -1)
      || (historyMeta.is_submission_admin === true && selectedMonth === currentPayMonth())) {
      var roster = historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
      roster.forEach(function (employee) {
        var upn = String(employee.employee_upn || employee.upn || "").trim();
        if (!upn || payMonthSheets.some(function (sheet) { return sheet.payMonth === selectedMonth && sheet.employeeUpn.toLowerCase() === upn.toLowerCase(); })) return;
        var sheet = { key: upn.toLowerCase() + "|" + selectedMonth, employeeName: employee.employee_name || employee.name || upn, employeeUpn: upn, payMonth: selectedMonth, records: [], rows: [], totals: { workedActual: 0 }, updatedAt: 0 };
        sheet.canEdit = canEditSheet(sheet);
        payMonthSheets.push(sheet);
      });
    }
    payMonthSheets.sort(function (left, right) { return right.updatedAt - left.updatedAt || right.payMonth.localeCompare(left.payMonth) || left.employeeName.localeCompare(right.employeeName); });
    return payMonthSheets;
  }
  function visibleRecords() {
    var selectedType = currentTab && currentTab !== "all" ? currentTab : "";
    var selectedEmployee = currentEmployee();
    var selectedMonth = payMonthFilter && payMonthFilter.value ? String(payMonthFilter.value) : "";
    // This workspace is an audit/history list: retain each authorised source
    // record so its count and version identity do not collapse into calendar
    // day rollups. Calendar consumers can continue using combineDailyRecords.
    return records.filter(function (record) {
      if (selectedType === "timesheets" ? !isTimesheetLike(record) : (selectedType && actionKey(record) !== selectedType)) return false;
      if (selectedEmployee && employeeKey(record) !== selectedEmployee) return false;
      if (selectedMonth && selectedDay) {
        if (!hasDayInPayMonth(record, selectedDay, selectedMonth)) return false;
      } else {
        if (selectedMonth && !matchesPayMonth(record, selectedMonth)) return false;
        if (selectedDay && !hasDayInPayMonth(record, selectedDay, "")) return false;
      }
      return true;
    });
  }
  function populateEmployees(realRecords) {
    if (!employeeFilter) return 0;
    var selected = currentEmployee();
    var entries = new Map();
    function add(value, label) {
      value = String(value || "").trim();
      label = String(label || value || "").trim();
      if (!value || !label) return;
      var key = value.toLowerCase();
      if (!entries.has(key)) entries.set(key, { value: value, label: label });
    }
    var completionEmployees = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    completionEmployees.forEach(function (employee) { add(employee.employee_upn || employee.employee_name, employee.employee_name || employee.employee_upn); });
    (realRecords || []).forEach(function (record) {
      if (record && !record.is_demo && actionKey(record) !== "enquiries") add(record.employee_upn || record.employee_name, record.employee_name || record.employee_upn);
    });
    var sorted = Array.from(entries.values()).sort(function (left, right) { return left.label.localeCompare(right.label); });
    employeeFilter.innerHTML = '<option value="">All employees</option>' + sorted.map(function (entry) { return '<option value="' + safe(entry.value) + '">' + safe(entry.label) + '</option>'; }).join("");
    employeeFilter.value = selected;
    // Keep the control visible on every authorised document view. Accounts
    // receives the full roster; other identities simply see the employees
    // present in their authorised history (often just themselves).
    if (employeeFilterWrap) employeeFilterWrap.hidden = !(historyMeta && historyMeta.can_view_all_timesheets === true);
    return sorted.length;
  }
  function populatePayMonths() {
    if (!payMonthFilter) return;
    var previous = payMonthFilter.value;
    var months = Array.from(new Set(payMonthSheets.map(function (sheet) { return sheet.payMonth; }).filter(Boolean)));
    var editable = historyMeta && Array.isArray(historyMeta.editable_pay_months) ? historyMeta.editable_pay_months : [];
    months = months.concat(editable).filter(function (value, index, values) { return /^\d{4}-\d{2}$/.test(value) && values.indexOf(value) === index; }).sort(function (left, right) { return right.localeCompare(left); });
    payMonthFilter.innerHTML = '<option value="">All pay months</option>' + months.map(function (month) { return '<option value="' + safe(month) + '">' + safe(monthLabel(month)) + '</option>'; }).join("");
    if (payMonthFilterInitialised && (previous === "" || months.indexOf(previous) !== -1)) payMonthFilter.value = previous;
    else {
      var current = currentPayMonth();
      var sheetMonths = Array.from(new Set(payMonthSheets.map(function (sheet) { return sheet.payMonth; }).filter(Boolean))).sort(function (left, right) { return right.localeCompare(left); });
      // Prefer the current cycle only when it has a real sheet. If the cycle
      // is newly opened and no one has submitted yet, show the most recently
      // updated sheet so the preview is immediately useful.
      var requested = requestedMonth();
      payMonthFilter.value = requested && months.indexOf(requested) !== -1 ? requested : (sheetMonths.indexOf(current) !== -1 ? current : (sheetMonths[0] || ""));
    }
    payMonthFilterInitialised = true;
  }
  function emptyMessage() {
    if (currentTab === "timesheets") return "No full pay-month sheets match these filters.";
    if (currentTab === "all" && historyMeta.is_operations_admin && !historyMeta.is_admin) return "No non-timesheet submissions are available yet. This account can see all job cards, estimates, tasks and calendar requests; employee timesheets remain owner-filtered.";
    return "No records match this filter.";
  }
  function destination(record) {
    var key = actionKey(record);
    return key === "job-cards" ? "../jobs/" : key === "estimates" ? "../tools/estimates.html" : key === "invoices" ? "../tools/invoices.html" : key === "tasks" ? "../tasks/" : key === "calendar" ? "submissions?tab=calendar" : key === "enquiries" ? "../#workshop-enquiry" : "submissions.html";
  }
  function timesheetHref(record, day, payMonth) {
    var params = [];
    var recordId = record && (record.source_record_id || record.record_id || record.id);
    var employee = record && (record.employee_upn || record.employee_name);
    var month = String(payMonth || record && (record.end_date || record.endDate || record.start_date || record.startDate || record.record_date || record.recordDate) || '').slice(0, 7);
    if (recordId && !record.is_demo) params.push('record=' + encodeURIComponent(recordId));
    if (employee && !record.is_demo) params.push('employee=' + encodeURIComponent(employee));
    if (/^\d{4}-\d{2}$/.test(month) && !record.is_demo) params.push('month=' + month);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) && !record.is_demo) params.push('day=' + encodeURIComponent(day));
    return 'submissions.html' + (params.length ? '?' + params.join('&') : '');
  }
  function payloadFor(record) {
    return record && record.payload && typeof record.payload === "object" ? record.payload : {};
  }
  function sparseTimesheet(record) {
    return actionKey(record) === "timesheets" && !!(record && (record.daily_detail_issue || /daily rows were not returned/i.test(String(record.issue || ""))));
  }

  function jobPreviewData(record) {
    var payload = payloadFor(record);
    return {
      ref: record.job_ref || payload.jobReference || payload.ref || record.record_id || "EC 00000",
      client: record.client || payload.client || payload.company || "Customer / client",
      site: record.site || payload.site || payload.siteAddress || "Job address",
      engineer: record.engineer || payload.engineer || payload.assignedEngineer || "Engineer",
      date: record.planned_date || payload.plannedDate || payload.date || record.record_date || "Date",
      description: record.description || payload.description || "Job description / report"
    };
  }

  function renderEcJobSheet(data) {
    return '<article class="job-card-sheet job-card-sheet-ec" aria-label="EC job card preview">' +
      '<div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand">GMT Electrical Services</span></div><div class="job-sheet-number"><span>E.C.No</span><strong>' + safe(data.ref || "EC 00000") + '</strong></div></div>' +
      '<div class="job-sheet-meta-grid job-sheet-meta-ec"><div class="job-sheet-field"><span>Date:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field job-sheet-address"><span>Job Address:</span><strong>' + safe(data.site) + '</strong></div><div class="job-sheet-field"><span>Customer:</span><strong>' + safe(data.client) + '</strong></div><div class="job-sheet-field"><span>Contact:</span><strong>________________</strong></div><div class="job-sheet-field"><span>Order No:</span><strong>' + safe(data.ref || "EC 00000") + '</strong></div><div class="job-sheet-field"><span>Tel:</span><strong>________________</strong></div></div>' +
      '<div class="job-sheet-rule"></div><div class="job-sheet-section-title">Job description / Report</div><div class="job-sheet-lined job-sheet-report">' + safe(data.description) + '</div>' +
      '<div class="job-sheet-footer-grid"><div class="job-sheet-field"><span>Engineer:</span><strong>' + safe(data.engineer) + '</strong></div><div class="job-sheet-field"><span>Date Started:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field"><span>Date Completed:</span><strong>________________</strong></div></div></article>';
  }

  function renderMtaJobSheet(data) {
    return '<article class="job-card-sheet job-card-sheet-mta" aria-label="MTA job card preview">' +
      '<div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand job-sheet-brand-wide">GMT Electrical Services Ltd.</span></div><div class="job-sheet-number"><span>MTA No.</span><strong>' + safe(data.ref || "MTA 00000") + '</strong></div></div>' +
      '<div class="job-sheet-mta-meta"><div class="job-sheet-field"><span>Date:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field"><span>Job authorised by:</span><strong>________________</strong></div><div class="job-sheet-field"><span>Tally:</span><strong>________________</strong></div></div>' +
      '<div class="job-sheet-mta-parties"><div class="job-sheet-box"><span>Invoiced to</span><strong>' + safe(data.client) + '</strong></div><div class="job-sheet-box"><span>Dispatched to</span><strong>' + safe(data.site) + '</strong><div class="job-sheet-signature"><small>Signature: __________________</small><small>Date: __________</small></div><small>Print name: ______________________________</small></div></div>' +
      '<div class="job-sheet-equipment"><div>MAKE</div><div>HP / KW</div><div>VOLTS</div><div>RPM</div><div>SERIAL No.</div><strong>' + safe(data.client) + '</strong><span>________</span><span>________</span><span>________</span><span>________________</span></div>' +
      '<div class="job-sheet-section-title">Report</div><div class="job-sheet-mta-report"><div class="job-sheet-lined job-sheet-report">' + safe(data.description) + '</div><div class="job-sheet-checklist"><span>SLOTS __________________</span><span>COILS __________________</span><span>GROUPS ________________</span><span>SPAN __________________</span><span>CONNECTION ____________</span><span>EXTRA __________________</span><span>WINDER _________________</span></div></div>' +
      '<div class="job-sheet-mta-footer"><div class="job-sheet-box"><span>Material / time / operative / price</span><strong>Engineer: ' + safe(data.engineer) + '</strong></div><div class="job-sheet-box"><span>Test report</span><small>2500 volts __________________</small><small>Megger _____________________</small><small>Tested by __________________</small><small>Authorised by ______________</small><small>Date ______________________</small></div></div></article>';
  }

  function renderJobCardPreview(record) {
    var payload = payloadFor(record);
    var data = jobPreviewData(record);
    var selectedType = String(record.card_type || payload.cardType || "EC").toUpperCase() === "MTA" ? "MTA" : "EC";
    preview.innerHTML = '<div class="submission-document-preview"><div class="job-card-preview-heading"><div><p class="portal-card-kicker">' + safe(selectedType) + ' card</p><h3>' + safe(record.is_demo ? "Example job card" : (record.job_ref || record.record_id || "Job card")) + '</h3></div><div class="job-card-preview-toggle" role="group" aria-label="Preview card format"><button type="button" class="secondary' + (selectedType === "EC" ? ' is-selected' : '') + '" data-submission-card-type="EC" aria-pressed="' + String(selectedType === "EC") + '">EC card</button><button type="button" class="secondary' + (selectedType === "MTA" ? ' is-selected' : '') + '" data-submission-card-type="MTA" aria-pressed="' + String(selectedType === "MTA") + '">MTA card</button></div></div><div class="job-card-preview" data-submission-job-sheet>' + (selectedType === "MTA" ? renderMtaJobSheet(data) : renderEcJobSheet(data)) + '</div>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '') + sourceRecordIdDetail(record) + '</div>';
    preview.querySelectorAll("[data-submission-card-type]").forEach(function (button) {
      button.addEventListener("click", function () {
        var type = button.getAttribute("data-submission-card-type") === "MTA" ? "MTA" : "EC";
        preview.querySelectorAll("[data-submission-card-type]").forEach(function (item) { var active = item.getAttribute("data-submission-card-type") === type; item.classList.toggle("is-selected", active); item.setAttribute("aria-pressed", String(active)); });
        var sheet = preview.querySelector("[data-submission-job-sheet]");
        if (sheet) sheet.innerHTML = type === "MTA" ? renderMtaJobSheet(data) : renderEcJobSheet(data);
      });
    });
  }

  function estimatePreviewData(record) {
    var payload = payloadFor(record);
    var items = Array.isArray(record.items) && record.items.length ? record.items : (Array.isArray(payload.items) ? payload.items : []);
    items = items.map(function (item) { return { description: item.description || item.Description || "", quantity: Number(item.quantity ?? item.Quantity) || 0, unit: Number(item.unit ?? item.Unit ?? item.unitPrice) || 0 }; }).filter(function (item) { return item.description; });
    var subtotal = Number(record.subtotal ?? payload.subtotal);
    if (!Number.isFinite(subtotal)) subtotal = items.reduce(function (sum, item) { return sum + item.quantity * item.unit; }, 0);
    var vatRate = Number(record.vat_rate ?? payload.vatRate) || 0;
    var vat = Number(record.vat ?? payload.vat);
    if (!Number.isFinite(vat)) vat = subtotal * vatRate / 100;
    var total = Number(record.total ?? payload.total);
    if (!Number.isFinite(total)) total = subtotal + vat;
    return { number: record.estimate_number || payload.number || payload.estimateNumber || record.record_id || "GMT-EST-DEMO-001", date: record.estimate_date || payload.date || record.record_date || "", attention: record.client_contact || payload.attention || "Client contact", company: record.client_company || payload.company || "Client company", email: record.client_email || payload.email || "", validity: record.validity || payload.validity || "30", preparedBy: record.prepared_by || payload.preparedBy || "GMT Electrical Services Ltd", vatRate: vatRate, reference: record.reference || payload.reference || "Estimate", opening: record.opening || payload.opening || "", terms: record.terms || payload.terms || "", items: items, subtotal: subtotal, vat: vat, total: total };
  }

  function renderEstimatePreview(record) {
    var d = estimatePreviewData(record);
    var rows = d.items.map(function (item) { return '<tr><td>' + safe(item.description) + '</td><td>' + safe(item.quantity) + '</td><td>' + safe(money(item.unit)) + '</td><td>' + safe(money(item.quantity * item.unit)) + '</td></tr>'; }).join("") || '<tr><td colspan="4">No line items added.</td></tr>';
    preview.innerHTML = '<div class="estimate-paper-header"><img class="estimate-paper-logo" src="../image.png" alt="GMT Electrical Services Ltd logo"><div class="estimate-paper-company"><p>Electric Motor Repairs &amp; Rewinds</p><p>Electrical &amp; Mechanical Engineers</p><p>Air Conditioning Repair &amp; Service</p><p>93-95 Gloucester Rd, Croydon CR0 2DN</p><p>Tel 020 8683 0464</p><p>info@gmt-services.co.uk</p></div></div><h1 class="estimate-paper-title">Estimate</h1><div class="estimate-paper-meta"><div><p><strong>For the attention of:</strong> ' + safe(d.attention) + '</p><p><strong>Company:</strong> ' + safe(d.company) + '</p><p><strong>Re:</strong> ' + safe(d.reference) + '</p></div><div><p><strong>Date:</strong> ' + safe(d.date) + '</p><p><strong>Estimate no:</strong> ' + safe(d.number) + '</p></div></div><div class="estimate-paper-body"><p>' + safe(d.opening).replace(/\n/g, '<br>') + '</p><table class="estimate-paper-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table><div class="estimate-paper-total"><p><span>Subtotal</span><strong>' + safe(money(d.subtotal)) + '</strong></p><p><span>VAT (' + safe(d.vatRate) + '%)</span><strong>' + safe(money(d.vat)) + '</strong></p><p class="grand-total"><span>Total</span><strong>' + safe(money(d.total)) + '</strong></p></div></div><p class="estimate-paper-terms">' + safe(d.terms) + '<br><br>Estimate validity: ' + safe(d.validity) + ' days.</p><p>Regards,<br>' + safe(d.preparedBy) + '</p>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '') + sourceRecordIdDetail(record);
  }

  function renderTaskPreview(record) {
    var payload = payloadFor(record);
    var title = record.task_title || payload.title || (record.is_demo ? "Example task" : "Task");
    var job = record.job_reference || payload.jobReference || "No job reference";
    var assignee = record.assignee || payload.assignee || "Unassigned";
    var due = record.due_date || payload.due || record.record_date || "No due date";
    var priority = record.priority || payload.priority || "Normal";
    preview.innerHTML = '<div class="submission-task-preview"><div class="submission-task-preview-header"><img class="submission-task-preview-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><div><p class="portal-card-kicker">GMT task</p><h2>' + safe(title) + '</h2></div><span class="portal-status">' + safe(record.status || "Example only") + '</span></div><div class="submission-task-preview-meta"><p><strong>Job reference:</strong> ' + safe(job) + '</p><p><strong>Assigned to:</strong> ' + safe(assignee) + '</p><p><strong>Due:</strong> ' + safe(due) + '</p><p><strong>Priority:</strong> ' + safe(priority) + '</p></div><div class="submission-task-preview-notes"><strong>Notes</strong><p>' + safe(payload.notes || "Example task for the GMT operational workflow.") + '</p></div>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '') + sourceRecordIdDetail(record) + '</div>';
  }

  function renderEnquiryPreview(record) {
    var messages = Array.isArray(record.messages) ? record.messages : [];
    if (!messages.length && record.message) messages = [{ direction: "inbound", author: record.customer_name || "Customer", body: record.message, at: record.submitted_at || "" }];
    var thread = messages.length ? messages.map(function (message) {
      var outbound = String(message.direction || "inbound").toLowerCase() === "outbound";
      return '<article class="enquiry-thread-message ' + (outbound ? 'is-outbound' : 'is-inbound') + '"><div class="enquiry-thread-message-meta"><strong>' + safe(message.author || (outbound ? "GMT team" : record.customer_name || "Customer")) + '</strong><time datetime="' + safe(message.at || "") + '">' + safe(message.at || "") + '</time></div><p>' + safe(message.body || message.subject || "") + '</p></article>';
    }).join("") : '<p class="small-text">No message body has been filed yet. Open the inbox thread to review the source conversation.</p>';
    var outlookLink = record.conversation_url ? '<p><a class="button button-link" href="' + safe(record.conversation_url) + '" target="_blank" rel="noopener">Open inbox thread</a></p>' : '<p class="small-text">The Outlook conversation link will appear after the Microsoft 365 intake flow links this enquiry.</p>';
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">Customer enquiry</p><h2>' + safe(record.customer_name || "Unnamed customer") + '</h2></div><span class="portal-status">' + safe(record.status || "New") + '</span></div><div class="timesheet-paper-meta"><p><strong>Request:</strong> ' + safe(record.request_type || "General enquiry") + '</p><p><strong>Email:</strong> ' + safe(record.customer_email || "Not provided") + '</p><p><strong>Phone:</strong> ' + safe(record.customer_phone || "Not provided") + '</p><p><strong>Inbox:</strong> ' + safe(record.mailbox || "GMT enquiries inbox") + ' · ' + safe(record.inbox_status || "Awaiting inbox synchronisation") + '</p><p><strong>Thread ID:</strong> ' + safe(record.thread_id || record.conversation_id || "Not linked") + '</p>' + sourceRecordIdDetail(record) + '</div><section class="enquiry-thread" aria-label="Enquiry email thread"><h3>Email thread</h3>' + thread + '</section>' + outlookLink + '<form class="enquiry-reply-form" data-enquiry-reply-form="' + safe(record.source_record_id || "") + '"><label for="enquiry-reply">Add to this thread<textarea id="enquiry-reply" name="reply" rows="4" placeholder="Add an internal note or reply for Accounts to send" required></textarea></label><button type="submit" class="secondary">Save to protected thread</button><p class="small-text" data-enquiry-reply-status role="status">Replies are saved to the protected record. Microsoft 365 inbox sending remains flow-managed.</p></form>';
    var replyForm = preview.querySelector("[data-enquiry-reply-form]");
    if (replyForm) replyForm.addEventListener("submit", function (event) { saveEnquiryReply(event, record); });
  }
  async function saveEnquiryReply(event, record) {
    event.preventDefault();
    var form = event.currentTarget;
    var input = form.querySelector("[name=reply]");
    var feedback = form.querySelector("[data-enquiry-reply-status]");
    var body = String(input && input.value || "").trim();
    if (!body || !window.GMTPortalApi || typeof window.GMTPortalApi.updateRecord !== "function") return;
    var messages = Array.isArray(record.messages) ? record.messages.slice() : [];
    messages.push({ id: "reply-" + Date.now(), direction: "outbound", author: "GMT team", body: body, at: new Date().toISOString() });
    if (feedback) feedback.textContent = "Saving to the protected enquiry thread…";
    form.querySelector("button[type=submit]").disabled = true;
    try {
      await window.GMTPortalApi.updateRecord(record.source_record_id, {
        kind: "enquiries",
        action: "reply_request",
        status: "Reply queued",
        recordDate: record.record_date || "",
        payload: { enquiryId: record.enquiry_id || record.source_record_id, customerName: record.customer_name, customerEmail: record.customer_email, customerPhone: record.customer_phone, requestType: record.request_type, message: record.message, conversationUrl: record.conversation_url, conversationId: record.conversation_id, threadId: record.thread_id, inboxStatus: "Reply queued for Microsoft 365", mailbox: record.mailbox, replyTo: record.reply_to || record.customer_email, messages: messages }
      });
      record.messages = messages;
      record.status = "Reply queued";
      if (input) input.value = "";
      renderEnquiryPreview(record);
      var nextFeedback = preview.querySelector("[data-enquiry-reply-status]");
      if (nextFeedback) nextFeedback.textContent = "Saved. Accounts can send or continue this thread from the linked inbox conversation.";
    } catch (error) {
      if (feedback) feedback.textContent = error && error.message ? error.message : "The reply could not be saved.";
      form.querySelector("button[type=submit]").disabled = false;
    }
  }
  function rowInputValue(container, field) {
    var input = container && container.querySelector('[data-sheet-field="' + field + '"]');
    return input ? String(input.value || "") : "";
  }
  function sheetRowMarkup(row, index, editable, isNew, isOffSchedule) {
    row = row || {};
    var date = rowDate(row);
    var start = rowValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"], "");
    var finish = rowValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], "");
    var breakValue = breakMinutes(row);
    var absence = rowValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"], "NA") || "NA";
    var note = rowValue(row, ["description", "note", "notes", "Note"], "");
    var evidence = row.sourceEvidence && typeof row.sourceEvidence === 'object' ? row.sourceEvidence : null;
    var claims = evidence ? [evidence.claimedBasic,evidence.claimedOt15,evidence.claimedOt20] : [];
    var legacyClaims = evidence && evidence.rateEvidenceVersion !== 1 && claims.some(function(value){return value != null;});
    var evidenceText = evidence ? [evidence.reviewNote, evidence.raw, legacyClaims ? 'Older rate entries need source review' : ''].filter(Boolean).join(' · ') : '';
    function sourceRate(index) {
      var value = claims[index];
      return evidence && evidence.rateEvidenceVersion === 1 && Number.isInteger(value) && value >= 0 && value <= 1440 ? displayHours(value) : '—';
    }
    var totalMinutes = rowTotalMinutes(row);
    var api = payMonthWorkbookApi();
    var provisional = api && api.provisionalForRow && api.provisionalForRow(row);
    var totalLabel = totalMinutes === null ? "—" : displayHours(totalMinutes) + (provisional ? " · provisional" : breakValue === null ? " · break not recorded" : "");
    var disabled = editable ? "" : " disabled";
    var weekend = date && [0, 6].indexOf(new Date(date + 'T12:00:00Z').getUTCDay()) !== -1;
    return '<tr data-sheet-row="' + index + '"' + (isNew ? ' data-new-row="true"' : '') + (isOffSchedule ? ' data-off-schedule="true"' : '') + ' class="' + (editable ? '' : 'is-read-only ') + (weekend ? 'is-weekend ' : '') + (isOffSchedule ? 'is-off-schedule' : '') + '">'
      + '<td data-label="Date"><input data-sheet-field="date" type="date" value="' + safe(date) + '"' + disabled + '>' + (isOffSchedule ? '<small class="pay-month-off-schedule">Outside configured workdays</small>' : '') + '</td>'
      + '<td data-label="Start"><input data-sheet-field="start" type="time" value="' + safe(start) + '"' + disabled + '></td>'
      + '<td data-label="Finish"><input data-sheet-field="finish" type="time" value="' + safe(finish) + '"' + disabled + '></td>'
      + '<td data-label="Break"><input data-sheet-field="break" type="number" min="0" max="1440" step="1" inputmode="numeric" aria-label="Break minutes" placeholder="—" value="' + (breakValue === null ? '' : safe(breakValue)) + '"' + disabled + '></td>'
      + '<td data-label="Absence"><select data-sheet-field="absence"' + disabled + '><option value="NA"' + (absence === 'NA' ? ' selected' : '') + '>NA</option><option value="Sick"' + (absence === 'Sick' ? ' selected' : '') + '>Sick</option><option value="Holiday"' + (absence === 'Holiday' ? ' selected' : '') + '>Holiday</option><option value="Absent"' + (absence === 'Absent' ? ' selected' : '') + '>Absent</option><option value="Time Off"' + (absence === 'Time Off' ? ' selected' : '') + '>Time Off</option><option value="Un-Paid"' + (/^un-paid$/i.test(absence) ? ' selected' : '') + '>Un-Paid</option></select></td>'
      + '<td data-label="Total hours"><span class="pay-month-row-hours">' + safe(totalLabel) + '</span></td>'
      + '<td data-label="Notes"><input data-sheet-field="note" type="text" value="' + safe(note) + '" placeholder="Optional note"' + disabled + '>' + (evidenceText ? '<details><summary>Source details</summary><p>' + safe(evidenceText) + '</p></details>' : '') + '</td>'
      + '<td data-label="Source basic hours" data-source-rate="basic">' + safe(sourceRate(0)) + '</td>'
      + '<td data-label="Source overtime 1.5× hours" data-source-rate="ot15">' + safe(sourceRate(1)) + '</td>'
      + '<td data-label="Source overtime 2× hours" data-source-rate="ot20">' + safe(sourceRate(2)) + '</td>'
      + '<td data-label="Actions">' + (editable ? '<button type="button" class="secondary pay-month-remove-day" data-remove-day>Remove day</button>' : '') + '</td></tr>';
  }
  function renderPayMonthSheet(sheet) {
    selectedSheet = sheet;
    if (!preview || !sheet) return;
    var latest = sheet.records.slice().sort(function (left, right) { return recordUpdated(right) - recordUpdated(left); })[0] || {};
    var latestPayload = payloadFor(latest);
    var editNotice = latestPayload.editNote || (latestPayload.editNotification && latestPayload.editNotification.message) || "";
    var editable = sheet.canEdit === true;
    var unrecordedBreaks = sheet.rows.filter(function (item) { return breakMinutes(item.row) === null && rowTotalMinutes(item.row) !== null; }).length;
    var provisionalTotals = sheet.rows.filter(function (item) { var api = payMonthWorkbookApi(); return api && api.provisionalForRow && api.provisionalForRow(item.row); }).length;
    var editorRows = (editable && Array.isArray(sheet.reviewRows) ? sheet.reviewRows : sheet.rows).slice();
    if(editable && stagedTimesheet && stagedTimesheet.key===sheet.key)editorRows=editorRows.concat(stagedTimesheet.rows);
    var visibleRows = selectedDay ? editorRows.filter(function (item) { return item.date === selectedDay; }) : editorRows;
    var rows = visibleRows.map(function (item) { return sheetRowMarkup(item.row, editorRows.indexOf(item), editable, item.staged===true, item.scheduled === false); }).join("");
    var offScheduleCount = editable ? editorRows.filter(function (item) { return item.scheduled === false; }).length : 0;
    var offScheduleNote = offScheduleCount ? '<p class="pay-month-edit-note" data-off-schedule-note>' + offScheduleCount + ' row(s) fall outside the configured workdays and are excluded from calendar and pay-month totals. Remove any row that should not be on this timesheet.</p>' : '';
    var roster = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    var employeeSchedule = roster.find(function (entry) { return String(entry.employee_upn || "").toLowerCase() === String(sheet.employeeUpn || "").toLowerCase(); });
    var sheetPeriod = window.GMTPayPeriods && window.GMTPayPeriods.periodForMonth ? window.GMTPayPeriods.periodForMonth(sheet.payMonth) : null;
    var payrollFriday = sheetPeriod && (sheetPeriod.payrollFriday || sheetPeriod.payrollEnd || sheetPeriod.end) || "";
    var coverage = window.GMTTimesheetCoverage && window.GMTTimesheetCoverage.summarize({ period: window.GMTPayPeriods && window.GMTPayPeriods.periodForMonth(sheet.payMonth), employeeEmail: sheet.employeeUpn, records: [], submittedRows: sheet.rows.map(function (item) { return item.row; }), workdays: employeeSchedule && employeeSchedule.schedule_weekdays });
    var coverageNote = "";
    if (coverage) {
      var completed = coverage.recorded.length + coverage.absent.length;
      var outstanding = coverage.overdue.concat(coverage.upcoming);
      coverageNote = '<details class="pay-month-edit-note" data-pay-month-coverage><summary>' + completed + ' of ' + coverage.expected.length + ' scheduled days recorded or explained' + (outstanding.length ? ' · ' + outstanding.length + ' need attention' : ' · complete') + '</summary><p>' + (outstanding.length ? 'Still needing an entry or a user-entered absence reason: ' + safe(outstanding.join(', ')) + '. ' : '') + 'Missing days are never marked absent automatically.</p></details>';
    }
    preview.innerHTML = '<div class="pay-month-sheet-preview"><div class="timesheet-paper-header"><div><p class="portal-card-kicker">' + safe(monthLabel(sheet.payMonth)) + '</p><h2>' + safe(sheet.employeeName) + '</h2><p class="small-text">' + safe(sheet.employeeUpn) + ' · ' + editorRows.length + ' daily row' + (editorRows.length === 1 ? '' : 's') + '</p></div><span class="portal-status ' + (editable ? 'approved' : 'pending') + '">' + (editable ? 'Editable' : 'Read only') + '</span></div><div class="timesheet-paper-meta"><p><strong>Pay month:</strong> ' + safe(sheet.payMonth) + '</p><p><strong>Cycle start:</strong> ' + safe(sheetPeriod && sheetPeriod.start || '') + '</p><p><strong>Cycle end:</strong> ' + safe(sheetPeriod && sheetPeriod.cycleEnd || '') + '</p><p><strong>Payroll Friday:</strong> ' + safe(payrollFriday) + '</p><p><strong>Month total hours:</strong> ' + safe(displayHours(sheet.totals.workedActual)) + '</p><p><strong>Updated:</strong> ' + safe(latest.updated_at || latest.submitted_at || 'Not recorded') + '</p></div>' + (selectedDay ? '<p class="small-text">Showing entries for ' + safe(selectedDay) + '. Month total remains for the full pay month.</p>' : '') + offScheduleNote + coverageNote + (editNotice ? '<p class="pay-month-edit-note"><strong>Change note:</strong> ' + safe(editNotice) + '</p>' : '') + (unrecordedBreaks ? '<p class="pay-month-edit-note">' + unrecordedBreaks + ' row(s) have no recorded break. ' + provisionalTotals + ' total(s) show elapsed time before any break deduction and need review.</p>' : '') + '<form data-pay-month-edit-form><div class="pay-month-table-scroll"><table class="timesheet-paper-rows pay-month-edit-table"><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Break</th><th>Absence</th><th>Total hours</th><th>Notes</th><th>Source basic hours</th><th>Source overtime 1.5× hours</th><th>Source overtime 2× hours</th><th>Actions</th></tr></thead><tbody>' + (rows || '<tr><td colspan="11">' + (selectedDay ? 'No daily rows are available for this day.' : 'No daily rows are available.') + '</td></tr>') + '</tbody></table></div><div class="pay-month-sheet-total"><span>Pay month total</span><strong data-pay-month-total-hours>' + safe(displayHours(sheet.totals.workedActual)) + '</strong></div><div class="pay-month-edit-actions">' + (editable ? '<button type="button" class="secondary" data-add-day>Add day</button><button type="submit">Save changes</button>' : '<span class="small-text">This pay month is read-only for your account.</span>') + '<button type="button" class="secondary pay-month-download" data-pay-month-download>Download full pay-month spreadsheet</button><span class="small-text pay-month-download-status" data-pay-month-download-status role="status"></span><div class="pay-month-save-progress" data-pay-month-save-progress hidden><span data-save-progress-label>Saving changes…</span><progress max="100" aria-label="Pay-month save progress"></progress></div><span class="small-text" data-pay-month-save-status role="status"></span></div></form></div>';
    if (sheet.conflictingDays && sheet.conflictingDays.length) {
      var conflictNotice=document.createElement('p');conflictNotice.className='pay-month-edit-note';conflictNotice.setAttribute('role','alert');
      conflictNotice.textContent='Conflicting entries need review for: '+sheet.conflictingDays.join(', ')+'. Totals and downloads are unavailable until the conflict is resolved.';
      preview.querySelector('.pay-month-sheet-preview').prepend(conflictNotice);
      preview.querySelectorAll('.timesheet-paper-meta p').forEach(function(item){if(item.textContent.indexOf('Month total hours:')===0)item.textContent='Month total hours: Needs review';});
      preview.querySelector('[data-pay-month-total-hours]').textContent='Needs review';
      preview.querySelector('[data-pay-month-download]').disabled=true;
    }
    var form = preview.querySelector("[data-pay-month-edit-form]");
    if(stagedTimesheet && stagedTimesheet.key===sheet.key) {
      var discard=document.createElement('button');discard.type='button';discard.className='secondary';discard.textContent='Discard uploaded days';
      discard.addEventListener('click',function(){editorRows.forEach(function(item){if(item.staged)item.removed=true;});form.querySelectorAll('[data-new-row="true"]').forEach(function(row){var item=editorRows[Number(row.getAttribute('data-sheet-row'))];if(item?.staged)row.remove();});stagedTimesheet=null;document.dispatchEvent(new CustomEvent('gmt:upload-stage-cleared'));discard.remove();recalculate();});
      form.querySelector('.pay-month-edit-actions').append(discard);
    }
    var targetDay = requestedDay();
    if (targetDay && requestedRecordId() && sheet.records.some(function (record) { return recordId(record) === requestedRecordId(); })) {
      form.querySelectorAll("[data-sheet-row]").forEach(function (row) {
        if (rowInputValue(row, "date") === targetDay) row.classList.add("is-target-day");
      });
    }
    if (form && editable) form.addEventListener("submit", function (event) { savePayMonthSheet(event, sheet, editorRows); });
    var downloadButton = preview.querySelector("[data-pay-month-download]");
    if (downloadButton) downloadButton.addEventListener("click", function () { downloadPayMonthSheet(sheet, preview.querySelector("[data-pay-month-download-status]"), downloadButton); });
    var savedCorrection=sheet.records.find(function(record){return String(record.action||'')==='pay_month_correction';});
    var savedPayload=payloadFor(savedCorrection);
    if((window.GMT_APP_CONFIG||{}).privateTimesheetOriginals===true && savedCorrection && recordId(savedCorrection) && !(stagedTimesheet && stagedTimesheet.key===sheet.key) && !sheet.conflictingDays?.length && Array.isArray(savedPayload.rows) && savedPayload.rows.some(function(row){return /^[a-f0-9]{64}$/.test(String(row?.sourceEvidence?.sourceId||''));}) && typeof window.GMTPortalApi?.access==='function' && typeof window.GMTPortalApi?.request==='function'){
      window.GMTPortalApi.access().then(function(access){
        if(access?.canReviewPrivateTimesheetOriginals!==true || selectedSheet!==sheet || !form.isConnected)return;
        var prepare=document.createElement('button'),message=document.createElement('span');prepare.type='button';prepare.className='secondary';prepare.textContent='Prepare held workbook';message.className='small-text';message.setAttribute('role','status');message.textContent='Uses saved days; delivery remains on hold.';
        form.querySelector('.pay-month-edit-actions').append(prepare,message);
        prepare.addEventListener('click',async function(){
          if(prepare.disabled)return;prepare.disabled=true;message.textContent='Preparing saved days; delivery remains on hold…';
          try{
            var period=window.GMTPayPeriods.periodForMonth(sheet.payMonth),result=await queuePayMonthWorkbook(recordId(savedCorrection),sheet,savedPayload,period,{prepareHeld:true});
            if(result?.recordId!==recordId(savedCorrection)||result.status!=='held'||result.deliveryReleased!==false)throw new Error('The held workbook could not be confirmed.');
            message.textContent='Workbook prepared from saved days and held. Source and delivery checks are still required.';
          }catch(error){message.textContent=error?.message||'The workbook could not be prepared. Delivery remains on hold.';}finally{prepare.disabled=false;}
        });
      }).catch(function(){});
    }
    if (form) {
      var addDayButton = form.querySelector("[data-add-day]");
      var recalculate = function () {
        var rowOverrides = Object.create(null);
        form.querySelectorAll("[data-sheet-row]").forEach(function (entry) {
          var rowIndex = Number(entry.getAttribute("data-sheet-row"));
          if (entry.dataset.removed === "true") {
            rowOverrides[rowIndex] = null;
            return;
          }
          var originalItem = editorRows[rowIndex];
          var original = originalItem && originalItem.row || {};
          var start = rowInputValue(entry, "start");
          var finish = rowInputValue(entry, "finish");
          var pause = rowInputValue(entry, "break");
          var unchanged = start === String(rowValue(original, ["start", "startTime", "start_time", "clockIn", "clock_in"], ""))
            && finish === String(rowValue(original, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], ""))
            && (pause === "" ? null : Number(pause)) === breakMinutes(original)
            && rowInputValue(entry, "absence") === String(rowValue(original, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"], "NA") || "NA");
          var live = unchanged ? original : { start: start, finish: finish, lunchMinutes: pause === "" ? null : Number(pause), absenceStatus: rowInputValue(entry, "absence") };
          rowOverrides[rowIndex] = live;
          var minutes = rowTotalMinutes(live);
          var api = payMonthWorkbookApi();
          var provisional = api && api.provisionalForRow && api.provisionalForRow(live);
          var hours = entry.querySelector(".pay-month-row-hours");
          if (hours) hours.textContent = minutes === null ? "—" : displayHours(minutes) + (provisional ? " · provisional" : breakMinutes(live) === null ? " · break not recorded" : "");
        });
        var total = 0;
        editorRows.forEach(function (item, index) {
          if(item.removed) return;
          var live = Object.prototype.hasOwnProperty.call(rowOverrides, index) ? rowOverrides[index] : item.row;
          if (!live || item.scheduled === false) return;
          var minutes = rowTotalMinutes(live);
          if (minutes !== null) total += minutes;
        });
        form.querySelectorAll("[data-new-row]").forEach(function (entry) {
          if (Number(entry.getAttribute('data-sheet-row')) < editorRows.length) return;
          if (entry.dataset.removed === "true") return;
          var live = {
            start: rowInputValue(entry, "start"),
            finish: rowInputValue(entry, "finish"),
            lunchMinutes: rowInputValue(entry, "break") === "" ? null : Number(rowInputValue(entry, "break")),
            absenceStatus: rowInputValue(entry, "absence")
          };
          var minutes = rowTotalMinutes(live);
          if (minutes !== null) total += minutes;
          var hours = entry.querySelector(".pay-month-row-hours");
          if (hours) hours.textContent = minutes === null ? "—" : displayHours(minutes) + (breakMinutes(live) === null ? " · break not recorded" : "");
        });
        var footer = form.querySelector("[data-pay-month-total-hours]");
        if (footer) footer.textContent = displayHours(total);
        preview.querySelectorAll('.timesheet-paper-meta p').forEach(function(item){if(item.textContent.indexOf('Month total hours:')===0)item.innerHTML='<strong>Month total hours:</strong> '+safe(displayHours(total));});
      };
      form.addEventListener("input", function (event) { if (event.target.closest("[data-sheet-row]")) recalculate(); });
      form.addEventListener("change", function (event) {
        var row = event.target.closest("[data-sheet-row]");
        if (!row) return;
        var date = rowInputValue(row, "date");
        row.classList.toggle("is-weekend", /^\d{4}-\d{2}-\d{2}$/.test(date) && [0, 6].indexOf(new Date(date + 'T12:00:00Z').getUTCDay()) !== -1);
        recalculate();
      });
      if (addDayButton) addDayButton.addEventListener("click", function () {
        var tbody = form.querySelector("tbody");
        var next = editorRows.length + form.querySelectorAll("[data-new-row]").length;
        if (tbody.querySelector('td[colspan]')) tbody.innerHTML = "";
        tbody.insertAdjacentHTML("beforeend", sheetRowMarkup({}, next, true, true));
        var addedDate = tbody.lastElementChild.querySelector('[data-sheet-field="date"]');
        if (addedDate) addedDate.focus();
      });
      form.addEventListener("click", function (event) {
        var remove = event.target.closest("[data-remove-day]");
        if (remove) {
          var row = remove.closest("[data-sheet-row]");
          if (row.dataset.newRow === "true") {var item=editorRows[Number(row.getAttribute('data-sheet-row'))];if(item?.staged){item.removed=true;stagedTimesheet.rows=stagedTimesheet.rows.filter(function(entry){return entry!==item;});document.dispatchEvent(new CustomEvent('gmt:upload-stage-cleared',{detail:{sourceId:item.row.sourceEvidence?.sourceId,date:item.date}}));}row.remove();}
          else {
            var removed = row.dataset.removed !== "true";
            row.dataset.removed = String(removed);
            row.classList.toggle("is-removed", removed);
            row.querySelectorAll("[data-sheet-field]").forEach(function (field) { field.disabled = removed; });
            remove.textContent = removed ? "Undo remove" : "Remove day";
          }
          recalculate();
        }
      });
      if (stagedTimesheet && stagedTimesheet.key===sheet.key && !(sheet.conflictingDays && sheet.conflictingDays.length)) recalculate();
    }
  }

  function safeFilePart(value, fallback) {
    return String(value || fallback || "Employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || fallback || "Employee";
  }
  async function createPayMonthWorkbook(sheet, excel) {
    if (sheet.conflictingDays && sheet.conflictingDays.length) throw new Error('Conflicting timesheet entries need review before downloading a workbook.');
    var api = payMonthWorkbookApi();
    if (!api) throw new Error("The full workbook exporter is unavailable. Refresh and try again.");
    if (!excel || !excel.utils || typeof excel.write !== "function") throw new Error("The Excel generator could not be loaded.");
    var period = window.GMTPayPeriods && typeof window.GMTPayPeriods.periodForMonth === "function"
      ? window.GMTPayPeriods.periodForMonth(sheet.payMonth) : null;
    var prepared = api.toWorkbookMatrices(sheet, period, {includeSourceRates:true});
    var workbook = excel.utils.book_new();
    function workbookSheet(matrix, widths) {
      var result = excel.utils.aoa_to_sheet(matrix);
      result["!cols"] = widths.map(function (width) { return { wch: width }; });
      result["!autofilter"] = { ref: "A1:" + excel.utils.encode_cell({ r: Math.max(0, matrix.length - 1), c: matrix[0].length - 1 }) };
      return result;
    }
    excel.utils.book_append_sheet(workbook, workbookSheet(prepared.dailyMatrix, [14, 9, 9, 10, 14, 13, 60, 20, 25, 23]), "Daily Entries");
    excel.utils.book_append_sheet(workbook, workbookSheet(prepared.weeklyMatrix, [16, 16, 15]), "Weekly Totals");
    var array = excel.write(workbook, { bookType: "xlsx", type: "array" });
    var fileName = "GMT Timesheet - " + safeFilePart(sheet.employeeName, "Employee") + " - Pay Month " + (sheet.payMonth || "unspecified") + ".xlsx";
    return { array: array, fileName: fileName, rowCount: prepared.data.dailyEntries.length };
  }
  function triggerDownload(data, mimeType) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([data], { type: mimeType }));
    return link;
  }
  function saveDownload(data, fileName, mimeType) {
    var link = triggerDownload(data, mimeType);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  async function downloadPayMonthSheet(sheet, feedback, button) {
    if (!sheet) return;
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = "Preparing the full authorised pay-month workbook…";
    try {
      var excel = typeof window.ensureXlsxLoaded === "function" ? await window.ensureXlsxLoaded() : window.XLSX;
      var prepared = await createPayMonthWorkbook(sheet, excel);
      saveDownload(prepared.array, prepared.fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (feedback) feedback.textContent = "Full workbook downloaded: " + prepared.rowCount + " authorised daily row" + (prepared.rowCount === 1 ? "" : "s") + ".";
    } catch (error) {
      if (feedback) feedback.textContent = error && error.message ? error.message : "The full workbook could not be downloaded.";
    } finally {
      if (button) button.disabled = false;
    }
  }
  var sheetDownloadGroups = {
    engineer: { label: "Engineer", archiveName: "Engineer.zip" },
    accounts: { label: "Accounts", archiveName: "Accounts.zip" },
    contractor: { label: "Contractor", archiveName: "Contractor.zip" }
  };
  function downloadGroupForSheet(sheet) {
    var upn = String(sheet && sheet.employeeUpn || "").trim().toLowerCase();
    var name = String(sheet && sheet.employeeName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (upn === "faith.b@gmt-services.co.uk" || upn === "amanda.bb@gmtelectservsltd.onmicrosoft.com"
      || upn === "accounts@gmt-services.co.uk" || upn === "acc.gmtelect@outlook.com"
      || upn === "acc.gmtelect@gmt-services.co.uk" || /^(faith|amanda)$/.test(name)) return "";
    if (upn === "micheller.admin@gmt-services.co.uk" || upn === "lidiaa.admin@gmt-services.co.uk"
      || /\b(michelle|lidia)\b/.test(name)) return "accounts";
    if (/\bdjamel\b/.test(name) || /^djamel(?:[._-]|@)/.test(upn)) return "contractor";
    if (!upn && (!name || name === "gmt staff" || name === "unknown employee")) return "";
    // Engineering is the default for the workshop roster (including new
    // engineer identities), while Accounts and contractor identities are
    // assigned explicitly above.
    return "engineer";
  }
  function renderDownloadGroupButtons(sheets) {
    downloadGroupButtons.forEach(function (button) {
      var group = button.getAttribute("data-download-sheet-group");
      button.hidden = currentTab !== "timesheets" || !sheets.some(function (sheet) { return downloadGroupForSheet(sheet) === group; });
    });
    if (downloadGroupStatus) downloadGroupStatus.textContent = "";
  }
  async function downloadPayMonthGroup(groupKey, button) {
    var group = sheetDownloadGroups[groupKey];
    var sheets = filteredSheets().filter(function (sheet) { return downloadGroupForSheet(sheet) === groupKey; });
    if (!group || !sheets.length) {
      if (downloadGroupStatus) downloadGroupStatus.textContent = "No authorised " + (group ? group.label : "") + " sheets match the current filters.";
      return;
    }
    if (!window.GMTZipStore || typeof window.GMTZipStore.createZip !== "function") {
      if (downloadGroupStatus) downloadGroupStatus.textContent = "ZIP downloads are unavailable. Refresh and try again.";
      return;
    }
    button.disabled = true;
    if (downloadGroupStatus) downloadGroupStatus.textContent = "Preparing " + sheets.length + " authorised " + group.label + " workbook" + (sheets.length === 1 ? "" : "s") + "…";
    try {
      var excel = typeof window.ensureXlsxLoaded === "function" ? await window.ensureXlsxLoaded() : window.XLSX;
      var files = [];
      for (var i = 0; i < sheets.length; i += 1) {
        var prepared = await createPayMonthWorkbook(sheets[i], excel);
        files.push({ name: prepared.fileName, data: prepared.array });
      }
      var zip = window.GMTZipStore.createZip(files);
      saveDownload(zip, group.archiveName, "application/zip");
      if (downloadGroupStatus) downloadGroupStatus.textContent = group.archiveName + " downloaded with " + sheets.length + " authorised pay-month workbook" + (sheets.length === 1 ? "" : "s") + ".";
    } catch (error) {
      if (downloadGroupStatus) downloadGroupStatus.textContent = error && error.message ? error.message : "The workbook ZIP could not be downloaded.";
    } finally {
      button.disabled = false;
    }
  }
  function updatePayloadRow(row, values) {
    var next = Object.assign({}, row);
    // A newly edited row has its own Date. Source-date override metadata
    // belongs to the historical import and must not undo the user's change.
    ["sourceDate", "source_date", "originalDate", "original_date", "legacyAlignedDate"].forEach(function (key) { delete next[key]; });
    next.date = values.date;
    next.start = values.start;
    next.finish = values.finish;
    next.lunchHad = values.breakMinutes === null ? null : values.breakMinutes > 0;
    next.lunchMinutes = values.breakMinutes;
    var timeChanged = String(rowValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"], "")) !== values.start
      || String(rowValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], "")) !== values.finish;
    if (values.breakMinutes === null && timeChanged) { next.workedMinutes = null; next.workedHours = null; }
    next.absenceStatus = values.absence;
    next.description = values.note;
    var metrics = rowMetrics(next);
    if (/^un-paid$/i.test(values.absence)) {
      if (next.reportedWorkedMinutes === undefined && next.workedMinutes !== undefined) next.reportedWorkedMinutes = next.workedMinutes;
      if (next.reportedWorkedHours === undefined && next.workedHours !== undefined) next.reportedWorkedHours = next.workedHours;
      next.workedMinutes = 0;
      next.workedHours = 0;
      next.workedActual = 0;
      next.total = 0;
      next.appliedTotal = 0;
      next.appliedBasic = 0;
      next.appliedOt15 = 0;
      next.appliedOt20 = 0;
    } else {
      next.workedMinutes = values.breakMinutes === null ? next.workedMinutes : metrics.workedActual;
      next.workedHours = values.breakMinutes === null ? next.workedHours : Number((metrics.workedActual / 60).toFixed(2));
    }
    next.basicHours = Number((metrics.basic / 60).toFixed(2));
    next.ot15Hours = Number((metrics.ot15 / 60).toFixed(2));
    next.ot20Hours = Number((metrics.ot20 / 60).toFixed(2));
    next.weightedHours = Number(((metrics.basic / 60) + (metrics.ot15 / 60) * 1.5 + (metrics.ot20 / 60) * 2).toFixed(2));
    return next;
  }
  function ajaxFormSubmitEndpoint(value) {
    var endpoint = String(value || "").trim();
    return /^https:\/\/formsubmit\.co\/ajax\//i.test(endpoint) ? endpoint : endpoint.replace(/^https:\/\/formsubmit\.co\//i, "https://formsubmit.co/ajax/");
  }
  async function queuePayMonthWorkbook(recordIdValue, sheet, payload, period, options) {
    var api = payMonthWorkbookApi();
    var prepareHeld=options?.prepareHeld===true;
    if (!api || !window.GMTPortalApi || (prepareHeld ? typeof window.GMTPortalApi.request!=="function" : typeof window.GMTPortalApi.queueAttachments!=="function")) throw new Error("The Accounts workbook queue is unavailable.");
    var excel = typeof window.ensureXlsxLoaded === "function" ? await window.ensureXlsxLoaded() : window.XLSX;
    if (!excel || !excel.utils || typeof excel.write !== "function") throw new Error("The Excel generator is unavailable.");
    var rowsByDate = {};
    (Array.isArray(sheet.reviewRows) ? sheet.reviewRows : sheet.rows).forEach(function (item) { if (item && item.date) rowsByDate[item.date] = item.row; });
    (payload.rows || []).forEach(function (row) { var date = rowDate(row); if (date) rowsByDate[date] = row; });
    (payload.deletedDays || []).forEach(function (date) { delete rowsByDate[date]; });
    var canonical = { rows: Object.keys(rowsByDate).sort().map(function (date) { return { row: rowsByDate[date] }; }) };
    var includeSourceRates = prepareHeld || (window.GMT_APP_CONFIG || {}).timesheetSourceRateColumns === true;
    var prepared = api.toWorkbookMatrices(canonical, period, {includeSourceRates:includeSourceRates});
    var workbook = excel.utils.book_new();
    excel.utils.book_append_sheet(workbook, excel.utils.aoa_to_sheet(prepared.dailyMatrix), "Daily Entries");
    excel.utils.book_append_sheet(workbook, excel.utils.aoa_to_sheet(prepared.weeklyMatrix), "Weekly Totals");
    var stem = "GMT Timesheet - " + String(sheet.employeeName || "Employee").replace(/[^a-z0-9]+/gi, "-") + " - Pay Month " + sheet.payMonth;
    var xlsx = new File([excel.write(workbook, { bookType: "xlsx", type: "array" })], stem + ".xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var csvText = prepared.dailyMatrix.map(function (row) { return row.map(function (value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var csv = new File([csvText], stem + ".csv", { type: "text/csv" });
    var changedDates = {};
    (payload.rows || []).forEach(function (row) { var date = rowDate(row); if (date) changedDates[date] = true; });
    var recordEnvelope = {
      schemaVersion: includeSourceRates ? 3 : 2,
      mode: "replace-pay-month",
      recordId: recordIdValue,
      submissionId: recordIdValue,
      employeeName: sheet.employeeName,
      employeeEmail: sheet.employeeUpn,
      employeeUpn: sheet.employeeUpn,
      payMonth: sheet.payMonth,
      weekStart: period.start,
      weekEnd: period.cycleEnd || period.end,
      cycleStart: period.start,
      cycleEnd: period.cycleEnd || period.end,
      payrollFriday: period.payrollFriday || period.payrollEnd || period.end,
      submittedAt: payload.editedAt || new Date().toISOString(),
      editedBy: payload.editedBy || "",
      deletedDays: (payload.deletedDays || []).slice(),
      rows: prepared.data.dailyEntries.map(function (entry) {
        var minutes = entry["Total hours"];
        var deliveredRow = {
          recordId: recordIdValue + "|" + entry.Date,
          date: entry.Date,
          startTime: entry.Start,
          finishTime: entry.Finish,
          breakMinutes: entry.Break,
          absenceReason: entry.Absence,
          totalMinutes: minutes,
          workedHours: minutes === "" ? "" : Number((minutes / 60).toFixed(4)),
          note: entry.Notes,
          changeNote: changedDates[entry.Date] ? "Edited by " + (payload.editedBy || "Accounts") + " at " + (payload.editedAt || "unknown time") : ""
        };
        if (includeSourceRates) {
          deliveredRow.sourceBasicMinutes = entry["Source basic hours"] === "" ? null : entry["Source basic hours"];
          deliveredRow.sourceOt15Minutes = entry["Source overtime 1.5× hours"] === "" ? null : entry["Source overtime 1.5× hours"];
          deliveredRow.sourceOt20Minutes = entry["Source overtime 2× hours"] === "" ? null : entry["Source overtime 2× hours"];
        }
        return deliveredRow;
      })
    };
    var recordFile = new File([JSON.stringify(recordEnvelope)], "GMT Timesheet Record - " + String(sheet.employeeName || "Employee").replace(/[^a-z0-9]+/gi, "-") + " - Pay Month " + sheet.payMonth + ".json", { type: "application/json" });
    async function encode(file, fieldName) {
      var bytes = new Uint8Array(await file.arrayBuffer());
      var binary = "";
      for (var index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
      return { fieldName: fieldName, fileName: file.name, contentType: file.type, sizeBytes: file.size, contentBase64: btoa(binary) };
    }
    var attachments=await Promise.all([encode(xlsx, "attachment"), encode(csv, "attachment_csv"), encode(recordFile, "attachment_record")]);
    if(prepareHeld)return window.GMTPortalApi.request('/api/admin/private-timesheet-original-review/prepare-queue',{method:'POST',body:{recordId:recordIdValue,attachments:attachments}});
    return window.GMTPortalApi.queueAttachments(recordIdValue,attachments);
  }
  function portalEditorLabel() {
    try {
      var profile = JSON.parse(localStorage.getItem("gmt.portal.profile.v1") || "{}");
      return String(profile.name || profile.username || profile.notificationEmail || "Signed-in GMT user").trim();
    } catch (_) { return "Signed-in GMT user"; }
  }
  async function sendTimesheetChangeEmail(record, payload, payMonth, changedRows) {
    var config = window.GMT_APP_CONFIG || {};
    var endpoint = ajaxFormSubmitEndpoint(config.timesheetFormSubmitEndpoint || config.formSubmitTimesheetEndpoint || config.fallbackFormSubmitEndpoint);
    if (!endpoint || !record || !changedRows || !changedRows.length) throw new Error("Timesheet update email is not configured.");
    var form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint;
    var add = function (name, value) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value == null ? "" : String(value);
      form.appendChild(input);
    };
    var employee = String(record.employee_name || record.employee_upn || "GMT employee").trim();
    var editor = portalEditorLabel();
    var changedAt = new Date().toISOString();
    var period = window.GMTPayPeriods && window.GMTPayPeriods.periodForMonth ? window.GMTPayPeriods.periodForMonth(payMonth) : null;
    add("_subject", "[GMT][TIMESHEET][UPDATE] " + employee + " | Pay month " + payMonth);
    add("_template", "box");
    add("_captcha", "false");
    add("_url", window.location.href);
    var recipients = [config.formSubmitCc, record.employee_upn].map(function (value) { return String(value || "").trim(); }).filter(function (value, index, values) { return value && values.indexOf(value) === index; });
    if (recipients.length) add("_cc", recipients.join(","));
    add("submission_type", "Timesheet update");
    add("gmt_type", "timesheet");
    add("gmt_action", "update");
    add("gmt_record_id", recordId(record));
    add("gmt_employee", employee);
    add("gmt_employee_email", record.employee_upn || "");
    add("gmt_pay_month", payMonth || "");
    add("gmt_cycle_start", payload.cycleStart || period && period.start || "");
    add("gmt_cycle_end", payload.cycleEnd || period && (period.cycleEnd || period.end) || "");
    add("gmt_payroll_friday", payload.payrollFriday || period && (period.payrollFriday || period.payrollEnd || period.end) || "");
    add("gmt_changed_dates", changedRows.map(function (item) { return item.values && item.values.date || ""; }).filter(Boolean).join(", "));
    add("gmt_edited_by", editor);
    add("gmt_edited_at", changedAt);
    add("gmt_edit_note", "Edited on behalf of " + employee + " by " + editor + ".");
    add("gmt_changed_rows", JSON.stringify(changedRows.map(function (item) { return item.values; })));
    add("updated_at", changedAt);
    var roster = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    var employeeSchedule = roster.find(function (entry) { return String(entry.employee_upn || "").toLowerCase() === String(record.employee_upn || "").toLowerCase(); });
    var coverage = window.GMTTimesheetCoverage && window.GMTTimesheetCoverage.summarize({
      period: window.GMTPayPeriods && window.GMTPayPeriods.periodForMonth(payMonth),
      employeeEmail: record.employee_upn,
      records: records,
      submittedRows: payload.rows || [],
      workdays: employeeSchedule && employeeSchedule.schedule_weekdays
    });
    var remaining = window.GMTTimesheetCoverage ? window.GMTTimesheetCoverage.receiptText(coverage) : "Open Submitted documents to review your remaining days.";
    var submittedDetail = changedRows.map(function (item) {
      var value = item.values || {};
      if (value.deleted) return value.date + ": day removed";
      var hours = value.start && value.finish ? value.start + "–" + value.finish : "no complete clock times";
      var pause = value.breakMinutes == null ? "break not recorded" : value.breakMinutes + " minute break";
      return value.date + ": " + hours + ", " + pause + (value.absence && value.absence !== "NA" ? ", " + value.absence : "");
    }).join("; ");
    add("summary", "Updated: " + submittedDetail + ". " + remaining);
    add("message", "Timesheet correction for " + employee + " by " + editor + ". Updated: " + submittedDetail + ". " + remaining);
    var response = await fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
    var body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || (body && (body.success === false || body.success === "false"))) throw new Error("Timesheet was saved, but its email receipt was not accepted. Please retry notification from Accounts.");
    return true;
  }
  function correctionRecordId(sheet) {
    var email = String(sheet.employeeUpn || "").trim().toLowerCase();
    if (!email) throw new Error("This sheet needs a verified employee email before it can be changed.");
    var encoded = Array.prototype.map.call(email, function (character) { return character.charCodeAt(0).toString(16).padStart(2, "0"); }).join("");
    return "gmt-paymonth-" + sheet.payMonth + "-" + encoded;
  }
  async function savePayMonthSheet(event, sheet, editorRows) {
    event.preventDefault();
    var form = event.currentTarget;
    var feedback = form.querySelector("[data-pay-month-save-status]");
    var progressPanel = form.querySelector("[data-pay-month-save-progress]");
    var progressLabel = form.querySelector("[data-save-progress-label]");
    var progress = progressPanel && progressPanel.querySelector("progress");
    var portalRecordSaved = false;
    var setProgress = function (label, value) {
      if (progressPanel) progressPanel.hidden = false;
      if (progressLabel) progressLabel.textContent = label;
      if (progress) progress.value = value;
    };
    var button = form.querySelector('button[type="submit"]');
    if(form.dataset.saving==='true')return;
    form.dataset.saving='true';form.inert=true;if(button)button.disabled=true;
    try {
      if (!sheet.canEdit) throw new Error("This pay month is read-only for your account.");
      if (!window.GMTPortalApi || typeof window.GMTPortalApi.saveRecord !== "function") throw new Error("Protected editing is not connected.");
      var existing = sheet.records.find(function (record) { return String(record.action || "") === "pay_month_correction"; });
      var previous = payloadFor(existing);
      var corrected = {};
      (Array.isArray(previous.rows) ? previous.rows : []).forEach(function (row) { var date = rowDate(row); if (date) corrected[date] = Object.assign({}, row); });
      var deleted = {};
      (Array.isArray(previous.deletedDays) ? previous.deletedDays : []).forEach(function (date) { deleted[date] = true; });
      var seen = {};
      var changedRows = [];
      form.querySelectorAll("[data-sheet-row]").forEach(function (container) {
        var index = Number(container.getAttribute("data-sheet-row"));
        var item = (Array.isArray(editorRows) ? editorRows : sheet.rows)[index];
        var isNew = container.dataset.newRow === "true";
        var original = item && item.row || {};
        var oldDate = rowDate(original);
        if (container.dataset.removed === "true") {
          if (oldDate) { delete corrected[oldDate]; deleted[oldDate] = true; changedRows.push({ values: { date: oldDate, deleted: true } }); }
          return;
        }
        var values = { date: rowInputValue(container, "date"), start: rowInputValue(container, "start"), finish: rowInputValue(container, "finish"), breakMinutes: rowInputValue(container, "break") === "" ? null : Number(rowInputValue(container, "break")), absence: rowInputValue(container, "absence") || "NA", note: rowInputValue(container, "note") };
        if (values.breakMinutes !== null && (!Number.isInteger(values.breakMinutes) || values.breakMinutes < 0 || values.breakMinutes > 1440)) throw new Error("Break must be a whole number of minutes between 0 and 1440.");
        var startMinutes = timeMinutes(values.start);
        var finishMinutes = timeMinutes(values.finish);
        if (!/^un-paid$/i.test(values.absence) && values.breakMinutes !== null && startMinutes !== null && finishMinutes !== null && finishMinutes >= startMinutes && values.breakMinutes > finishMinutes - startMinutes) throw new Error("Break cannot exceed the time between Start and Finish.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !window.GMTPayPeriods || window.GMTPayPeriods.payMonthKeyForDate(values.date) !== sheet.payMonth) throw new Error("Every date must belong to this pay month.");
        var todayParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        var todayPart = function (type) { return todayParts.find(function (part) { return part.type === type; }).value; };
        var today = todayPart('year') + '-' + todayPart('month') + '-' + todayPart('day');
        if (values.date > today && ['Sick', 'Holiday', 'Absent', 'Un-Paid'].indexOf(values.absence) === -1) throw new Error("Future dates can only be marked absent, sick, holiday or Un-Paid; worked time cannot be entered early.");
        if (seen[values.date]) throw new Error("Each pay-month row must have a unique date.");
        seen[values.date] = true;
        var changed = isNew || oldDate !== values.date
          || String(rowValue(original, ["start", "startTime", "start_time", "clockIn", "clock_in"], "")) !== values.start
          || String(rowValue(original, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"], "")) !== values.finish
          || breakMinutes(original) !== values.breakMinutes
          || String(rowValue(original, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"], "NA") || "NA") !== values.absence
          || String(rowValue(original, ["description", "note", "notes", "Note"], "")) !== values.note;
        if (!changed) return;
        if (oldDate && oldDate !== values.date) { delete corrected[oldDate]; deleted[oldDate] = true; }
        corrected[values.date] = updatePayloadRow(original, values);
        delete deleted[values.date];
        changedRows.push({ values: values });
      });
      if (!changedRows.length) { if (feedback) feedback.textContent = "No changes to save."; return; }
      if(historyMeta.timesheet_revision_consistent!==true || !historyMeta.timesheet_owner_revisions)throw new Error('Timesheet history could not be verified. Refresh before saving.');
      var baseOwnerRevision=Number(historyMeta.timesheet_owner_revisions[String(sheet.employeeUpn||'').toLowerCase()]||0);
      if(!Number.isSafeInteger(baseOwnerRevision))throw new Error('Timesheet history could not be verified. Refresh before saving.');
      var importReview=null;
      if(stagedTimesheet && stagedTimesheet.key===sheet.key) {
        var stagedDates=Array.from(form.querySelectorAll('[data-new-row="true"]')).filter(function(row){var item=editorRows[Number(row.getAttribute('data-sheet-row'))];return item&&item.staged;}).map(function(row){return rowInputValue(row,'date');});
        if(stagedDates.length) {
          if(!window.GMTPortalApi?.documentTimesheetTarget || !stagedTimesheet.target.historyFingerprint)throw new Error('Timesheet history could not be verified. Reopen the uploaded days before saving.');
          var latestTarget=await window.GMTPortalApi.documentTimesheetTarget({employeeEmail:sheet.employeeUpn,dates:stagedDates});
          if(!latestTarget?.canEdit || latestTarget.employeeUpn?.toLowerCase()!==sheet.employeeUpn.toLowerCase() || latestTarget.payMonth!==sheet.payMonth || latestTarget.historyFingerprint!==stagedTimesheet.target.historyFingerprint || latestTarget.localRevision!==stagedTimesheet.target.localRevision || (latestTarget.conflicts||[]).length)throw new Error('This employee’s timesheet changed since the upload was reviewed. Refresh and review the days again before saving.');
          importReview={dates:stagedDates,historyFingerprint:latestTarget.historyFingerprint,localRevision:latestTarget.localRevision};
        }
      }
      var id = existing ? recordId(existing) : correctionRecordId(sheet);
      var editor = portalEditorLabel();
      var changedAt = new Date().toISOString();
      var period = window.GMTPayPeriods.periodForMonth(sheet.payMonth);
      var payload = Object.assign({}, previous, {
        employeeName: sheet.employeeName,
        employeeEmail: sheet.employeeUpn,
        payMonth: sheet.payMonth,
        weekStart: period.start,
        weekEnd: period.cycleEnd || period.end,
        cycleStart: period.start,
        cycleEnd: period.cycleEnd || period.end,
        payrollFriday: period.payrollFriday || period.payrollEnd || period.end,
        rows: Object.keys(corrected).sort().map(function (date) { return corrected[date]; }),
        deletedDays: Object.keys(deleted).sort(),
        editedAt: changedAt,
        editedBy: editor,
        editNote: "Edited on behalf of " + sheet.employeeName + " by " + editor + "."
      });
      var privateOriginalBatch=null;
      if(importReview && window.GMT_APP_CONFIG?.privateTimesheetOriginals===true){
        if(typeof window.GMTPortalApi.createTimesheetOriginalIntent!=='function'||typeof window.GMTPortalApi.uploadTimesheetOriginal!=='function'||!(stagedTimesheet.sourceFiles instanceof Map))throw new Error('Private original filing is unavailable. Keep the original and try again later.');
        var grouped=new Map();
        importReview.dates.forEach(function(date){var row=corrected[date],source=String(row?.sourceEvidence?.sourceId||'').toLowerCase(),file=stagedTimesheet.sourceFiles.get(source);if(!/^[a-f0-9]{64}$/.test(source)||!file)throw new Error('The original file is unavailable. Review the upload again before saving.');if(!grouped.has(source))grouped.set(source,{sourceSha256:source,file:file,dates:[]});grouped.get(source).dates.push(date);});
        privateOriginalBatch=Array.from(grouped.values());
      }
      if (button) button.disabled = true;
      if (feedback) feedback.textContent = "Saving this employee's pay-month changes…";
      setProgress("Saving portal record…", 15);
      await window.GMTPortalApi.saveRecord({ recordId: id, kind: "timesheets", action: "pay_month_correction", status: "Submitted", editMode: true, employeeName: sheet.employeeName, employeeEmail: sheet.employeeUpn, startDate: period.start, endDate: period.cycleEnd || period.end, recordDate: changedAt.slice(0, 10), updatedAt: changedAt, payload: payload, baseCorrectionExists:!!existing, baseCorrectionUpdatedAt:existing ? String(existing.updated_at||existing.updatedAt||'') : '', baseOwnerRevision:baseOwnerRevision, ...(importReview?{importReview:importReview}:{}) });
      portalRecordSaved = true;
      if(privateOriginalBatch){
        var originalFiled=true;
        try {
          setProgress('Portal record saved. Filing the original privately…',55);
          for(var source of privateOriginalBatch){
            var intent=await window.GMTPortalApi.createTimesheetOriginalIntent({recordId:id,sourceSha256:source.sourceSha256,dates:source.dates,ownerRevision:baseOwnerRevision+1});
            if(!intent?.intentId)throw new Error('Original filing could not be started.');
            var filed=await window.GMTPortalApi.uploadTimesheetOriginal(intent.intentId,source.file);
            if(filed?.reviewState!=='pending')throw new Error('Original filing could not be confirmed.');
          }
        } catch (_) {originalFiled=false;}
        stagedTimesheet=null;preferredSheetKey=sheet.key;
        document.dispatchEvent(new CustomEvent('gmt:history-record-updated',{detail:{sheetKey:sheet.key}}));
        await load();
        setProgress('Portal record saved; workbook delivery is held for review.',100);
        if(status)status.textContent=originalFiled?'Saved in the portal. Original filed privately and awaiting review; workbook delivery is on hold.':'Saved in the portal, but the original could not be confirmed. Keep your copy and contact Accounts; workbook delivery is on hold.';
        return;
      }
      if(stagedTimesheet && stagedTimesheet.key===sheet.key)stagedTimesheet=null;
      var notificationRecord = { source_record_id: id, employee_name: sheet.employeeName, employee_upn: sheet.employeeUpn };
      var queueIssue = "";
      setProgress("Portal record saved. Queueing workbook update…", 55);
      try { var queueResult=await queuePayMonthWorkbook(id, sheet, payload, period);if(queueResult?.skipped || queueResult?.queued!==true)queueIssue='Workbook filing was not queued.';else if(queueResult.providerStatus==='awaiting-source-review')queueIssue='Workbook queued; independent source review is required before delivery.';else if(queueResult.providerStatus==='awaiting-provider')queueIssue='Workbook queued; SharePoint filing is held pending verification.'; }
      catch (error) { queueIssue = error && error.message || "Accounts workbook filing was not queued."; }
      if(/independent (?:original|source) review|source rate delivery is not ready/i.test(queueIssue)){
        preferredSheetKey=sheet.key;document.dispatchEvent(new CustomEvent('gmt:history-record-updated',{detail:{sheetKey:sheet.key}}));await load();
        setProgress('Portal record saved; workbook delivery is held for review.',100);
        if(status)status.textContent='Saved in the portal. '+queueIssue+' Keep your original; no confirmation has been sent.';
        return;
      }
      var emailIssue = "";
      setProgress(queueIssue ? "Portal record saved. Workbook queue needs attention; sending notice…" : "Workbook update queued. Sending confirmation…", 80);
      try { await sendTimesheetChangeEmail(notificationRecord, payload, sheet.payMonth, changedRows); }
      catch (error) { emailIssue = error && error.message || "Email receipt was not confirmed."; }
      preferredSheetKey = sheet.key;
      document.dispatchEvent(new CustomEvent("gmt:history-record-updated", { detail: { sheetKey: sheet.key } }));
      await load();
      var outcome = "Saved in the portal. " + (queueIssue || "Accounts workbook filing queued.") + " " + (emailIssue || "Email receipt accepted.");
      setProgress(queueIssue || emailIssue ? "Portal save complete; follow-up needs attention." : "Save complete.", 100);
      if (status) status.textContent = outcome;
    } catch (error) {
      if (portalRecordSaved) {
        setProgress("Portal record saved; refresh the page to verify the latest status.", 100);
        if (feedback) feedback.textContent = "The portal record was saved, but a follow-up step could not be confirmed: " + (error && error.message ? error.message : "please refresh and check delivery status.");
      } else {
        if (feedback) feedback.textContent = error && error.message ? error.message : "The pay-month changes could not be saved.";
        if (progressPanel) progressPanel.hidden = true;
        if (button) button.disabled = false;
      }
    } finally {
      form.dataset.saving='false';form.inert=false;if(button && !portalRecordSaved)button.disabled=false;
    }
  }
  function renderPreview(record, day) {
    if (!preview) return;
    if (!record) { preview.innerHTML = '<p class="small-text">Select a document to preview it.</p>'; return; }
    if (actionKey(record) === "invoices" && record.source === "document-import") {
      var invoicePayload=payloadFor(record);
      preview.innerHTML='<h2>Imported invoice '+safe(record.invoice_number || invoicePayload.invoiceNumber || '')+'</h2><p class="portal-history-warning">Saved for review; this is not a Xero invoice.</p><div class="timesheet-paper-meta"><p><strong>Date:</strong> '+safe(record.record_date || invoicePayload.date || '')+'</p><p><strong>Total:</strong> '+safe(record.currency || invoicePayload.currency || '')+' '+safe(record.total == null ? invoicePayload.total : record.total)+'</p><p><strong>Employee:</strong> '+safe(displayName(record))+'</p><p><strong>Status:</strong> Needs reconciliation</p></div>';
      return;
    }
    if (actionKey(record) === "enquiries") { renderEnquiryPreview(record); return; }
    if (actionKey(record) === "job-cards") { renderJobCardPreview(record); return; }
    if (actionKey(record) === "estimates") { renderEstimatePreview(record); return; }
    if (actionKey(record) === "tasks") { renderTaskPreview(record); return; }
    var label = typeLabel(record);
    var employee = displayName(record);
    var statusValue = record.is_demo ? "Example only" : (record.status || "Submitted");
    var demoDescription = record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '';
    var sparseDetail = sparseTimesheet(record)
      ? '<p class="portal-history-warning"><strong>Daily detail unavailable:</strong> ' + safe(record.daily_detail_issue || "The Microsoft 365 history response returned the submission header without its daily rows.") + '</p><p class="small-text">Only the submitted header is available here. Clock-in, clock-out, break and total-hour values will appear after the intake/history flow returns the attached daily rows.</p>'
      : '';
    var sourceIdDetail = sourceRecordIdDetail(record);
    var timesheetAction = actionKey(record) === "timesheets"
      ? '<a class="button button-link" href="' + safe(timesheetHref(record, day)) + '">Open pay-month spreadsheet</a>'
      : '';
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(employee) + '</h2></div><span class="portal-status">' + safe(statusValue) + '</span></div><div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(label) + '</p><p><strong>Period:</strong> ' + safe(period(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.is_demo ? "Example data" : (record.submitted_at || record.submittedAt || "Not recorded")) + '</p><p><strong>Updated:</strong> ' + safe(record.is_demo ? "Example data" : (record.updated_at || record.updatedAt || record.submitted_at || "Not recorded")) + '</p><p><strong>Source:</strong> ' + safe(record.is_demo ? "GMT demonstration" : (record.source || "Protected GMT portal")) + '</p>' + sourceIdDetail + '</div>' + sparseDetail + dailyRollupDetail(record) + demoDescription + '<p class="small-text">This view is filtered by the signed-in account privilege. Open the source area for the full document.</p><div class="portal-item-actions">' + timesheetAction + '<a class="button button-link" href="' + destination(record) + '">Open ' + safe(label) + '</a></div>';
  }
  async function renderFiledOriginal(record) {
    var id=authoritativeSourceRecordId(record);
    if(!/^document-import-/.test(id)||!window.GMTPortalApi?.getImportedOriginal||!preview)return;
    var marker=document.createElement('p');marker.className='small-text';marker.textContent='Checking SharePoint original…';preview.append(marker);
    try {
      var result=await window.GMTPortalApi.getImportedOriginal(id);if(!marker.isConnected)return;
      if(!result?.filed){marker.textContent='Original not yet filed in SharePoint.';return;}
      var url=new URL(result.url);if(url.protocol!=='https:'||!url.hostname.toLowerCase().endsWith('.sharepoint.com'))throw new Error('Invalid document link');
      marker.textContent='';var link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open original in SharePoint';marker.append(link);
    } catch(_){if(marker.isConnected)marker.textContent='SharePoint original status is unavailable.';}
  }
  function filteredSheets() {
    var month = payMonthFilter && payMonthFilter.value ? String(payMonthFilter.value) : "";
    var employee = currentEmployee();
    return payMonthSheets.filter(function (sheet) { return (!month || sheet.payMonth === month) && (!employee || sheet.employeeUpn.toLowerCase() === employee || sheet.employeeName.toLowerCase() === employee); });
  }
  function selectSheet(index) {
    var sheets = filteredSheets();
    selected = Number(index);
    if (list) list.querySelectorAll("[data-sheet-index]").forEach(function (button) { button.setAttribute("aria-current", String(Number(button.getAttribute("data-sheet-index")) === selected)); });
    renderPayMonthSheet(sheets[selected]);
  }
  function renderPayMonthList() {
    var sheets = filteredSheets();
    renderDownloadGroupButtons(sheets);
    if (listTitle) listTitle.textContent = currentTab === "timesheets" ? "Available sheets" : (currentTab === "all" ? "All authorised records" : typeLabel({ kind: currentTab }));
    if (listKicker) listKicker.textContent = currentTab === "timesheets" ? "Pay month list" : "Record list";
    if (!list) return;
    if (currentTab === "timesheets") {
      if (listCount) listCount.textContent = sheets.length + " item" + (sheets.length === 1 ? "" : "s");
      if (!sheets.length) { list.innerHTML = '<p class="small-text portal-history-empty">' + safe(emptyMessage()) + '</p>'; if (preview) preview.innerHTML = '<p class="small-text">Select a pay month to preview its combined daily rows.</p>'; selected = -1; selectedSheet = null; return; }
      list.innerHTML = sheets.map(function (sheet, index) { var editable = sheet.canEdit; var latest = sheet.records[0] || {}; return '<button type="button" class="estimate-history-item pay-month-list-item" data-sheet-index="' + index + '" aria-current="' + String(index === selected) + '"><span class="pay-month-list-item-heading"><strong>' + safe(sheet.employeeName) + '</strong><span class="portal-status ' + (editable ? 'approved' : 'pending') + '">' + (editable ? 'Editable' : 'Read only') + '</span></span><span class="pay-month-list-item-month">' + safe(monthLabel(sheet.payMonth)) + '</span><small>' + safe(sheet.employeeUpn) + ' · ' + sheet.rows.length + ' daily row' + (sheet.rows.length === 1 ? '' : 's') + ' · updated ' + safe(latest.updated_at || latest.submitted_at || 'not recorded') + '</small></button>'; }).join("");
      list.querySelectorAll("[data-sheet-index]").forEach(function (button) { button.addEventListener("click", function () { selectSheet(Number(button.getAttribute("data-sheet-index"))); }); });
      var preferred = preferredSheetKey ? sheets.findIndex(function (sheet) { return sheet.key === preferredSheetKey; }) : -1;
      if (selected < 0 || selected >= sheets.length || (preferred >= 0 && selected !== preferred)) selected = preferred >= 0 ? preferred : 0;
      selectSheet(selected);
      return;
    }
    var visible = visibleRecords();
    if (listCount) listCount.textContent = visible.length + " item" + (visible.length === 1 ? "" : "s");
    if (!visible.length) { list.innerHTML = '<p class="small-text portal-history-empty">' + safe(emptyMessage()) + '</p>'; renderPreview(null); selected = -1; return; }
    list.innerHTML = '<div class="submission-record-header" role="row"><span role="columnheader">Username</span><span role="columnheader">Type</span><span role="columnheader">Date</span><span role="columnheader">Status</span></div>' + visible.map(function (record, index) {
      var reviewLabel = sparseTimesheet(record) ? " · Review: daily detail unavailable" : "";
      var statusLabel = record.is_demo ? "Example only" : ((record.status || "Submitted") + reviewLabel);
      var name = displayName(record); var email = record && (record.employee_upn || record.customer_email) || ""; var type = typeLabel(record);
      return '<button type="button" role="listitem" class="estimate-history-item submission-record-row' + (record.is_demo ? ' submission-demo-item' : '') + '" data-submission-index="' + index + '" data-record-kind="' + safe(actionKey(record)) + '" aria-current="' + String(index === selected) + '" title="Open ' + safe(name) + ' ' + safe(type) + '"><span class="submission-record-cell submission-record-user"><strong>' + safe(name) + '</strong>' + (email ? '<small>' + safe(email) + '</small>' : '') + '</span><span class="submission-record-cell submission-record-type">' + safe(type) + '</span><span class="submission-record-cell submission-record-date">' + safe(compactDate(record)) + '</span><span class="submission-record-cell submission-record-status">' + safe(statusLabel) + '</span></button>';
    }).join("");
    list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.addEventListener("click", function () { selected = Number(button.getAttribute("data-submission-index")); renderPayMonthList(); }); });
    if (selected < 0 || selected >= visible.length) { var requested = requestedRecordId(); var requestedIndex = requested ? visible.findIndex(function (record) { return String(record.source_record_id || record.record_id || "") === requested; }) : -1; selected = requestedIndex >= 0 ? requestedIndex : 0; }
    list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.setAttribute("aria-current", String(Number(button.getAttribute("data-submission-index")) === selected)); });
    renderPreview(visible[selected]);
    renderFiledOriginal(visible[selected]);
  }
  function render() {
    var upload = currentTab === "upload";
    var uploadPanel = document.getElementById("submission-upload-panel");
    var filters = document.querySelector(".pay-month-filters");
    var layout = document.querySelector(".pay-month-layout");
    if (uploadPanel) uploadPanel.hidden = !upload;
    if (filters) filters.hidden = upload;
    if (layout) layout.hidden = upload;
    if (upload) return;
    buildPayMonthSheets();
    if (!preferredSheetKey && selectedDay) {
      var daySheet = payMonthSheets.find(function (sheet) { return sheet.rows.some(function (row) { return row.date === selectedDay; }); });
      if (daySheet) preferredSheetKey = daySheet.key;
    }
    var requested = !requestedSheetApplied && requestedRecordId();
    var requestedSheet = requested && payMonthSheets.find(function (sheet) {
      return sheet.records.some(function (record) { return recordId(record) === requested; });
    });
    populatePayMonths();
    if (requestedSheet && payMonthFilter) {
      payMonthFilter.value = requestedSheet.payMonth;
      preferredSheetKey = requestedSheet.key;
      requestedSheetApplied = true;
    }
    buildPayMonthSheets();
    if (currentTab === "timesheets") renderPayMonthList();
    else renderPayMonthList();
  }
  function deliveryRecords() {
    return records.filter(function (record) { return record && !record.is_demo && record.dispatch && record.dispatch.status; });
  }
  function receiptTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(date);
  }
  function deliveryStage(label, state, timestamp, detail) {
    var badgeClass = state === "Failed" ? "pending" : (["Saved", "Verified", "Completed"].indexOf(state) >= 0 ? "approved" : "");
    return '<li class="submissions-delivery-stage"><div><strong>' + safe(label) + '</strong><span class="portal-status ' + badgeClass + '">' + safe(state) + '</span></div>' +
      (timestamp ? '<small>' + (label === "Portal record saved" ? "Queued " : "Receipt recorded ") + safe(receiptTime(timestamp)) + '</small>' : '') +
      (detail ? '<p>' + detail + '</p>' : '') + '</li>';
  }
  function deliveryStages(record) {
    var receipt = record && record.deliveryReceipt || null;
    var events = receipt && receipt.events || {};
    var started = events.flow_started || null;
    var verified = events.workbook_verified || null;
    var completed = events.flow_completed || null;
    var failed = events.flow_failed || null;
    var failureStage = failed && String(failed.stage || "") || "";
    var flowState = failed ? "Failed" : (completed ? "Completed" : (started ? "In progress" : "Not reported"));
    var flowTimestamp = failed ? failed.receivedAt : (completed ? completed.receivedAt : (started && started.receivedAt));
    var flowDetail = receipt && receipt.flowRunId
      ? '<span><strong>Run ID:</strong> ' + safe(receipt.flowRunId) + '</span>' : '';
    if (record.workbookWriteHold && receipt && receipt.workbookId) flowDetail += '<span><strong>Workbook ID:</strong> ' + safe(receipt.workbookId) + '</span>';
    if (record.workbookWriteHold && receipt && receipt.generation) flowDetail += '<span><strong>Source generation:</strong> ' + safe(receipt.generation) + '</span>';
    if (failed && failureStage) flowDetail += '<span><strong>Failed at:</strong> ' + safe(failureStage.replace(/[_-]/g, " ")) + '</span>';
    if (failed && failed.safeError) flowDetail += '<span class="submissions-delivery-error"><strong>Details:</strong> ' + safe(failed.safeError) + '</span>';
    var workbookFailed = !verified && ["workbook_routing", "workbook_upsert", "workbook_readback"].indexOf(failureStage) >= 0;
    var workbookState = verified ? "Verified" : (workbookFailed ? "Failed" : "Not reported");
    var workbookDetail = verified
      ? '<span>' + safe(verified.created || 0) + ' created · ' + safe(verified.updated || 0) + ' updated · ' + safe(verified.unchanged || 0) + ' unchanged · ' + safe(verified.verifiedRowCount || 0) + ' rows checked</span>'
      : '';
    var portalDetail = record.status ? '<span>Queue status: ' + safe(String(record.status).replace(/[_-]/g, " ")) + '</span>' : '';
    if (record.workbookWriteHold) portalDetail += '<span>Timesheet edits are on hold while this workbook delivery finishes or is reviewed.</span>';
    if (record.workbookWriteHold && (!receipt || !receipt.workbookId)) portalDetail += '<span>The workbook run could not be matched to the current source. Keep the hold and review the delivery.</span>';
    return '<ol class="submissions-delivery-stages">' +
      deliveryStage("Portal record saved", "Saved", record.queuedAt || "", portalDetail) +
      deliveryStage("Power Automate", flowState, flowTimestamp || "", flowDetail) +
      deliveryStage("SharePoint workbook", workbookState, verified && verified.receivedAt || (workbookFailed && failed.receivedAt) || "", workbookDetail) +
      '</ol>';
  }
  function updateDeliveryIndicator(freshCounts) {
    if (!deliveryTrigger) return;
    deliveryTrigger.hidden = historyMeta.is_admin !== true;
    if (historyMeta.is_admin !== true) return;
    var items = deliveryRecords();
    var count = function (state) {
      return freshCounts && Number.isFinite(Number(freshCounts[state]))
        ? Number(freshCounts[state])
        : items.filter(function (record) { return String(record.dispatch.status).toLowerCase() === state; }).length;
    };
    var queued = count("queued");
    var failed = count("failed");
    var sending = count("sending");
    var label = "Correction delivery status";
    var trackedCount = freshCounts ? ["queued", "sending", "failed", "sent", "skipped", "completed", "uncertain"].reduce(function (total, key) { return total + count(key); }, 0) : items.length;
    if (trackedCount) {
      label += " · " + queued + " queued · " + failed + " failed";
      if (sending) label += " · " + sending + " sending";
      if (count("uncertain")) label += " · " + count("uncertain") + " needs review";
    }
    deliveryTrigger.textContent = label;
    deliveryTrigger.setAttribute("aria-label", label);
  }
  function showDeliveryStatus(data) {
    if (!deliveryDetails || historyMeta.is_admin !== true) return;
    var items = Array.isArray(data && data.records) ? data.records : deliveryRecords().map(function (record) {
      var dispatch = record.dispatch || {};
      return {
        recordId: String(record.source_record_id || record.record_id || ""),
        employeeName: record.employee_name || record.employee_upn || "Timesheet correction",
        date: compactDate(record),
        status: dispatch.status,
        attempts: dispatch.attempts,
        queuedAt: dispatch.queued_at,
        sentAt: dispatch.sent_at,
        updatedAt: record.updated_at || record.submitted_at,
        error: dispatch.error
      };
    });
    var states = ["queued", "sending", "failed", "sent", "skipped", "completed", "uncertain"];
    var labels = { queued: "Waiting", sending: "In progress", failed: "Failed", sent: "Email accepted", skipped: "Skipped", completed: "Completed", uncertain: "Needs review" };
    var counts = data && data.counts || {};
    var summary = states.map(function (state) {
      var count = Number(counts[state] || 0);
      return count ? '<li><strong>' + safe(labels[state]) + ':</strong> ' + count + '</li>' : "";
    }).join("");
    var details = items.slice(0, 100).map(function (record) {
      var state = String(record.status || "unknown").toLowerCase();
      var label = labels[state] || state.replace(/[_-]/g, " ");
      var updated = record.sentAt || record.queuedAt || record.updatedAt || "";
      var sourceId = String(record.recordId || record.record_id || "");
      var sourceIdDetail = sourceId
        ? '<p><strong>Source record ID:</strong> ' + safe(sourceId) + '</p>'
        : '<p class="portal-history-warning">Source record ID unavailable; this item cannot be reconciled to a source record.</p>';
      return '<li class="submissions-delivery-item"><div><strong>' + safe(record.employeeName || record.employee_name || "Timesheet correction") + '</strong><span class="portal-status ' + (["failed", "uncertain"].indexOf(state) >= 0 ? "pending" : ["sent", "completed"].indexOf(state) >= 0 ? "approved" : "") + '">' + safe(label) + '</span></div><p>' + safe(record.date || "Date not recorded") + (record.attempts ? ' · ' + safe(record.attempts) + ' attempt' + (Number(record.attempts) === 1 ? "" : "s") : "") + (updated ? ' · ' + safe(updated) : "") + '</p>' + sourceIdDetail + deliveryStages(record) + (record.error ? '<p class="submissions-delivery-error"><strong>' + (state === "completed" ? 'Earlier email handoff details:' : 'Email handoff details:') + '</strong> ' + safe(record.error) + '</p>' : "") + '</li>';
    }).join("");
    var providerCopy = data && data.providerStatus === "not-configured"
      ? "The outbound email route is not configured, so queued corrections have not been handed off."
      : data && data.providerStatus === "awaiting-workbook-route"
        ? "The Microsoft 365 workbook route is still being verified. Pay-month corrections are being held in the queue and their sources require review."
        : data && data.providerStatus === "awaiting-source-review"
          ? "Pay-month corrections are held until their source records have been reviewed."
        : data && data.providerStatus === "ready"
          ? "The configured outbound route is available. A sent status means only that the email service accepted the message."
          : "The provider route state is unavailable. Refresh the queue status to try again.";
    deliveryDetails.innerHTML = '<p class="small-text submissions-delivery-provider">' + safe(providerCopy) + '</p>' + (items.length
      ? '<ul class="submissions-delivery-summary">' + (summary || '<li>No queued delivery states were returned.</li>') + '</ul><p class="small-text submissions-delivery-note">Email acceptance is shown separately from the Power Automate and workbook receipts below.</p><h3>Recent correction records</h3><ul class="submissions-delivery-list">' + details + '</ul>' + (data && (data.truncated || items.length > 100) ? '<p class="small-text">Showing the latest 100 tracked corrections.</p>' : "")
      : '<p class="portal-history-empty">No correction records are currently in the delivery queue.</p><p class="small-text submissions-delivery-note">This status view does not claim that a SharePoint workbook was updated.</p>');
  }
  async function openDeliveryStatus() {
    if (!deliveryDetails || historyMeta.is_admin !== true) return;
    if (deliveryDialog && typeof deliveryDialog.showModal === "function") deliveryDialog.showModal();
    else if (deliveryDialog) deliveryDialog.setAttribute("open", "");
    deliveryDetails.innerHTML = '<p class="small-text" role="status">Checking the current correction queue…</p>';
    try {
      if (!window.GMTPortalApi || typeof window.GMTPortalApi.correctionQueueStatus !== "function") throw new Error("Queue status is not connected.");
      var result = await window.GMTPortalApi.correctionQueueStatus();
      showDeliveryStatus(result);
      updateDeliveryIndicator(result && result.counts);
    } catch (error) {
      showDeliveryStatus({ providerStatus: "unknown", records: deliveryRecords().map(function (record) {
        var dispatch = record.dispatch || {};
        return { recordId: String(record.source_record_id || record.record_id || ""), employeeName: record.employee_name || record.employee_upn, date: compactDate(record), status: dispatch.status, attempts: dispatch.attempts, queuedAt: dispatch.queued_at, sentAt: dispatch.sent_at, error: dispatch.error };
      }), counts: deliveryRecords().reduce(function (counts, record) {
        var state = String(record.dispatch.status || "").toLowerCase();
        if (Object.hasOwn(counts, state)) counts[state] += 1;
        return counts;
      }, { queued: 0, sending: 0, failed: 0, sent: 0, skipped: 0, completed: 0, uncertain: 0 }) });
      deliveryDetails.insertAdjacentHTML("afterbegin", '<p class="portal-history-warning">Live queue status could not be refreshed: ' + safe(error && error.message || "unknown error") + '. Showing the latest authorised history data.</p>');
    }
  }
  async function load() {
    if (window.GMTPayPeriods && window.GMTPayPeriods.ready) await window.GMTPayPeriods.ready;
    if (busy) return false;
    busy = true;
    if (refresh) refresh.disabled = true;
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      realRecordCount = 0;
      records = [];
      historyMeta = {};
      updateDeliveryIndicator();
      populateEmployees([]);
      if (status) status.textContent = "Protected submission history is not connected yet. Retry Refresh or contact Accounts.";
      render();
      if (refresh) refresh.disabled = false;
      busy = false;
      return false;
    }
    if (status) status.textContent = "Loading your authorised submissions…";
    try {
      var body = await window.GMTPortalApi.history("all", {limit:1000});
      if (!body || !Array.isArray(body.records) || !body.meta || typeof body.meta !== 'object') throw new Error('Complete submission history is unavailable.');
      var realRecords = body && Array.isArray(body.records) ? body.records.filter(function (record) { return !emptyHistoricalDemo(record); }) : [];
      historyMeta = body && body.meta && typeof body.meta === "object" ? body.meta : {};
      var invoiceWarning = '';
      if (historyMeta.is_xero_admin && typeof window.GMTPortalApi.importedInvoices === 'function') {
        try {
          var offset=0, pages=0, page;
          do {
            page=await window.GMTPortalApi.importedInvoices(offset);
            if (!page || !Array.isArray(page.records)) throw new Error('Invalid invoice archive response');
            realRecords=realRecords.concat(page.records);pages++;
            if (page.has_more && (!Number.isInteger(page.next_offset) || page.next_offset<=offset)) throw new Error('Invalid invoice archive pagination');
            offset=page.next_offset;
          } while (page.has_more && pages<10);
          if (page.has_more) invoiceWarning=' Imported invoice archive has additional records.';
        } catch (_) { invoiceWarning=' Imported invoice archive is currently unavailable.'; }
      }
      realRecordCount = realRecords.length;
      records = realRecords;
      if (historyMeta.is_hr_admin && !historyMeta.is_admin && !historyMeta.is_submission_admin) {
        tabButtons.forEach(function (button) {
          var tab = button.getAttribute("data-submission-tab");
          button.hidden = tab !== "timesheets" && tab !== "calendar" && tab !== "upload";
        });
      }
      updateDeliveryIndicator();
      populateEmployees(realRecords);
      var scope = body && body.meta && body.meta.visible_scope ? " Access: " + body.meta.visible_scope + "." : "";
      if (status) status.textContent = realRecordCount
        ? realRecordCount + " authorised record" + (realRecordCount === 1 ? "" : "s") + " loaded." + scope
        : "No submitted documents are currently available for this account." + scope;
      if (status && historyMeta.timesheet_identity_review_required === true) status.textContent += " Your timesheets are temporarily unavailable while your identity is checked. Please contact Accounts.";
      if (status && invoiceWarning) status.textContent += invoiceWarning;
      var adminNotice = document.getElementById("submissions-admin-timesheet-notice");
      if (adminNotice) {
        var hasTimesheet = realRecords.some(function (record) { return actionKey(record) === "timesheets" || actionKey(record) === "clock"; });
        if (historyMeta.is_admin === true && !hasTimesheet) {
          var upstream = String(historyMeta.upstream || "not-configured");
          var sourceText = upstream === "ok" ? "Microsoft 365 returned no employee timesheet rows for this account." : "The protected Microsoft 365 history source is currently " + upstream + ".";
          adminNotice.hidden = false;
          adminNotice.textContent = "Accounts access is enabled. " + sourceText;
        } else {
          adminNotice.hidden = true;
          adminNotice.textContent = "";
        }
      }
      render();
      return true;
    } catch (error) {
      realRecordCount = 0;
      records = [];
      historyMeta = {};
      updateDeliveryIndicator();
      populateEmployees([]);
      if (status) status.textContent = error && error.message ? error.message : "Submitted documents could not be loaded. Please try again or contact Accounts.";
      render();
      return false;
    } finally {
      if (refresh) refresh.disabled = false;
      busy = false;
    }
  }
  var uploadPanel = document.getElementById("submission-upload-panel");
  if (uploadPanel && window.GMTSubmissionUploadUI) window.GMTSubmissionUploadUI.mount(uploadPanel, { privateTimesheetOriginals:window.GMT_APP_CONFIG?.privateTimesheetOriginals===true, stageTimesheets: async function(items,sourceFiles) {
    if(stagedTimesheet)throw new Error('Save or discard the timesheet already open before staging more days.');
    if(!window.GMTPortalApi?.documentTimesheetTarget || !window.GMTSubmissionUploadStage || !window.GMTPayPeriods?.payMonthKeyForDate)throw new Error('Timesheet review is not connected.');
    if(!items.length)throw new Error('Select at least one timesheet day.');
    var first=items[0].data||{},email=String(first.employeeEmail||'').trim().toLowerCase(),name=String(first.employee||'').trim().toLowerCase();
    if(!email&&!name)throw new Error('Enter the employee name or email.');
    if(items.some(function(item){var data=item.data||{},otherEmail=String(data.employeeEmail||'').trim().toLowerCase(),otherName=String(data.employee||'').trim().toLowerCase();return email ? otherEmail!==email : otherEmail || otherName!==name;}))throw new Error('Select days for one employee at a time.');
    var targetQuery={employeeEmail:email,employee:first.employee||'',dates:items.map(function(item){return item.data.date;})};
    var before=await window.GMTPortalApi.documentTimesheetTarget(targetQuery);
    if(!await load() || historyMeta.history_pagination?.has_more || historyMeta.timesheet_revision_consistent!==true || !historyMeta.timesheet_owner_revisions)throw new Error('Complete timesheet history is unavailable; try again before staging.');
    buildPayMonthSheets();
    var target=await window.GMTPortalApi.documentTimesheetTarget(targetQuery);
    if(!before?.historyFingerprint || before.historyFingerprint!==target?.historyFingerprint || before.localRevision!==target?.localRevision)throw new Error('Timesheet history changed while loading. Try reviewing the days again.');
    if(Number(historyMeta.timesheet_owner_revisions[target.employeeUpn?.toLowerCase()]||0)!==target.localRevision)throw new Error('Timesheet history changed while loading. Try reviewing the days again.');
    if(!target?.canEdit || !target.employeeUpn || !target.payMonth || !target.historyFingerprint || !Number.isSafeInteger(target.localRevision))throw new Error('The employee or pay month could not be verified.');
    var key=target.employeeUpn.toLowerCase()+'|'+target.payMonth;
    var existing=payMonthSheets.find(function(sheet){return sheet.key===key;});
    var dates=(existing?.reviewRows || existing?.rows || []).map(function(item){return item.date;}).concat(target.conflicts||[]);
    var resolved=items.map(function(item){return Object.assign({},item,{data:Object.assign({},item.data,{employeeEmail:target.employeeUpn})});});
    var rows=window.GMTSubmissionUploadStage.prepare(resolved,target,dates,window.GMTPayPeriods.payMonthKeyForDate);
    stagedTimesheet={key:key,target:target,rows:rows,sourceFiles:sourceFiles};selectedDay='';if(dayFilter)dayFilter.value='';if(employeeFilter)employeeFilter.value='';
    if(payMonthFilter){if(!Array.from(payMonthFilter.options).some(function(option){return option.value===target.payMonth;})){var option=document.createElement('option');option.value=target.payMonth;option.textContent=monthLabel(target.payMonth);payMonthFilter.append(option);}payMonthFilter.value=target.payMonth;payMonthFilterInitialised=true;}
    currentTab='timesheets';preferredSheetKey=key;selected=-1;
    tabButtons.forEach(function(button){button.setAttribute('aria-selected',String(button.getAttribute('data-submission-tab')==='timesheets'));});
    render();
    if(!selectedSheet || selectedSheet.key!==key || !selectedSheet.canEdit){stagedTimesheet=null;throw new Error('The verified timesheet could not be opened.');}
    if(status)status.textContent='Uploaded days are in the timesheet editor and are not saved yet. Review them, then choose Save changes.';
  }, save: async function (items) {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.importDocuments !== 'function') throw new Error('Protected import is not connected.');
    var result=await window.GMTPortalApi.importDocuments(items);
    if (result && Array.isArray(result.results) && result.results.some(function (entry) { return entry && entry.status==='saved'; })) {
      try { await load(); document.dispatchEvent(new CustomEvent('gmt:history-record-updated')); } catch (_) { if (status) status.textContent='Saved; refresh history to see the new records.'; }
    }
    return result;
  }, fileOriginal: async function(recordId,file){
    if(!window.GMTPortalApi?.fileImportedOriginal)throw new Error('Shared document filing is unavailable.');
    return window.GMTPortalApi.fileImportedOriginal(recordId,file);
  }, listSharedOriginals: async function(offset){
    if(!window.GMTPortalApi?.listSharedImportedOriginals)throw new Error('Shared documents are unavailable.');
    return window.GMTPortalApi.listSharedImportedOriginals(offset);
  } });
  tabButtons.forEach(function (button) {
    button.setAttribute("aria-selected", String(button.getAttribute("data-submission-tab") === currentTab));
    button.addEventListener("click", function () {
      currentTab = button.getAttribute("data-submission-tab") || "timesheets";
      selected = -1;
      tabButtons.forEach(function (item) { item.setAttribute("aria-selected", String(item === button)); });
      render();
    });
  });
  if (payMonthFilter) payMonthFilter.addEventListener("change", function () { selected = -1; preferredSheetKey = ""; render(); });
  if (employeeFilter) employeeFilter.addEventListener("change", function () { selected = -1; preferredSheetKey = ""; render(); });
  if (dayFilter) dayFilter.addEventListener("change", function () { selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(dayFilter.value) ? dayFilter.value : ""; selected = -1; render(); });
  if (refresh) refresh.addEventListener("click", load);
  if (deliveryTrigger) deliveryTrigger.addEventListener("click", openDeliveryStatus);
  if (deliveryDialog) deliveryDialog.querySelectorAll("[data-delivery-close]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (typeof deliveryDialog.close === "function") deliveryDialog.close();
      else deliveryDialog.removeAttribute("open");
    });
  });
  downloadGroupButtons.forEach(function (button) {
    button.addEventListener("click", function () { downloadPayMonthGroup(button.getAttribute("data-download-sheet-group"), button); });
  });
  document.addEventListener("gmt:history-record-deleted", function () {
    selected = -1;
    setTimeout(load, 0);
  });
  // Shared calendar labels carry the protected source record ID. Selecting a
  // day therefore opens the same document preview as selecting its history
  // row, including records whose daily data came from a weekly attachment.
  document.addEventListener("gmt:calendar-select", function (event) {
    var detail = event && event.detail || {};
    var recordId = String(detail.recordId || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(detail.day || ""))) {
      selectedDay = String(detail.day);
      if (dayFilter) dayFilter.value = selectedDay;
    }
    if (!recordId) {
      if (!selectedDay) return;
      selected = -1;
      currentTab = "timesheets";
      preferredSheetKey = "";
      tabButtons.forEach(function (button) { button.setAttribute("aria-selected", String(button.getAttribute("data-submission-tab") === "timesheets")); });
      render();
      var dayIndex = filteredSheets().findIndex(function (candidate) { return candidate.rows.some(function (row) { return row.date === selectedDay; }); });
      if (dayIndex >= 0) selectSheet(dayIndex);
      return;
    }
    var sheet = payMonthSheets.find(function (candidate) {
      return candidate.records.some(function (record) { return recordId === String(record && (record.source_record_id || record.record_id || record.id) || ""); });
    });
    if (sheet) {
      currentTab = "timesheets";
      tabButtons.forEach(function (button) { button.setAttribute("aria-selected", String(button.getAttribute("data-submission-tab") === "timesheets")); });
      preferredSheetKey = sheet.key;
      if (payMonthFilter && sheet.payMonth) payMonthFilter.value = sheet.payMonth;
      render();
      var sheets = filteredSheets();
      var sheetIndex = sheets.findIndex(function (candidate) { return candidate.key === sheet.key; });
      if (sheetIndex >= 0) selectSheet(sheetIndex);
      var item = list && list.querySelector('[data-sheet-index="' + sheetIndex + '"]');
      if (item && typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" });
      return;
    }
    var visible = visibleRecords();
    var index = visible.findIndex(function (record) { return String(record && (record.source_record_id || record.record_id || record.id) || "") === recordId; });
    if (index < 0) return;
    selected = index;
    renderPayMonthList();
    var recordItem = list && list.querySelector('[data-submission-index="' + index + '"]');
    if (recordItem && typeof recordItem.scrollIntoView === "function") recordItem.scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("DOMContentLoaded", load);
}());
