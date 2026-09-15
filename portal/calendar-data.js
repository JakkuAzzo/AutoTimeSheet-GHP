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
  function rowsFor(record) {
    var payload = parsed(record && record.payload) || parsed(record && record.payload_json) || {};
    var candidates = [
      Array.isArray(payload) ? payload : null,
      payload.rows, payload.daily_rows, payload.dailyRows, payload.records,
      record && record.rows, record && record.daily_rows, record && record.dailyRows
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = parsed(candidates[index]);
      if (Array.isArray(candidate)) return candidate.filter(function (row) { return row && typeof row === "object"; }).slice(0, 80);
    }
    var directDate = objectValue(record, ["date", "record_date", "recordDate", "workDate"]);
    var directTime = objectValue(record, ["start", "startTime", "start_time", "clockIn", "clock_in", "finish", "finishTime", "finish_time", "clockOut", "clock_out"]);
    return directDate || directTime ? [record] : [];
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
  function schedule(record) {
    var value = record && (record.schedule_weekdays || record.scheduleWeekdays || record.workdays);
    if (Array.isArray(value)) return value.map(function (item) { return Number(item); }).filter(function (item) { return item >= 1 && item <= 7; });
    var payload = parsed(record && record.payload) || {};
    value = payload.scheduleWeekdays || payload.workdays;
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
  function rowEvent(record, row, index) {
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
    var scheduleDays = schedule(record);
    var explicitScheduled = objectValue(row, ["scheduled"]);
    var scheduled = explicitScheduled === false || String(explicitScheduled).toLowerCase() === "false"
      ? false
      : (!scheduleDays.length || scheduleDays.indexOf(weekday(date)) !== -1);
    var issues = [];
    if (scheduleDays.length && !scheduled) issues.push("Outside configured work schedule");
    if (!absence || /^(na|none|no absence|not applicable|n\/a)$/i.test(absence)) {
      if (!start) issues.push("Clock in missing");
      if (!finish) issues.push("Clock out missing");
      if (start && finish && timeMinutes(finish) !== null && timeMinutes(start) !== null && timeMinutes(finish) < timeMinutes(start)) issues.push("Finish earlier than clock in");
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
  function dateFallback(record) {
    var start = key(record && (record.record_date || record.start_date || record.event_date || record.planned_date || record.due_date));
    if (!start) return [];
    return [{ id: recordId(record) + "|" + start, recordId: recordId(record), date: start, title: employee(record), type: kind(record), owner: employee(record), status: text(record && record.status) || "Submitted", detail: text(record && (record.event_title || record.title || record.job_ref || record.estimate_number || record.action || "Record")), issue: "", record: record, row: null, scheduled: true }];
  }
  function recordsToEvents(records) {
    var events = [];
    (Array.isArray(records) ? records : []).forEach(function (record) {
      var recordKind = kind(record);
      if (recordKind === "timesheets" || recordKind === "clock") {
        var rows = rowsFor(record);
        var rowEvents = rows.map(function (row, index) { return rowEvent(record, row, index); }).filter(Boolean);
        events = events.concat(rowEvents.length ? rowEvents : dateFallback(record));
      } else events = events.concat(dateFallback(record));
    });
    var seen = {};
    return events.filter(function (event) {
      if (!event || !event.date) return false;
      var id = event.id || [event.date, event.title, event.type, event.detail].join("|");
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  window.GMTCalendarData = { safe: safe, key: key, kind: kind, recordsToEvents: recordsToEvents, rowsFor: rowsFor };
}());
