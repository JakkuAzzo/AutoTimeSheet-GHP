(function () {
  "use strict";

  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("history-frame-status");
  var list = document.getElementById("history-frame-list");
  var params = new URLSearchParams(window.location.search);
  var filter = params.get("filter") || "all";
  var editId = params.get("edit") || "";
  var records = [];
  var requestInFlight = false;
  var notice = "All timesheets made by this user may be viewed, but only timesheets made within the current month may be edited.";

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function notify(message) {
    if (window.parent && window.parent !== window) window.parent.postMessage({ type: "gmt:history-status", message: message }, window.location.origin);
  }

  function notifyMeta(meta) {
    if (window.parent && window.parent !== window) window.parent.postMessage({ type: "gmt:history-meta", meta: meta || {} }, window.location.origin);
  }

  function actionKey(record) {
    var value = String(record.kind || record.action || record.category || record.record_type || "timesheet").toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1 || value.indexOf("request") !== -1) return "tasks";
    return "timesheets";
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
      source_record_id: record.source_record_id || record.sourceRecordId || "",
      can_edit: record.can_edit === true
    };
  }

  function readRecords(body) {
    if (!body || typeof body !== "object" || !Array.isArray(body.records)) return null;
    return body.records.map(projectedRecord).filter(Boolean);
  }

  function showEmpty(message) {
    if (list) list.innerHTML = '<p class="small-text portal-history-empty">' + safe(message) + "</p>";
  }

  function render() {
    var visible = filter === "all" ? records : records.filter(function (record) { return actionKey(record) === filter; });
    if (!visible.length) {
      showEmpty(records.length ? "No submissions match this filter." : "No records are displayed until the protected history service responds.");
      return;
    }
    list.innerHTML = visible.map(function (record) {
      var key = actionKey(record);
      var statusClass = String(record.status || "Submitted").toLowerCase().replace(/\s+/g, "-");
      var action = String(record.action || "Timesheet").replace(/_/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
      var date = record.record_date || "";
      var period = date ? "Date " + date : "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
      var edit = record.can_edit && key === "timesheets" && record.source_record_id
        ? "history-frame.html?edit=" + encodeURIComponent(record.source_record_id)
        : "";
      var viewOnly = key === "timesheets" && !edit ? '<p class="small-text">This timesheet is view-only outside the current month.</p>' : "";
      return '<article class="portal-item" data-history-kind="' + safe(key) + '"><strong>' + safe(record.employee_name || action) + '</strong>' +
        '<span class="portal-status ' + safe(statusClass) + '">' + safe(record.status || "Submitted") + '</span>' +
        '<p class="portal-item-meta">' + safe(action) + " · " + safe(period) + "</p>" +
        '<p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || "not recorded") + "</p>" +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + "</p>" : "") +
        viewOnly +
        (edit ? '<div class="portal-item-actions"><a class="button button-link" href="' + safe(edit) + '">Edit spreadsheet</a></div>' : "") +
        "</article>";
    }).join("");
  }

  function hasEndpoint() {
    return String(config.portalApiEndpoint || config.portalHistoryEndpoint || config.timesheetHistoryEndpoint || "").trim();
  }

  function dayName(value) {
    var date = new Date(String(value || "") + "T12:00:00");
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(date);
  }

  function currentMonth() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === "year"; });
    var month = parts.find(function (part) { return part.type === "month"; });
    return (year && year.value ? year.value : "") + "-" + (month && month.value ? month.value : "");
  }

  function minutes(value) {
    var match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
  }

  function calculateRows(rows) {
    var totals = { workedActual: 0, total: 0, basic: 0, ot15: 0, ot20: 0, holiday: 0, sick: 0, timeOff: 0, errors: [] };
    var result = rows.map(function (row, index) {
      var copy = Object.assign({}, row, { label: row.label || "Day " + (index + 1), dayName: dayName(row.date) });
      if (copy.absenceStatus === "Holiday") {
        copy.workedActual = 0; copy.basic = 480; copy.ot15 = 0; copy.ot20 = 0; copy.appliedBasic = 480; copy.appliedOt15 = 0; copy.appliedOt20 = 0; copy.appliedTotal = 480; totals.holiday += 1;
      } else if (copy.absenceStatus === "Sick") {
        copy.workedActual = 0; copy.basic = 0; copy.ot15 = 0; copy.ot20 = 0; copy.appliedBasic = 0; copy.appliedOt15 = 0; copy.appliedOt20 = 0; copy.appliedTotal = 0; totals.sick += 1;
      } else {
        var start = minutes(copy.start); var finish = minutes(copy.finish);
        if (start === null || finish === null) {
          copy.error = "Start and finish are required unless this is Sick or Holiday.";
          copy.workedActual = 0; copy.basic = 0; copy.ot15 = 0; copy.ot20 = 0; copy.appliedBasic = 0; copy.appliedOt15 = 0; copy.appliedOt20 = 0; copy.appliedTotal = 0; totals.errors.push(copy.label + ": " + copy.error);
        } else {
          if (finish < start) finish += 1440;
          var worked = Math.max(0, finish - start - (Number(copy.lunchMinutes) || 0));
          copy.workedActual = worked; copy.basic = worked; copy.ot15 = 0; copy.ot20 = 0; copy.appliedBasic = worked; copy.appliedOt15 = 0; copy.appliedOt20 = 0; copy.appliedTotal = worked;
          if (copy.absenceStatus === "Time Off") totals.timeOff += 1;
        }
      }
      totals.workedActual += copy.workedActual || 0;
      totals.basic += copy.appliedBasic || 0;
      totals.ot15 += copy.appliedOt15 || 0;
      totals.ot20 += copy.appliedOt20 || 0;
      totals.total += copy.appliedTotal || 0;
      return copy;
    });
    return { rows: result, totals: totals, weightedHours: totals.basic / 60 + (totals.ot15 / 60) * 1.5 + (totals.ot20 / 60) * 2 };
  }

  function renderEditor(record, payload) {
    var rows = Array.isArray(payload.rows) ? payload.rows : [];
    var weekStart = String(payload.weekStart || record.start_date || "");
    var weekEnd = String(payload.weekEnd || record.end_date || "");
    list.innerHTML = '<section class="timesheet-editor" aria-labelledby="timesheet-editor-title">' +
      '<a class="portal-text-link" href="history-frame.html?filter=all">← Back to submissions</a>' +
      '<h2 id="timesheet-editor-title">Edit timesheet spreadsheet</h2>' +
      '<p class="notice">' + safe(notice) + '</p>' +
      '<p class="small-text">Changes update the existing protected submission and are queued for the next Accounts filing run.</p>' +
      '<form id="timesheet-editor-form"><div class="form-grid compact-grid">' +
      '<label>Week starting<input name="weekStart" type="date" value="' + safe(weekStart) + '" required></label>' +
      '<label>Week ending<input name="weekEnd" type="date" value="' + safe(weekEnd) + '" required></label></div>' +
      '<div class="table-scroll"><table class="timesheet-editor-grid"><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Break (min)</th><th>Absence</th><th>Notes</th></tr></thead><tbody>' +
      rows.map(function (row, index) { return '<tr><td><input name="date-' + index + '" type="date" value="' + safe(row.date || "") + '"></td><td><input name="start-' + index + '" type="time" value="' + safe(row.start || "") + '"></td><td><input name="finish-' + index + '" type="time" value="' + safe(row.finish || "") + '"></td><td><input name="break-' + index + '" type="number" min="0" max="1440" step="5" value="' + safe(row.lunchMinutes || 0) + '"></td><td><select name="absence-' + index + '"><option value="NA"' + (row.absenceStatus === "NA" || !row.absenceStatus ? " selected" : "") + '>None</option><option value="Holiday"' + (row.absenceStatus === "Holiday" ? " selected" : "") + '>Holiday</option><option value="Sick"' + (row.absenceStatus === "Sick" ? " selected" : "") + '>Sick</option><option value="Time Off"' + (row.absenceStatus === "Time Off" ? " selected" : "") + '>Time Off</option></select></td><td><input name="note-' + index + '" value="' + safe(row.description || row.note || "") + '"></td></tr>'; }).join("") +
      '</tbody></table></div><div id="timesheet-editor-message" class="banner hidden" role="status"></div><div class="action-bar"><button type="submit" id="timesheet-editor-submit">Save and queue correction</button></div></form></section>';
    document.getElementById("timesheet-editor-form").addEventListener("submit", function (event) { submitEditor(event, record, payload, rows); });
  }

  function fileToBase64(file) {
    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer); var binary = "";
      for (var offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
      return btoa(binary);
    });
  }

  function csvEscape(value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }

  async function submitEditor(event, record, originalPayload, originalRows) {
    event.preventDefault();
    var form = event.currentTarget; var message = document.getElementById("timesheet-editor-message"); var button = document.getElementById("timesheet-editor-submit");
    var weekStart = form.elements.weekStart.value; var weekEnd = form.elements.weekEnd.value;
    if (!weekStart || weekStart.slice(0, 7) !== currentMonth()) { message.textContent = "Only timesheets made within the current month may be edited."; message.classList.remove("hidden"); return; }
    var rows = originalRows.map(function (row, index) { return Object.assign({}, row, { date: form.elements["date-" + index].value, start: form.elements["start-" + index].value, finish: form.elements["finish-" + index].value, lunchMinutes: Number(form.elements["break-" + index].value || 0), lunchHad: Number(form.elements["break-" + index].value || 0) > 0, absenceStatus: form.elements["absence-" + index].value, description: form.elements["note-" + index].value }); });
    var calculation = calculateRows(rows);
    if (calculation.totals.errors.length) { message.textContent = calculation.totals.errors.join(" "); message.classList.remove("hidden"); return; }
    button.disabled = true; button.textContent = "Saving…";
    try {
      var payload = Object.assign({}, originalPayload, { weekStart: weekStart, weekEnd: weekEnd, rows: calculation.rows, totals: calculation.totals, weightedHours: calculation.weightedHours, updatedAt: new Date().toISOString() });
      await window.GMTPortalApi.updateRecord(record.source_record_id, { recordId: record.source_record_id, kind: "timesheets", action: record.action || "submission", status: "Pending delivery", startDate: weekStart, endDate: weekEnd, recordDate: weekStart, payload: payload, updatedAt: new Date().toISOString() });
      var xlsx = await window.ensureXlsxLoaded();
      var exportRows = calculation.rows.map(function (row) { return { Date: row.date, Weekday: row.dayName, Start: row.start, Finish: row.finish, "Break (min)": row.lunchMinutes, Absence: row.absenceStatus || "NA", Notes: row.description || "", "Worked minutes": row.workedActual, "Basic minutes": row.appliedBasic }; });
      var sheet = xlsx.utils.json_to_sheet(exportRows); var workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, sheet, "Timesheet");
      var xlsxBytes = xlsx.write(workbook, { bookType: "xlsx", type: "array" });
      var xlsxFile = new File([xlsxBytes], "GMT Timesheet - " + (weekStart || "current-month") + ".xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      var headers = Object.keys(exportRows[0] || { Date: "" }); var csvText = [headers].concat(exportRows.map(function (row) { return headers.map(function (header) { return row[header]; }); })).map(function (row) { return row.map(csvEscape).join(","); }).join("\r\n");
      var csvFile = new File([csvText], "GMT Timesheet - " + (weekStart || "current-month") + ".csv", { type: "text/csv" });
      var attachments = await Promise.all([{ fieldName: "attachment", file: xlsxFile }, { fieldName: "attachment_csv", file: csvFile }].map(async function (item) { return { fieldName: item.fieldName, fileName: item.file.name, contentType: item.file.type, sizeBytes: item.file.size, contentBase64: await fileToBase64(item.file) }; }));
      var queued = await window.GMTPortalApi.queueAttachments(record.source_record_id, attachments);
      message.textContent = queued && queued.skipped ? "Synthetic correction retained for testing and was not sent." : "Correction queued for the next Accounts filing run.";
      message.classList.remove("hidden"); notify(message.textContent); button.textContent = "Saved";
    } catch (error) {
      message.textContent = error && error.message ? error.message : "The correction could not be saved."; message.classList.remove("hidden"); button.disabled = false; button.textContent = "Save and queue correction";
    }
  }

  async function loadEditor() {
    if (!hasEndpoint() || !window.GMTPortalApi) { status.textContent = "Protected editing is not connected."; showEmpty("The protected spreadsheet editor is unavailable until the portal connection responds."); return; }
    status.textContent = "Loading editable spreadsheet…"; notify(status.textContent);
    try {
      var result = await window.GMTPortalApi.getRecord(editId); var record = result && result.record; var payload = result && result.payload;
      if (!record || !record.can_edit) throw new Error("Only timesheets made within the current month may be edited.");
      renderEditor(record, payload || {}); status.textContent = "Editable current-month timesheet loaded."; notify(status.textContent);
    } catch (error) { status.textContent = error && error.message ? error.message : "The timesheet could not be loaded."; notify(status.textContent); showEmpty(status.textContent); }
  }

  async function load() {
    if (requestInFlight || editId) return;
    if (!hasEndpoint()) { status.textContent = "Protected submission history is not connected."; notify(status.textContent); showEmpty("No records are displayed until the protected history service responds."); return; }
    requestInFlight = true; status.textContent = "Loading your records…"; notify(status.textContent);
    try {
      var body = await window.GMTPortalApi.history("all"); records = readRecords(body); if (!records) throw new Error("History response was not valid");
      notifyMeta(body.meta || {}); render(); status.textContent = records.length ? "Showing authorised submissions for your signed-in GMT identity." : "No submissions were found for this account."; notify(status.textContent);
    } catch (error) { status.textContent = error && error.message ? error.message : "Your submissions could not be loaded."; notify(status.textContent); showEmpty("No records are displayed until the protected history service responds."); }
    finally { requestInFlight = false; }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "gmt:history-filter") { filter = String(event.data.filter || "all"); render(); }
    if (event.data.type === "gmt:history-refresh") load();
  });

  window.parent && window.parent !== window && window.parent.postMessage({ type: "gmt:history-ready" }, window.location.origin);
  document.addEventListener("DOMContentLoaded", editId ? loadEditor : load);
}());
