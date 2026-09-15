(function () {
  "use strict";

  // The dashboard, Submitted documents and the timesheet page all need the
  // same day-level interpretation of protected records. Keep that boundary
  // in one small browser helper so a weekly header cannot make the shared
  // calendars look empty while the timesheet page can still see its rows.
  function text(value) { return String(value == null ? "" : value).trim(); }
  function key(value) {
    var match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + "-" + match[2] + "-" + match[3] : "";
  }
  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }
  function objectValue(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    var actualKeys = Object.keys(value);
    for (var index = 0; index < keys.length; index += 1) {
      var wanted = String(keys[index]).toLowerCase();
      var actual = actualKeys.find(function (candidate) { return candidate.toLowerCase() === wanted; });
      if (actual) return value[actual];
    }
    return "";
  }
  function parsed(value) {
    if (value && typeof value === "object") return value;
    var raw = text(value);
    if (!/^[\[{]/.test(raw)) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  var ROW_KEYS = [
    "rows", "daily_rows", "dailyRows", "records", "values", "data", "items",
    "entries", "dayRows", "daily", "timesheet", "timesheets"
  ];
  var ENVELOPE_KEYS = ["payload", "body", "result", "response", "content", "value", "item", "fields", "properties"];
  var ROW_VALUE_KEYS = [
    "date", "record_date", "recordDate", "workDate", "day", "start", "startTime", "start_time",
    "clockIn", "clock_in", "finish", "finishTime", "finish_time", "clockOut", "clock_out",
    "workedMinutes", "worked_minutes", "workedHours", "worked_hours", "hours", "totalHours",
    "basicHours", "basic_hours", "ot15Hours", "ot15_hours", "ot20Hours", "ot20_hours",
    "lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break", "absenceStatus",
    "absence_status", "absenceReason", "absence_reason", "absence", "action", "clockAction", "clock_action",
    "time", "timestamp"
  ];
  function hasRowValue(value) {
    return ROW_VALUE_KEYS.some(function (key) {
      var actual = objectValue(value, [key]);
      return actual !== "" && actual !== null && actual !== undefined;
    });
  }
  function collectRows(value, depth, seen) {
    if (depth > 8) return [];
    var candidate = parsed(value);
    if (!candidate) return [];
    if (Array.isArray(candidate)) {
      var arrayRows = [];
      candidate.forEach(function (item) {
        var nestedRows = collectRows(item, depth + 1, seen);
        if (nestedRows.length) arrayRows = arrayRows.concat(nestedRows);
        else if (item && typeof item === "object" && !Array.isArray(item) && hasRowValue(item)) arrayRows.push(item);
      });
      return arrayRows.slice(0, 80);
    }
    if (typeof candidate !== "object") return [];
    seen = seen || [];
    if (seen.indexOf(candidate) !== -1) return [];
    seen.push(candidate);
    // Prefer known row containers before treating an envelope carrying a
    // summary date as the row itself. This preserves every day in nested
    // Power Automate responses such as { data: { values: [...] } }.
    for (var keyIndex = 0; keyIndex < ROW_KEYS.length; keyIndex += 1) {
      var nested = objectValue(candidate, [ROW_KEYS[keyIndex]]);
      if (nested === "" || nested === null || nested === undefined) continue;
      var rows = collectRows(nested, depth + 1, seen);
      if (rows.length) return rows.slice(0, 80);
    }
    if (hasRowValue(candidate)) return [candidate];
    for (var envelopeIndex = 0; envelopeIndex < ENVELOPE_KEYS.length; envelopeIndex += 1) {
      var envelope = objectValue(candidate, [ENVELOPE_KEYS[envelopeIndex]]);
      if (envelope === "" || envelope === null || envelope === undefined) continue;
      var envelopeRows = collectRows(envelope, depth + 1, seen);
      if (envelopeRows.length) return envelopeRows.slice(0, 80);
    }
    return [];
  }
  function rowsFor(record) {
    var payload = parsed(record && record.payload) || parsed(record && record.payload_json) || {};
    var payloadRows = collectRows(payload, 0, []);
    if (payloadRows.length) return payloadRows;
    var recordRows = collectRows(record && (record.rows || record.daily_rows || record.dailyRows || record.records || record.values || record.data), 0, []);
    if (recordRows.length) return recordRows;
    // A weekly header normally has `record_date` but no daily fields. Keep the
    // source record addressable for history and detail views, but do not place
    // a synthetic marker on the shared calendar. Only promote a direct object
    // to a day row when it also carries a daily time, hour, break or absence
    // value.
    var directDate = objectValue(record, ["date", "record_date", "recordDate", "workDate", "day"]);
    var directTime = objectValue(record, ["start", "startTime", "start_time", "clockIn", "clock_in", "finish", "finishTime", "finish_time", "clockOut", "clock_out"]);
    var directDailyValue = objectValue(record, ["workedMinutes", "worked_minutes", "workedHours", "worked_hours", "hours", "totalHours", "basicHours", "basic_hours", "lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break", "absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"]);
    return directDate && (directTime || directDailyValue) ? [record] : [];
  }
  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    var parsedNumber = Number(value);
    return Number.isFinite(parsedNumber) ? parsedNumber : null;
  }
  function breakMinutes(value) {
    var numeric = number(value);
    if (numeric !== null) return numeric;
    var raw = text(value).toLowerCase();
    if (!raw || /^(no\s*break|none|not[- ]?taken|no)$/.test(raw)) return raw ? 0 : null;
    var hours = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    var minutes = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
    return hours || minutes ? (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0) : null;
  }
  function timeMinutes(value) {
    var raw = text(value).toLowerCase();
    var match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2] || 0);
    if (minute > 59) return null;
    if (match[3]) {
      if (hour < 1 || hour > 12) return null;
      if (match[3].toLowerCase() === "pm" && hour < 12) hour += 12;
      if (match[3].toLowerCase() === "am" && hour === 12) hour = 0;
    }
    return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
  }
  function formatHours(value) {
    var numeric = number(value);
    if (numeric === null) return "hours missing";
    var rounded = Math.round(numeric * 10) / 10;
    return String(rounded).replace(/\.0$/, "") + "h";
  }
  function formatMinutes(value) {
    var numeric = number(value);
    if (numeric === null) return "hours missing";
    var minutes = Math.max(0, Math.round(numeric));
    var hours = Math.floor(minutes / 60);
    var remainder = minutes % 60;
    return hours ? hours + "h" + (remainder ? " " + String(remainder).padStart(2, "0") + "m" : "") : remainder + "m";
  }
  function weekday(value) {
    var date = key(value);
    if (!date) return null;
    var parts = date.split("-").map(Number);
    var day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return day === 0 ? 7 : day;
  }
  function schedule(record, options) {
    var value = record && (record.schedule_weekdays || record.scheduleWeekdays || record.workdays);
    if (Array.isArray(value)) return value.map(function (item) { return Number(item); }).filter(function (item) { return item >= 1 && item <= 7; });
    var payload = parsed(record && record.payload) || {};
    value = payload.scheduleWeekdays || payload.workdays;
    if (Array.isArray(value)) return value.map(function (item) { return Number(item); }).filter(function (item) { return item >= 1 && item <= 7; });
    var employees = options && (options.employees || options.schedules);
    if (!Array.isArray(employees)) return [];
    var upn = text(record && (record.employee_upn || record.employeeEmail || record.employee_email)).toLowerCase();
    var name = text(record && (record.employee_name || record.employeeName)).toLowerCase();
    var match = employees.find(function (employee) {
      return (upn && text(employee && (employee.employee_upn || employee.upn || employee.email)).toLowerCase() === upn)
        || (name && text(employee && (employee.employee_name || employee.name)).toLowerCase() === name);
    });
    value = match && (match.schedule_weekdays || match.scheduleWeekdays || match.workdays);
    return Array.isArray(value) ? value.map(function (item) { return Number(item); }).filter(function (item) { return item >= 1 && item <= 7; }) : [];
  }
  function employee(record) { return text(record && (record.employee_name || record.employee_upn || record.owner || "Submission")); }
  function kind(record) {
    var value = text(record && (record.kind || record.action || record.type || "timesheet")).toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("timesheet") !== -1 || value.indexOf("submission") !== -1 || value.indexOf("weekly") !== -1) return "timesheets";
    if (value.indexOf("calendar") !== -1 || value.indexOf("leave") !== -1 || value.indexOf("event") !== -1) return "calendar";
    if (value.indexOf("task") !== -1) return "tasks";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    return value || "general";
  }
  function recordId(record) { return text(record && (record.source_record_id || record.record_id || record.id)); }
  function rowEvent(record, row, index, options) {
    var date = key(objectValue(row, ["date", "record_date", "recordDate", "workDate", "day"]) || record && (record.record_date || record.start_date));
    if (!date) return null;
    var start = text(objectValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in", "dayStart", "day_start", "Start"]));
    var finish = text(objectValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out", "dayFinish", "day_finish", "Finish"]));
    var worked = number(objectValue(row, ["workedMinutes", "worked_minutes"]));
    if (worked === null) {
      var hours = number(objectValue(row, ["workedHours", "worked_hours", "hours", "totalHours", "Worked hours"]));
      if (hours !== null) worked = hours * 60;
    }
    if (worked === null) {
      var basic = number(objectValue(row, ["basicHours", "basic_hours", "Basic hours"]));
      var ot15 = number(objectValue(row, ["ot15Hours", "ot15_hours", "overtime15Hours"]));
      var ot20 = number(objectValue(row, ["ot20Hours", "ot20_hours", "overtime20Hours"]));
      if (basic !== null || ot15 !== null || ot20 !== null) worked = ((basic || 0) + (ot15 || 0) + (ot20 || 0)) * 60;
    }
    var absence = text(objectValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence", "Absence reason"]));
    var lunchStart = text(objectValue(row, ["lunchStart", "lunch_start", "breakStart", "break_start", "Lunch start"]));
    var lunchEnd = text(objectValue(row, ["lunchEnd", "lunch_end", "breakEnd", "break_end", "Lunch end"]));
    var breakValue = objectValue(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break", "Break"]);
    var breakStatus = text(objectValue(row, ["breakStatus", "break_status"]));
    var scheduleDays = schedule(record, options);
    var explicitScheduled = objectValue(row, ["scheduled"]);
    var scheduled = explicitScheduled === false || String(explicitScheduled).toLowerCase() === "false"
      ? false
      : (!scheduleDays.length || scheduleDays.indexOf(weekday(date)) !== -1);
    var issues = [];
    if (scheduleDays.length && !scheduled) issues.push("Outside configured work schedule");
    if (!absence || /^(na|none|no absence|not applicable|n\/a)$/i.test(absence)) {
      if (!start) issues.push("Clock in missing");
      if (!finish) issues.push("Clock out missing");
      if (start && finish && timeMinutes(finish) !== null && timeMinutes(start) !== null) {
        if (timeMinutes(finish) === timeMinutes(start)) issues.push("Clock in and clock out are the same time");
        else if (timeMinutes(finish) < timeMinutes(start)) issues.push("Finish earlier than clock in");
      }
      if (!breakStatus && breakMinutes(breakValue) === null) issues.push("Break not recorded");
    }
    var breakTotal = breakMinutes(breakValue);
    if (breakTotal === null && lunchStart && lunchEnd && timeMinutes(lunchStart) !== null && timeMinutes(lunchEnd) !== null) breakTotal = Math.max(0, timeMinutes(lunchEnd) - timeMinutes(lunchStart));
    if (worked === null && start && finish && timeMinutes(start) !== null && timeMinutes(finish) !== null && timeMinutes(finish) >= timeMinutes(start)) worked = Math.max(0, timeMinutes(finish) - timeMinutes(start) - (breakTotal || 0));
    if (!breakStatus && breakTotal !== null) breakStatus = breakTotal > 0 ? "added" : "not-taken";
    var detail = absence && !/^(na|none|no absence|not applicable|n\/a)$/i.test(absence)
      ? absence
      : (worked === null ? "hours missing" : formatMinutes(worked));
    if (start || finish) detail += " · " + (start || "missing") + "–" + (finish || "missing");
    if (issues.length) detail += " · review";
    return {
      id: recordId(record) + "|" + date + "|" + index,
      recordId: recordId(record),
      date: date,
      title: employee(record),
      type: kind(record),
      owner: employee(record),
      status: text(record && record.status) || "Submitted",
      detail: detail,
      issue: issues.join("; "),
      record: record,
      row: row,
      scheduled: scheduled
    };
  }
  function dateFallback(record, options) {
    var start = key(record && (record.record_date || record.start_date || record.event_date || record.planned_date || record.due_date));
    if (!start) return [];
    var recordKind = kind(record);
    var scheduleDays = schedule(record, options);
    if (scheduleDays.length && (recordKind === "timesheets" || recordKind === "clock") && scheduleDays.indexOf(weekday(start)) === -1) return [];
    var issue = text(record && record.issue);
    var detail = text(record && (record.event_title || record.job_ref || record.estimate_number || record.action || "Record"));
    if (recordKind === "timesheets" && (record && (record.daily_detail_issue || record.issue))) {
      issue = issue || "Daily rows unavailable";
      detail = "Daily detail unavailable";
    } else if (!detail) {
      detail = text(record && record.title) || "Record";
    }
    return [{ id: recordId(record) + "|" + start, recordId: recordId(record), date: start, title: employee(record), type: recordKind, owner: employee(record), status: text(record && record.status) || "Submitted", detail: detail, issue: issue, record: record, row: null, scheduled: true }];
  }
  function recordUpdatedAt(record) {
    var value = record && (record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || record.created_at || record.createdAt);
    var timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  function recordWeekStart(record) {
    var candidate = key(record && (record.start_date || record.startDate || record.record_date || record.recordDate || record.end_date || record.endDate));
    if (!candidate) return "";
    var parts = candidate.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
    if (Number.isNaN(date.getTime())) return "";
    var offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }
  function timesheetQuality(record) {
    var rows = rowsFor(record);
    if (!rows.length) return { valid: false, validRows: 0, rowCount: 0 };
    var events = rows.map(function (row, index) { return rowEvent(record, row, index, {}); }).filter(Boolean).filter(function (event) { return event.scheduled !== false; });
    if (!events.length) return { valid: false, validRows: 0, rowCount: 0 };
    var validRows = events.filter(function (event) {
      if (event.issue && /same time|earlier than clock|clock in missing|clock out missing/i.test(event.issue)) return false;
      return true;
    }).length;
    return { valid: validRows === events.length, validRows: validRows, rowCount: events.length };
  }
  function preferTimesheet(candidate, existing) {
    if (!existing) return true;
    var left = timesheetQuality(candidate);
    var right = timesheetQuality(existing);
    if (left.valid !== right.valid) return left.valid;
    var leftUpdated = recordUpdatedAt(candidate);
    var rightUpdated = recordUpdatedAt(existing);
    if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated;
    if (left.validRows !== right.validRows) return left.validRows > right.validRows;
    if (left.rowCount !== right.rowCount) return left.rowCount > right.rowCount;
    return String(recordId(candidate)).localeCompare(String(recordId(existing))) > 0;
  }
  function authoritativeTimesheetRecords(records) {
    var grouped = {};
    var passthrough = [];
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (kind(record) !== "timesheets") {
        passthrough.push(record);
        return;
      }
      var identity = text(record && (record.employee_upn || record.employee_email || record.employeeEmail || record.employee_name || record.employeeName || employee(record))).toLowerCase();
      var week = recordWeekStart(record);
      if (!identity || !week) {
        passthrough.push(record);
        return;
      }
      var groupKey = identity + "|" + week;
      if (!grouped[groupKey] || preferTimesheet(record, grouped[groupKey])) grouped[groupKey] = record;
    });
    return passthrough.concat(Object.keys(grouped).map(function (groupKey) { return grouped[groupKey]; }));
  }
  function eventEmployeeKey(event) {
    var record = event && event.record || {};
    return text(record.employee_upn || record.employee_email || record.employeeEmail || record.employee_name || record.employeeName || event && (event.owner || event.title)).toLowerCase();
  }
  function eventValidity(event) {
    var issue = text(event && event.issue);
    if (/same time|earlier than clock|clock in missing|clock out missing/i.test(issue)) return 0;
    return issue ? 1 : 2;
  }
  function eventDetailScore(event) {
    var row = event && event.row || {};
    var score = 0;
    if (objectValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"])) score += 2;
    if (objectValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"])) score += 2;
    if (objectValue(row, ["workedMinutes", "worked_minutes", "workedHours", "worked_hours", "hours", "totalHours"])) score += 2;
    if (objectValue(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break"]) !== "") score += 1;
    if (event && event.type === "timesheets") score += 1;
    return score;
  }
  function preferEvent(candidate, existing) {
    if (!existing) return true;
    var leftValidity = eventValidity(candidate);
    var rightValidity = eventValidity(existing);
    if (leftValidity !== rightValidity) return leftValidity > rightValidity;
    var leftUpdated = recordUpdatedAt(candidate && candidate.record);
    var rightUpdated = recordUpdatedAt(existing && existing.record);
    if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated;
    var leftDetail = eventDetailScore(candidate);
    var rightDetail = eventDetailScore(existing);
    if (leftDetail !== rightDetail) return leftDetail > rightDetail;
    return String(candidate && candidate.recordId || candidate && candidate.id || '').localeCompare(String(existing && existing.recordId || existing && existing.id || '')) > 0;
  }
  function recordsToEvents(records, options) {
    var events = [];
    authoritativeTimesheetRecords(records).forEach(function (record) {
      var recordKind = kind(record);
      if (recordKind === "timesheets" || recordKind === "clock") {
        var rows = rowsFor(record);
        var rowEvents = rows.map(function (row, index) { return rowEvent(record, row, index, options); }).filter(Boolean);
        if (rowEvents.length) {
          // A roster schedule is authoritative for the shared calendar. Keep
          // the source record available in history, but do not label a day as
          // worked when it falls outside the employee's configured workdays.
          // Michelle, for example, is rostered on Tuesday and Wednesday only.
          events = events.concat(rowEvents.filter(function (event) { return event.scheduled !== false; }));
        } else if (!rows.length) {
          // A sparse header has no day to place on the calendar. Showing its
          // anchor would imply that a submission was made on that date.
          events = events.concat(recordKind === "timesheets" ? [] : dateFallback(record, options));
        }
      } else events = events.concat(dateFallback(record, options));
    });
    // A single employee can have overlapping weekly submissions (for example
    // a correction covering 7–13 September followed by a second submission
    // covering 14–21 September). Collapse those source variants at the
    // employee/day boundary so the shared calendar shows one authoritative,
    // valid label per day while history still retains every source record.
    var byEmployeeDate = {};
    var nonTimesheetEvents = [];
    events.forEach(function (event) {
      if (!event || !event.date || ["timesheets", "clock"].indexOf(event.type) === -1) {
        nonTimesheetEvents.push(event);
        return;
      }
      var identity = eventEmployeeKey(event);
      if (!identity) {
        nonTimesheetEvents.push(event);
        return;
      }
      var groupKey = identity + "|" + event.date;
      if (!byEmployeeDate[groupKey] || preferEvent(event, byEmployeeDate[groupKey])) byEmployeeDate[groupKey] = event;
    });
    var collapsedEvents = nonTimesheetEvents.concat(Object.keys(byEmployeeDate).map(function (groupKey) { return byEmployeeDate[groupKey]; }));
    var seen = {};
    return collapsedEvents.filter(function (event) {
      if (!event || !event.date) return false;
      var id = event.id || [event.date, event.title, event.type, event.detail].join("|");
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  window.GMTCalendarData = { safe: safe, key: key, kind: kind, recordsToEvents: recordsToEvents, rowsFor: rowsFor, authoritativeTimesheetRecords: authoritativeTimesheetRecords };
}());
