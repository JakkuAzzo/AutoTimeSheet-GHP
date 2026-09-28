(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GMTPayMonthWorkbook = factory();
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var dailyColumns = ["Date", "Start", "Finish", "Break", "Absence", "Total hours", "Notes"];
  var weeklyColumns = ["Week Start", "Week End", "Total hours"];

  function field(row, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (row && row[keys[i]] !== undefined && row[keys[i]] !== null && row[keys[i]] !== "") return row[keys[i]];
    }
    return "";
  }

  function asText(value) { return value === null || value === undefined ? "" : String(value); }

  function asNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    var result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function timeMinutes(value) {
    var match = asText(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
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

  function breakMinutes(row) {
    var raw = field(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break"]);
    if (raw === true) raw = "";
    if (raw === false) return 0;
    var direct = asNumber(raw);
    if (direct !== null) return Math.max(0, direct);
    var match = asText(raw).match(/(\d+)\s*(?:min|minute)/i);
    if (match) return Number(match[1]);
    if (/^(?:no break|none)$/i.test(asText(raw).trim()) || row && row.lunchHad === false) return 0;
    var note = asText(field(row, ["description", "note", "notes", "Note"]));
    var recorded = note.match(/\bbreak\s*:\s*(\d+(?:\.\d+)?)\s*minutes?\s*deducted\b/i);
    if (recorded) return Number(recorded[1]);
    if (/\bbreak\s*:\s*(?:no break|not taken|none)\b/i.test(note)) return 0;
    return null;
  }

  function workedMinutes(row, start, finish, pause) {
    var startMinutes = timeMinutes(start);
    var finishMinutes = timeMinutes(finish);
    var absence = asText(field(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"])).trim();
    // Paid holiday contributes one standard 8-hour day to the pay-month total,
    // while sick/other absences remain zero unless the source has clocks.
    if (startMinutes === null && finishMinutes === null && /^holiday$/i.test(absence)) return 480;
    // A corrected absence with no clocks supersedes any worked total cached
    // on the earlier version of that day's row.
    if (startMinutes === null && finishMinutes === null && /^(?:sick|absent|time off)$/i.test(absence)) return 0;
    var direct = asNumber(field(row, ["workedMinutes", "worked_minutes"]));
    var hours = asNumber(field(row, ["workedHours", "worked_hours", "hours", "totalHours", "Worked hours"]));
    if (startMinutes !== null && finishMinutes !== null) {
      if (finishMinutes < startMinutes) return null;
      if (pause !== null) return Math.max(0, finishMinutes - startMinutes - pause);
      // The source may already contain a calculated total even when it did
      // not specify a break. Keep that total instead of losing the whole day.
      if (direct !== null) return Math.max(0, Math.round(direct));
      if (hours !== null) return Math.max(0, Math.round(hours * 60));
      // Gross elapsed time is useful, but must remain visibly provisional.
      return finishMinutes - startMinutes;
    }
    if (direct !== null) return Math.max(0, Math.round(direct));
    if (hours !== null) return Math.max(0, Math.round(hours * 60));
    return null;
  }

  function isoDate(row) {
    var value = asText(field(row, ["date", "recordDate", "record_date", "workDate", "Date"]));
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  }

  function workedMinutesForRow(row) {
    var start = field(row, ["start", "startTime", "start_time", "clockIn", "clock_in"]);
    var finish = field(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"]);
    return workedMinutes(row, start, finish, breakMinutes(row));
  }

  function provisionalForRow(row) {
    if (breakMinutes(row) !== null || asNumber(field(row, ["workedMinutes", "worked_minutes", "workedHours", "worked_hours", "hours", "totalHours", "Worked hours"])) !== null) return false;
    var start = timeMinutes(field(row, ["start", "startTime", "start_time", "clockIn", "clock_in"]));
    var finish = timeMinutes(field(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"]));
    return start !== null && finish !== null && finish >= start;
  }

  function weekBounds(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    var day = new Date(date + "T00:00:00Z");
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    var start = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 6);
    return { start: start, end: day.toISOString().slice(0, 10) };
  }

  function hoursLabel(minutes) {
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "";
    var rounded = Math.round(minutes);
    return Math.floor(rounded / 60) + "h " + String(rounded % 60).padStart(2, "0") + "m";
  }

  function toWorkbookData(sheet, period) {
    var items = Array.isArray(sheet && sheet.rows) ? sheet.rows : [];
    var weeks = {};
    var firstWeek = weekBounds(period && period.start);
    var lastWeek = weekBounds(period && period.end);
    if (firstWeek && lastWeek && firstWeek.start <= lastWeek.start) {
      var cursor = new Date(firstWeek.start + "T00:00:00Z");
      while (cursor.toISOString().slice(0, 10) <= lastWeek.start) {
        var bounds = weekBounds(cursor.toISOString().slice(0, 10));
        weeks[bounds.start] = { end: bounds.end, minutes: 0, hasWorked: false };
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
    }
    var undatedMinutes = 0;
    var totalMinutes = 0;
    var knownWorkedRows = 0;
    var dailyEntries = items.map(function (item) {
      var row = item && item.row && typeof item.row === "object" ? item.row : {};
      var date = isoDate(row);
      var start = asText(field(row, ["start", "startTime", "start_time", "clockIn", "clock_in"]));
      var finish = asText(field(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"]));
      var pause = breakMinutes(row);
      var worked = workedMinutes(row, start, finish, pause);
      var notes = asText(field(row, ["description", "note", "notes", "Note"]));
      if (provisionalForRow(row)) notes += (notes ? " · " : "") + "Break not recorded; total before any break deduction";
      else if (pause === null && worked !== null) notes += (notes ? " · " : "") + "Break not recorded; total from source";
      var bounds = weekBounds(date);
      if (bounds && !weeks[bounds.start]) weeks[bounds.start] = { end: bounds.end, minutes: 0, hasWorked: false };
      if (worked !== null) {
        knownWorkedRows += 1;
        totalMinutes += worked;
        if (bounds) { weeks[bounds.start].minutes += worked; weeks[bounds.start].hasWorked = true; }
        else undatedMinutes += worked;
      }
      return {
        Date: date,
        Start: start,
        Finish: finish,
        Break: pause === null ? "" : pause,
        Absence: asText(field(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"])) || "NA",
        "Total hours": worked === null ? "" : worked,
        Notes: notes
      };
    });
    var weeklyTotals = Object.keys(weeks).sort().map(function (start) {
      var week = weeks[start];
      return { "Week Start": start, "Week End": week.end, "Total hours": week.hasWorked ? week.minutes : "" };
    });
    if (undatedMinutes) weeklyTotals.push({ "Week Start": "Undated", "Week End": "", "Total hours": undatedMinutes });
    weeklyTotals.push({ "Week Start": "Month total", "Week End": "", "Total hours": knownWorkedRows ? totalMinutes : "" });
    return { columns: dailyColumns, dailyEntries: dailyEntries, weeklyColumns: weeklyColumns, weeklyTotals: weeklyTotals };
  }

  function toWorkbookMatrices(sheet, period) {
    var data = toWorkbookData(sheet, period);
    var dailyMatrix = [data.columns].concat(data.dailyEntries.map(function (row) {
      return data.columns.map(function (column) { return column === "Total hours" ? hoursLabel(row[column]) : row[column] === undefined ? "" : row[column]; });
    }));
    var weeklyMatrix = [data.weeklyColumns].concat(data.weeklyTotals.map(function (row) {
      return data.weeklyColumns.map(function (column) { return column === "Total hours" ? hoursLabel(row[column]) : row[column] === undefined ? "" : row[column]; });
    }));
    var monthTotal = data.weeklyTotals[data.weeklyTotals.length - 1]["Total hours"];
    dailyMatrix.push(data.columns.map(function (column) {
      return column === "Date" ? "Pay month total" : column === "Total hours" ? hoursLabel(monthTotal) : "";
    }));
    return { data: data, dailyMatrix: dailyMatrix, weeklyMatrix: weeklyMatrix };
  }

  return { toWorkbookData: toWorkbookData, toWorkbookMatrices: toWorkbookMatrices, workedMinutesForRow: workedMinutesForRow, breakMinutesForRow: breakMinutes, provisionalForRow: provisionalForRow };
}));
