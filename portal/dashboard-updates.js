(function () {
  "use strict";

  var board = document.getElementById("portal-task-board");
  var status = document.getElementById("portal-task-board-status");
  var taskRetry = document.querySelector('[data-dashboard-retry="tasks"]');
  var notificationStatus = document.getElementById("portal-notification-status");
  var notificationList = document.getElementById("portal-notifications");
  var notificationRetry = document.querySelector('[data-dashboard-retry="notifications"]');
  var statisticsStatus = document.getElementById("portal-statistics-status");
  var statisticsMonth = document.getElementById("portal-statistics-pay-month");
  var statisticsEmployee = document.getElementById("portal-statistics-employee");
  var statisticsEmployeeLabel = document.getElementById("portal-statistics-employee-label");
  var statisticsAdmin = false;
  var statisticsRetry = document.querySelector('[data-dashboard-retry="statistics"]');
  var notificationRecords = [];
  var notificationDialog = null;
  var personalHistoryRecords = null;
  var statisticsSelectionInitialized = false;
  var statisticsMonthCache = Object.create(null);
  var statisticsMonthLoads = Object.create(null);
  var statisticsEmployees = Object.create(null);
  var statisticsLoadSequence = 0;

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function profileIdentity() {
    try {
      var profile = JSON.parse(window.localStorage.getItem("gmt.portal.profile.v1") || "{}");
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return {};
      return {
        upn: String(profile.username || profile.upn || profile.email || "").trim().toLowerCase(),
        oid: String(profile.subject || profile.oid || "").trim().toLowerCase()
      };
    } catch (_) {
      return {};
    }
  }

  function currentPayMonthKey() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    var date = values.year + "-" + values.month + "-" + values.day;
    return window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function"
      ? window.GMTPayPeriods.payMonthKeyForDate(date)
      : date.slice(0, 7);
  }

  function statisticsDate(value) {
    var match = String(value == null ? "" : value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    var month = window.GMTPayPeriods && typeof window.GMTPayPeriods.payMonthKeyForDate === "function"
      ? window.GMTPayPeriods.payMonthKeyForDate(match[1])
      : match[1].slice(0, 7);
    return month ? { date: match[1], month: month } : null;
  }

  function recordOwnerMatches(record, identity) {
    var payload = payloadFor(record);
    var ownerOid = String(record && (record.owner_oid || record.ownerOid) || payload.ownerOid || payload.owner_oid || "").trim().toLowerCase();
    var ownerUpn = String(record && (record.employee_upn || record.employee_email || record.employeeEmail || record.owner_upn) || payload.employeeUpn || payload.employeeEmail || payload.ownerUpn || payload.owner_upn || "").trim().toLowerCase();
    return Boolean((identity.oid && ownerOid && identity.oid === ownerOid) || (identity.upn && ownerUpn && identity.upn === ownerUpn));
  }

  function employeeKey(record) {
    var payload = payloadFor(record);
    return String(record.employee_upn || record.employee_email || record.employeeEmail || payload.employeeUpn || payload.employeeEmail || record.owner_upn || payload.ownerUpn || payload.owner_upn || "").trim().toLowerCase();
  }

  function recordKind(record) {
    return String(record && (record.kind || record.action || record.category) || "").trim().toLowerCase().replace(/_/g, "-");
  }

  function statisticsRows(record) {
    if (window.GMTCalendarData && typeof window.GMTCalendarData.rowsFor === "function") {
      var aligned = window.GMTCalendarData.rowsFor(record);
      if (Array.isArray(aligned) && aligned.length) return aligned;
    }
    var payload = payloadFor(record);
    var rows = payload.rows || payload.dailyRows || payload.daily_rows || record.rows || record.daily_rows || record.dailyRows;
    return Array.isArray(rows) ? rows : [];
  }

  function statisticsRowDate(row) {
    if (!row || typeof row !== "object") return null;
    return statisticsDate(row.date || row.record_date || row.recordDate || row.workDate || row.Date || "");
  }

  function rowAbsence(row) {
    return String(row && (row.absenceReason || row.absence_reason || row.absenceStatus || row.absence_status || row.absence || row.absenceType || row.absence_type) || "").trim();
  }

  function isHolidayRow(row) {
    return Boolean(row && (row.holiday === true || row.isHoliday === true || row.is_holiday === true)) || /holiday/i.test(rowAbsence(row));
  }

  function isAbsentRow(row) {
    var absence = rowAbsence(row).toLowerCase();
    return Boolean(absence && !/^(n\/?a|none|no|false|working)$/.test(absence)) || /sick|absent|time off|leave/i.test(absence);
  }

  function rowShowsWork(row) {
    if (!row || isHolidayRow(row) || isAbsentRow(row)) return false;
    var workFields = ["workedHours", "worked_hours", "workedMinutes", "worked_minutes", "basicHours", "basic_hours", "ot15Hours", "ot15_hours", "ot20Hours", "ot20_hours", "totalHours", "total_hours", "hours"];
    for (var index = 0; index < workFields.length; index += 1) {
      var raw = row[workFields[index]];
      if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0) return true;
    }
    return Boolean(String(row.start || row.startTime || row.start_time || row.clockIn || row.clock_in || "").trim()
      && String(row.finish || row.finishTime || row.finish_time || row.clockOut || row.clock_out || "").trim());
  }

  function recordActivityDate(record, kind) {
    var payload = payloadFor(record);
    var fields;
    if (kind === "tasks") {
      fields = ["completed_at", "completedAt", "completion_date", "completionDate", "completed_date", "completedDate", "updated_at", "updatedAt", "record_date", "recordDate", "date"];
    } else if (kind === "estimates") {
      fields = ["estimate_date", "estimateDate", "date", "dateOfEstimate", "record_date", "recordDate", "created_at", "createdAt"];
    } else {
      fields = ["record_date", "recordDate", "raised_at", "raisedAt", "job_card_date", "jobCardDate", "created_at", "createdAt", "date", "planned_date", "plannedDate"];
    }
    for (var index = 0; index < fields.length; index += 1) {
      var date = statisticsDate(record && record[fields[index]]) || statisticsDate(payload[fields[index]]);
      if (date) return date;
    }
    return statisticsDate(record && (record.submitted_at || record.submittedAt)) || statisticsDate(payload.submittedAt || payload.submitted_at);
  }

  function recordIdentifier(record, kind) {
    var payload = payloadFor(record);
    var value = record && (record.source_record_id || record.record_id || record.recordId);
    if (!value && kind === "estimates") value = record && (record.estimate_number || record.estimateNumber) || payload.number || payload.estimateNumber;
    if (!value && kind === "job-cards") value = record && (record.job_ref || record.job_reference) || payload.jobReference || payload.ref;
    if (!value && kind === "tasks") value = record && (record.task_id || record.taskId) || payload.taskId || payload.id;
    return String(value || "").trim();
  }

  function taskIsComplete(record) {
    var payload = payloadFor(record);
    var state = String(record && record.status || payload.status || "").trim().toLowerCase();
    return ["complete", "completed", "done"].indexOf(state) !== -1
      || record && (record.completed === true || record.is_complete === true || record.isComplete === true)
      || payload.completed === true || payload.isComplete === true || payload.is_complete === true;
  }

  function addDateMonths(months, date) {
    if (date && months.indexOf(date.month) === -1) months.push(date.month);
  }

  function statisticsMonths(records) {
    var currentMonth = currentPayMonthKey() || new Date().toISOString().slice(0, 7);
    var current = new Date(currentMonth + "-01T12:00:00Z");
    var months = [];
    for (var offset = 0; offset < 120; offset += 1) {
      var date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1));
      var candidate = date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
      if (!window.GMTPayPeriods || typeof window.GMTPayPeriods.periodForMonth !== "function" || window.GMTPayPeriods.periodForMonth(candidate)) months.push(candidate);
    }
    (records || []).forEach(function (record) {
      var kind = recordKind(record);
      if (kind === "timesheets") statisticsRows(record).forEach(function (row) { addDateMonths(months, statisticsRowDate(row)); });
      else if (["estimates", "job-cards", "tasks"].indexOf(kind) !== -1) addDateMonths(months, recordActivityDate(record, kind));
    });
    return Array.from(new Set(months)).sort(function (left, right) { return right.localeCompare(left); });
  }

  function monthLabel(month) {
    var date = new Date(month + "-01T12:00:00Z");
    return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function setStatisticValues(values) {
    Object.keys(values).forEach(function (key) {
      var target = document.querySelector('[data-statistics-value="' + key + '"]');
      if (target) target.textContent = String(values[key]);
    });
  }

  function setStatisticsUnavailable(message) {
    personalHistoryRecords = null;
    if (statisticsStatus) statisticsStatus.textContent = message;
    if (statisticsMonth) statisticsMonth.disabled = true;
    setStatisticValues({ "worked-days": "—", "holiday-days": "—", "estimates-written": "—", "job-cards-raised": "—", "tasks-completed": "—" });
    if (statisticsRetry) statisticsRetry.hidden = message === "Personal statistics are not connected.";
  }

  function populateStatisticsMonths(records) {
    if (!statisticsMonth) return;
    var selected = statisticsMonth.value || currentPayMonthKey();
    var months = statisticsMonths(records);
    statisticsMonth.innerHTML = months.map(function (month) {
      return '<option value="' + safe(month) + '">' + safe(monthLabel(month)) + '</option>';
    }).join("");
    if (months.indexOf(selected) !== -1) statisticsMonth.value = selected;
    else statisticsMonth.value = currentPayMonthKey();
    statisticsMonth.disabled = false;
  }

  function calculateStatistics(records, month) {
    var workedDates = Object.create(null);
    var holidayDates = Object.create(null);
    var estimates = Object.create(null);
    var jobCards = Object.create(null);
    var completedTasks = Object.create(null);
    var hasRecords = false;
    records.forEach(function (record) {
      var kind = recordKind(record);
      if (kind === "timesheets") {
        statisticsRows(record).forEach(function (row) {
          var date = statisticsRowDate(row);
          if (!date || date.month !== month) return;
          hasRecords = true;
          var dayKey = (statisticsAdmin ? (employeeKey(record) || record.owner_oid || recordIdentifier(record, kind) || 'unknown') + '|' : '') + date.date;
          if (isHolidayRow(row)) holidayDates[dayKey] = true;
          else if (rowShowsWork(row)) workedDates[dayKey] = true;
        });
        return;
      }
      if (["estimates", "job-cards", "tasks"].indexOf(kind) === -1) return;
      var date = recordActivityDate(record, kind);
      if (!date || date.month !== month) return;
      hasRecords = true;
      var identifier = recordIdentifier(record, kind);
      if (!identifier) return;
      if (kind === "estimates") estimates[identifier] = true;
      if (kind === "job-cards") jobCards[identifier] = true;
      if (kind === "tasks" && taskIsComplete(record)) completedTasks[identifier] = true;
    });
    Object.keys(holidayDates).forEach(function (date) { delete workedDates[date]; });
    return {
      hasRecords: hasRecords,
      values: {
        "worked-days": Object.keys(workedDates).length,
        "holiday-days": Object.keys(holidayDates).length,
        "estimates-written": Object.keys(estimates).length,
        "job-cards-raised": Object.keys(jobCards).length,
        "tasks-completed": Object.keys(completedTasks).length
      }
    };
  }

  function renderStatisticsForMonth() {
    if (!statisticsStatus || !statisticsMonth) return Promise.resolve();
    var month = statisticsMonth.value || currentPayMonthKey();
    if (!Object.prototype.hasOwnProperty.call(statisticsMonthCache, month)) {
      personalHistoryRecords = null;
      setStatisticValues({ "worked-days": "—", "holiday-days": "—", "estimates-written": "—", "job-cards-raised": "—", "tasks-completed": "—" });
      statisticsStatus.textContent = "Loading all available records for " + monthLabel(month) + "…";
      return loadStatisticsMonth(month);
    }
    var records = statisticsMonthCache[month];
    personalHistoryRecords = records;
    if (statisticsAdmin && statisticsEmployee && statisticsEmployee.value) records = records.filter(function (record) { return employeeKey(record) === statisticsEmployee.value; });
    var result = calculateStatistics(records, month);
    setStatisticValues(result.values);
    statisticsStatus.textContent = result.hasRecords
      ? "Activity totals for " + monthLabel(month) + " · " + statisticsMonthCache[month].length + " records loaded."
      : (statisticsAdmin ? "No records are available for this pay month." : "No personal records are available for this pay month.");
  }

  function renderPersonalStatistics(records) {
    if (!statisticsStatus) return;
    if (!statisticsSelectionInitialized && statisticsMonth) statisticsMonth.value = currentPayMonthKey();
    var identity = profileIdentity();
    if (!identity.upn && !identity.oid) {
      populateStatisticsMonths([]);
      statisticsSelectionInitialized = true;
      setStatisticsUnavailable("Personal statistics are unavailable.");
      return;
    }
    personalHistoryRecords = (Array.isArray(records) ? records : []).filter(function (record) { return record && (statisticsAdmin || recordOwnerMatches(record, identity)); });
    if (statisticsEmployee && statisticsEmployeeLabel && statisticsAdmin) {
      var selected = statisticsEmployee.value;
      personalHistoryRecords.forEach(function (record) {
        var key = employeeKey(record);
        if (key) statisticsEmployees[key] = String(record.employee_name || payloadFor(record).employeeName || key);
      });
      statisticsEmployee.innerHTML = '<option value="">All employees</option>' + Object.keys(statisticsEmployees).sort().map(function (key) { return '<option value="' + safe(key) + '">' + safe(statisticsEmployees[key]) + '</option>'; }).join('');
      statisticsEmployee.value = statisticsEmployees[selected] ? selected : '';
      statisticsEmployeeLabel.hidden = false;
      document.getElementById('portal-statistics-title').textContent = 'Team statistics';
      document.getElementById('portal-statistics-description').textContent = 'Review recorded team activity for a GMT pay month.';
    }
    populateStatisticsMonths(personalHistoryRecords);
    statisticsSelectionInitialized = true;
    if (statisticsRetry) statisticsRetry.hidden = true;
    return renderStatisticsForMonth();
  }

  function historyRecordKey(record) {
    var value = record && (record.source_record_id || record.record_id || record.recordId || record.id);
    if (value) return String(value);
    try { return JSON.stringify(record); } catch (_) { return String(record); }
  }

  function uniqueHistoryRecords(records) {
    var seen = Object.create(null);
    return records.filter(function (record) {
      var key = historyRecordKey(record);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  async function loadStatisticsMonth(month, forceRefresh) {
    if (!month || !window.GMTPortalApi || typeof window.GMTPortalApi.history !== "function") return;
    if (forceRefresh) {
      delete statisticsMonthCache[month];
      delete statisticsMonthLoads[month];
    }
    if (Object.prototype.hasOwnProperty.call(statisticsMonthCache, month)) { renderStatisticsForMonth(); return; }
    if (statisticsMonthLoads[month]) return statisticsMonthLoads[month];
    var sequence = ++statisticsLoadSequence;
    var load = (async function () {
      var collected = [];
      var offset = 0;
      var limit = 1000;
      var keepLoading = true;
      while (keepLoading) {
        var body = await window.GMTPortalApi.history("all", { limit: limit, offset: offset, payMonth: month });
        if (!body || !Array.isArray(body.records)) throw new Error("History response was not valid");
        collected = collected.concat(body.records);
        var pagination = body.meta && body.meta.history_pagination;
        if (pagination && pagination.has_more === true && Number.isFinite(Number(pagination.next_offset))) {
          offset = Number(pagination.next_offset);
          keepLoading = true;
        } else {
          keepLoading = false;
          if (!pagination && body.records.length === limit) { offset += limit; keepLoading = true; }
        }
      }
      statisticsMonthCache[month] = uniqueHistoryRecords(collected);
      renderPersonalStatistics(statisticsMonthCache[month]);
      if (statisticsMonth.value === month && statisticsLoadSequence === sequence) renderStatisticsForMonth();
    }());
    statisticsMonthLoads[month] = load;
    try { await load; }
    catch (error) {
      delete statisticsMonthLoads[month];
      if (statisticsMonth.value === month) {
        statisticsStatus.textContent = error && error.message ? error.message : "Records for this pay month could not be loaded.";
        if (statisticsRetry) statisticsRetry.hidden = false;
      }
    } finally {
      if (statisticsMonthLoads[month] === load) delete statisticsMonthLoads[month];
    }
  }

  function payloadFor(record) {
    if (!record || typeof record.payload !== "object" || record.payload === null) return {};
    return record.payload;
  }

  function notificationKind(record, payload) {
    if (payload && payload.editNotification) return "Timesheet change";
    var value = String(record && (record.kind || record.action || record.category || "") || "").toLowerCase();
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1 || value.indexOf("contact") !== -1) return "Enquiry";
    if (value.indexOf("task") !== -1) return "Task";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "Calendar";
    if (value.indexOf("job") !== -1) return "Job card";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "Estimate";
    if (value.indexOf("invoice") !== -1) return "Invoice";
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1) return "Clock / break";
    return "Timesheet";
  }

  function notificationTitle(record, payload) {
    var kind = notificationKind(record, payload);
    if (kind === "Timesheet change") return (payload.editNotification && payload.editNotification.targetName) || record.employee_name || "Timesheet updated";
    return record.customer_name || record.event_title || record.task_title || record.job_ref || record.estimate_number || payload.title || payload.customerName || payload.eventTitle || payload.jobReference || payload.number || kind;
  }

  function notificationDetails(record, payload) {
    var kind = notificationKind(record, payload);
    var parts = [];
    if (kind === "Timesheet change") parts.push((payload.editNotification && payload.editNotification.message) || payload.editNote || "Timesheet updated", record.record_date || record.start_date || "");
    if (kind === "Task") parts.push(payload.jobReference || record.job_reference || "Task");
    if (kind === "Enquiry") parts.push(payload.requestType || record.request_type || "General enquiry", payload.message || record.message || "");
    if (kind === "Calendar") parts.push(payload.type || record.event_type || "Calendar request", payload.date || record.event_date || record.record_date || "");
    if (kind === "Job card") parts.push(payload.client || record.client || "Job card");
    if (kind === "Estimate") parts.push(payload.company || record.client_company || "Estimate");
    if (kind === "Timesheet" || kind === "Clock / break") parts.push(record.record_date || record.start_date || "Timesheet");
    parts.push(record.status || payload.status || "Submitted");
    return parts.filter(function (part) { return String(part || "").trim(); }).join(" · ");
  }

  function notificationDate(record, payload) {
    return record.updated_at || record.submitted_at || payload.updatedAt || payload.submittedAt || record.record_date || record.event_date || "";
  }

  function truncate(value, max) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function ensureNotificationDialog() {
    if (notificationDialog) return notificationDialog;
    notificationDialog = document.createElement("dialog");
    notificationDialog.className = "portal-notification-dialog";
    notificationDialog.setAttribute("aria-labelledby", "portal-notification-dialog-title");
    notificationDialog.innerHTML = '<div class="portal-notification-dialog-header"><div><p class="eyebrow">GMT notification</p><h2 id="portal-notification-dialog-title">Submission details</h2></div><button type="button" class="secondary" data-notification-close>Close</button></div><div data-notification-dialog-body></div>';
    document.body.appendChild(notificationDialog);
    notificationDialog.addEventListener("click", function (event) {
      if (event.target === notificationDialog || event.target.closest("[data-notification-close]")) notificationDialog.close();
    });
    notificationDialog.addEventListener("cancel", function () { notificationDialog.close(); });
    return notificationDialog;
  }

  function openNotification(index) {
    var record = notificationRecords[Number(index)];
    if (!record) return;
    var payload = payloadFor(record);
    var dialog = ensureNotificationDialog();
    var body = dialog.querySelector("[data-notification-dialog-body]");
    var kind = notificationKind(record, payload);
    var title = notificationTitle(record, payload);
    var details = notificationDetails(record, payload);
    var full = Object.keys(payload).map(function (key) { return '<dt>' + safe(key.replace(/([A-Z])/g, " $1")) + '</dt><dd>' + safe(typeof payload[key] === "object" ? JSON.stringify(payload[key]) : payload[key]) + '</dd>'; }).join("");
    if (body) body.innerHTML = '<p class="portal-card-kicker">' + safe(kind) + '</p><h3>' + safe(title) + '</h3><p class="small-text">' + safe(details) + '</p><dl class="portal-notification-details"><dt>Status</dt><dd>' + safe(record.status || payload.status || "Submitted") + '</dd><dt>Submitted</dt><dd>' + safe(record.submitted_at || payload.submittedAt || "Not recorded") + '</dd><dt>Updated</dt><dd>' + safe(record.updated_at || payload.updatedAt || "Not recorded") + '</dd>' + full + '</dl><p><a class="portal-text-link" href="/portal/submissions.html?record=' + encodeURIComponent(record.source_record_id || record.record_id || "") + '">Open in Submitted documents →</a></p>';
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  }

  function renderNotifications(records) {
    if (!notificationList) return;
    // Timesheets remain visible in the dedicated history/calendar views. The
    // dashboard updates feed is reserved for operational updates such as
    // enquiries, tasks, calendar requests, job cards, estimates and invoices.
    var availableNotifications = (Array.isArray(records) ? records : []).filter(function (record) {
      var payload = payloadFor(record);
      var kind = notificationKind(record, payload);
      return kind !== "Timesheet" && kind !== "Clock / break";
    }).slice().sort(function (left, right) {
      return String(right.updated_at || right.submitted_at || "").localeCompare(String(left.updated_at || left.submitted_at || ""));
    });
    notificationRecords = availableNotifications.slice(0, 8);
    if (notificationStatus) {
      if (!availableNotifications.length) {
        notificationStatus.textContent = "No new notifications.";
      } else if (availableNotifications.length > notificationRecords.length) {
        notificationStatus.textContent = "Showing the 8 most recent of " + availableNotifications.length + " updates.";
      } else {
        notificationStatus.textContent = "Showing " + availableNotifications.length + " recent update" + (availableNotifications.length === 1 ? "." : "s.");
      }
    }
    if (!notificationRecords.length) {
      notificationList.innerHTML = '<div class="portal-notification-empty"><span aria-hidden="true">✓</span><div><strong>You\'re all caught up</strong><small>There are no new notifications right now.</small></div></div>';
      return;
    }
    notificationList.innerHTML = notificationRecords.map(function (record, index) {
      var payload = payloadFor(record);
      var kind = notificationKind(record, payload);
      var title = notificationTitle(record, payload);
      var details = notificationDetails(record, payload);
      return '<button type="button" class="portal-notification-bubble" data-notification-index="' + index + '"><span class="portal-notification-kind">' + safe(kind) + '</span><strong>' + safe(truncate(title, 64)) + '</strong><small>' + safe(truncate(details, 110)) + ' · ' + safe(truncate(notificationDate(record, payload), 28)) + '</small></button>';
    }).join("");
    notificationList.querySelectorAll("[data-notification-index]").forEach(function (button) { button.addEventListener("click", function () { openNotification(button.getAttribute("data-notification-index")); }); });
  }

  function taskTitle(record, payload) {
    return record.task_title || payload.title || record.title || "Untitled task";
  }

  function taskAssignee(record, payload) {
    return record.assignee || record.task_assignee || payload.assignee || payload.assignedTo || "Unassigned";
  }

  function taskCreator(record, payload) {
    return record.created_by || record.createdBy || payload.createdBy || payload.created_by || record.employee_name || record.employee_upn || "GMT account";
  }

  function taskProgress(record, payload) {
    var raw = record.progress;
    if (raw === undefined || raw === null || raw === "") raw = record.task_progress;
    if (raw === undefined || raw === null || raw === "") raw = payload.progress;
    var numeric = Number(raw);
    if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(numeric)) {
      var bounded = Math.max(0, Math.min(100, numeric));
      return { value: bounded, label: bounded + "%" };
    }
    var taskStatus = String(record.status || payload.status || "Submitted").trim();
    if (/complete|done/i.test(taskStatus)) return { value: 100, label: "100% · Completed" };
    if (/in[ -]?progress|working/i.test(taskStatus)) return { value: 50, label: "50% · In progress" };
    if (/assigned|to[ -]?do|pending|submitted|saved|received/i.test(taskStatus)) return { value: 0, label: "0% · " + taskStatus };
    return { value: null, label: taskStatus || "Not started" };
  }

  function taskRecords(body) {
    return body && Array.isArray(body.records) ? body.records.filter(function (record) {
      return record && (record.kind === undefined || String(record.kind).toLowerCase() === "tasks");
    }) : [];
  }

  function renderTask(record) {
    var payload = payloadFor(record);
    var progress = taskProgress(record, payload);
    var title = taskTitle(record, payload);
    var assignee = taskAssignee(record, payload);
    var creator = taskCreator(record, payload);
    var taskStatus = String(record.status || payload.status || "Submitted");
    var due = record.due_date || payload.due || "No due date";
    var job = record.job_reference || payload.jobReference || "No job reference";
    var bar = progress.value === null ? "" : '<span class="portal-task-progress-bar" style="width:' + progress.value + '%"></span>';
    return '<article class="portal-task-card">' +
      '<div class="portal-task-card-heading"><h3>' + safe(title) + '</h3><span class="portal-task-status">' + safe(taskStatus) + '</span></div>' +
      '<p class="portal-task-card-reference">' + safe(job) + ' · Due ' + safe(due) + '</p>' +
      '<dl class="portal-task-card-meta">' +
        '<div><dt>Assigned to</dt><dd>' + safe(assignee) + '</dd></div>' +
        '<div><dt>Created by</dt><dd>' + safe(creator) + '</dd></div>' +
      '</dl>' +
      '<div class="portal-task-progress"><div class="portal-task-progress-label"><strong>Progress</strong><span>' + safe(progress.label) + '</span></div>' +
        '<div class="portal-task-progress-track" role="progressbar" aria-label="' + safe(title) + ' progress" aria-valuemin="0" aria-valuemax="100"' + (progress.value === null ? '' : ' aria-valuenow="' + progress.value + '"') + '>' + bar + '</div></div>' +
      '</article>';
  }

  function renderTasks(records) {
    if (!board) return;
    if (!records.length) {
      board.innerHTML = '<p class="portal-task-board-empty">No submitted tasks are available for this account yet.</p>';
      return;
    }
    board.innerHTML = records.map(renderTask).join("");
  }

  async function loadTasks() {
    if (!board || !status) return;
    if (taskRetry) {
      taskRetry.hidden = true;
      taskRetry.disabled = true;
    }
    status.textContent = "Loading submitted tasks…";
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      status.textContent = "Protected task history is not connected.";
      renderTasks([]);
      if (taskRetry) taskRetry.disabled = false;
      return;
    }
    try {
      var body = await window.GMTPortalApi.history("tasks");
      var records = taskRecords(body);
      status.textContent = records.length ? records.length + " submitted task" + (records.length === 1 ? "" : "s") + "." : "No submitted tasks yet.";
      renderTasks(records);
    } catch (error) {
      status.textContent = error && error.message ? error.message : "Submitted tasks could not be loaded.";
      renderTasks([]);
      if (taskRetry) taskRetry.hidden = false;
    } finally {
      if (taskRetry) taskRetry.disabled = false;
    }
  }

  async function loadNotifications() {
    if (!notificationList && !statisticsStatus) return;
    if (notificationRetry) {
      notificationRetry.hidden = true;
      notificationRetry.disabled = true;
    }
    if (notificationStatus) notificationStatus.textContent = "Loading notifications…";
    if (statisticsStatus) statisticsStatus.textContent = "Loading personal statistics…";
    if (statisticsMonth) statisticsMonth.disabled = true;
    if (statisticsRetry) {
      statisticsRetry.hidden = true;
      statisticsRetry.disabled = true;
    }
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.history !== "function" || !window.GMTPortalApi.enabled || !window.GMTPortalApi.enabled()) {
      if (notificationStatus) notificationStatus.textContent = "Notifications are not connected.";
      if (notificationList) notificationList.innerHTML = '<div class="portal-notification-empty"><span aria-hidden="true">!</span><div><strong>Notifications are not connected</strong><small>Protected notifications are unavailable in this portal.</small></div></div>';
      setStatisticsUnavailable("Personal statistics are not connected.");
      if (notificationRetry) notificationRetry.disabled = false;
      return;
    }
    try {
      var access = typeof window.GMTPortalApi.access === 'function' ? await window.GMTPortalApi.access().catch(function () { return null; }) : null;
      statisticsAdmin = Boolean(access && (access.isAdmin || access.canManageSubmissions));
      var body = await window.GMTPortalApi.history("all", { limit: 500 });
      if (!body || typeof body !== "object" || !Array.isArray(body.records)) throw new Error("History response was not valid");
      renderNotifications(body.records);
      if (window.GMTPayPeriods && window.GMTPayPeriods.ready) {
        await Promise.resolve(window.GMTPayPeriods.ready).catch(function () {});
      }
      await renderPersonalStatistics([]);
    } catch (_) {
      if (notificationStatus) notificationStatus.textContent = "Notifications could not be loaded.";
      if (notificationList) notificationList.innerHTML = '<div class="portal-notification-empty"><span aria-hidden="true">!</span><div><strong>Notifications unavailable</strong><small>The Task Board status is shown separately.</small></div></div>';
      setStatisticsUnavailable("Personal statistics are unavailable.");
      if (notificationRetry) notificationRetry.hidden = false;
    } finally {
      if (notificationRetry) notificationRetry.disabled = false;
      if (statisticsRetry) statisticsRetry.disabled = false;
    }
  }

  if (taskRetry) taskRetry.addEventListener("click", loadTasks);
  if (notificationRetry) notificationRetry.addEventListener("click", loadNotifications);
  if (statisticsRetry) statisticsRetry.addEventListener("click", function () {
    if (statisticsMonth) loadStatisticsMonth(statisticsMonth.value || currentPayMonthKey(), true);
    else loadNotifications();
  });
  if (statisticsMonth) statisticsMonth.addEventListener("change", renderStatisticsForMonth);
  if (statisticsEmployee) statisticsEmployee.addEventListener("change", renderStatisticsForMonth);
  if (statisticsMonth) populateStatisticsMonths([]);
  if (window.GMTPortalApi && typeof window.GMTPortalApi.access === "function") {
    window.GMTPortalApi.access().then(function (access) {
      var userManagement = document.querySelector("[data-admin-users-link]");
      if (userManagement && access && access.isAdmin) {
        userManagement.hidden = false;
        userManagement.removeAttribute("aria-hidden");
      }
    }).catch(function () {});
  }
  window.GMT_PORTAL_DASHBOARD_READY = Promise.allSettled([loadTasks(), loadNotifications()]);
}());
