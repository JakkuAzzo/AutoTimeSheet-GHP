(function () {
  "use strict";

  // Calendar cells are useful navigation points as well as status displays.
  // Keep the action surface delegated from document so it also works for
  // calendars rendered after a protected history request completes.
  var DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var dialog = null;
  var dialogHeading = null;
  var dialogDate = null;
  var dialogNote = null;
  var timesheetLink = null;
  var editEntryLink = null;
  var deleteEntryButton = null;
  var deleteEntryStatus = null;
  var previewPanel = null;
  var eventsLink = null;
  var taskLink = null;
  var timeOffLink = null;
  var activeRecord = null;

  function validDay(value) {
    var day = String(value || "");
    if (!DAY_PATTERN.test(day)) return false;
    var parts = day.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function currentPayMonth() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === "year"; });
    var month = parts.find(function (part) { return part.type === "month"; });
    var day = parts.find(function (part) { return part.type === "day"; });
    var helper = window.GMTPayPeriods;
    return helper && typeof helper.payMonthKeyForDate === "function" && year && month && day
      ? helper.payMonthKeyForDate(year.value + "-" + month.value + "-" + day.value)
      : (year && year.value ? year.value : "") + "-" + (month && month.value ? month.value : "");
  }

  // Use the central GMT payroll-period calendar so 24 August–18 September
  // stays together in Pay Month 2026-09 and future dates route consistently.
  function payMonthKeyForDate(value) {
    var helper = window.GMTPayPeriods;
    return helper && typeof helper.payMonthKeyForDate === "function"
      ? helper.payMonthKeyForDate(value)
      : (validDay(value) ? String(value).slice(0, 7) : "");
  }

  function href(path, params, hash) {
    var query = new URLSearchParams(params || {}).toString();
    var pathname = String(window.location && window.location.pathname || "");
    var base = /(^|\.)gmt-services\.co\.uk$/i.test(window.location && window.location.hostname || "")
      || /(^|\.)gmt-timesheets\.pages\.dev$/i.test(window.location && window.location.hostname || "")
      ? ""
      : (pathname.indexOf("/AutoTimeSheet-GHP/") === 0 ? "/AutoTimeSheet-GHP" : "");
    return base + path + (query ? "?" + query : "") + (hash || "");
  }

  function recordKindLabel(kind) {
    var value = String(kind || "").toLowerCase();
    if (value.indexOf("timesheet") !== -1 || value === "submission") return "timesheet";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar request";
    if (value.indexOf("task") !== -1) return "task";
    if (value.indexOf("job") !== -1) return "job card";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimate";
    if (value.indexOf("invoice") !== -1) return "invoice";
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1) return "enquiry";
    return "entry";
  }

  function editHrefFor(kind, recordId, day) {
    var label = recordKindLabel(kind);
    if (!recordId) return "";
    if (label === "timesheet") return href("/timesheets/create.html", { edit: recordId, day: day }, "#day-" + day);
    if (label === "calendar request") return href("/calendar/", { edit: recordId, date: day }, "#calendar-form");
    if (label === "task") return href("/tasks/", { edit: recordId, date: day }, "#task-form");
    if (label === "job card") return href("/jobs/", { record: recordId });
    if (label === "estimate") return href("/tools/estimates.html", { record: recordId });
    if (label === "invoice") return href("/tools/invoices.html", { record: recordId });
    return href("/portal/submissions", { record: recordId });
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "calendar-day-actions-dialog";
    dialog.setAttribute("aria-labelledby", "calendar-day-actions-title");
    dialog.innerHTML =
      '<div class="calendar-day-actions-header"><div><p class="portal-card-kicker">Calendar day</p><h2 id="calendar-day-actions-title">Day actions</h2><p id="calendar-day-actions-date" class="small-text"></p></div><button type="button" class="secondary calendar-day-actions-close" data-calendar-actions-close aria-label="Close day actions">Close</button></div>' +
      '<p id="calendar-day-actions-note" class="calendar-day-actions-note"></p>' +
      '<div class="calendar-day-actions-layout"><div class="calendar-day-actions-left"><p class="portal-card-kicker">Actions</p><div class="calendar-day-actions-grid">' +
        '<a class="calendar-day-action" data-calendar-action-timesheet><strong>Create timesheet</strong><small>Open the daily entry for this pay month.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-edit-entry hidden><strong>Edit entry</strong><small>Open the permitted editor for this protected record.</small></a>' +
        '<button type="button" class="calendar-day-action calendar-day-action-danger" data-calendar-action-delete hidden><strong>Delete entry</strong><small>Remove this entry from active history and the calendar.</small></button>' +
        '<a class="calendar-day-action" data-calendar-action-events><strong>View this day’s events</strong><small>Review submissions and shared calendar records.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-task><strong>Create task</strong><small>Start a task with this date as its due date.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-time-off><strong>Request time off</strong><small>Open a dated absence or leave request.</small></a>' +
      '</div><p class="calendar-day-actions-status" data-calendar-action-status role="status" hidden></p></div><article class="calendar-day-actions-preview" data-calendar-action-preview aria-live="polite"><p class="portal-card-kicker">Entry preview</p><h3>No entry selected</h3><p class="small-text">Tap or click a dated entry to preview its details here.</p></article></div>';
    document.body.appendChild(dialog);
    dialogHeading = dialog.querySelector("#calendar-day-actions-title");
    dialogDate = dialog.querySelector("#calendar-day-actions-date");
    dialogNote = dialog.querySelector("#calendar-day-actions-note");
    timesheetLink = dialog.querySelector("[data-calendar-action-timesheet]");
    editEntryLink = dialog.querySelector("[data-calendar-action-edit-entry]");
    deleteEntryButton = dialog.querySelector("[data-calendar-action-delete]");
    deleteEntryStatus = dialog.querySelector("[data-calendar-action-status]");
    previewPanel = dialog.querySelector("[data-calendar-action-preview]");
    eventsLink = dialog.querySelector("[data-calendar-action-events]");
    taskLink = dialog.querySelector("[data-calendar-action-task]");
    timeOffLink = dialog.querySelector("[data-calendar-action-time-off]");
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog || event.target.closest("[data-calendar-actions-close]")) dialog.close();
    });
    if (deleteEntryButton) deleteEntryButton.addEventListener("click", async function () {
      if (!activeRecord || !activeRecord.recordId || !activeRecord.canDelete) return;
      var kindLabel = recordKindLabel(activeRecord.recordKind);
      if (!window.GMTPortalApi || typeof window.GMTPortalApi.deleteRecord !== "function") {
        if (deleteEntryStatus) { deleteEntryStatus.hidden = false; deleteEntryStatus.textContent = "Protected deletion is unavailable in this session."; }
        return;
      }
      var deleteTarget = activeRecord.day ? " for " + activeRecord.day : "";
      if (typeof window.confirm === "function" && !window.confirm("Delete this " + kindLabel + deleteTarget + " from active history? Only the selected day will be removed.")) return;
      deleteEntryButton.disabled = true;
      if (deleteEntryStatus) { deleteEntryStatus.hidden = false; deleteEntryStatus.textContent = "Deleting protected entry…"; }
      try {
        var deleted = await window.GMTPortalApi.deleteRecord(activeRecord.recordId, activeRecord.day);
        if (deleteEntryStatus) deleteEntryStatus.textContent = deleted && deleted.deleted_day ? "Selected day deleted. Refreshing history…" : "Entry deleted. Refreshing history…";
        document.dispatchEvent(new CustomEvent("gmt:history-record-deleted", { detail: { recordId: activeRecord.recordId, day: activeRecord.day } }));
        setTimeout(function () { if (dialog && dialog.open) dialog.close(); }, 180);
      } catch (error) {
        deleteEntryButton.disabled = false;
        if (deleteEntryStatus) deleteEntryStatus.textContent = error && error.message ? error.message : "The entry could not be deleted.";
      }
    });
    dialog.addEventListener("cancel", function () { dialog.close(); });
    return dialog;
  }

  function open(day, options) {
    if (!validDay(day)) return;
    var target = ensureDialog();
    var recordId = options && String(options.recordId || "") || "";
    var recordKind = options && String(options.recordKind || options.kind || "") || "";
    var canEdit = !!(options && options.canEdit === true && recordId);
    var canDelete = !!(options && options.canDelete === true && recordId);
    activeRecord = { recordId: recordId, recordKind: recordKind, canDelete: canDelete, day: day };
    var formatted = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" }).format(new Date(day + "T12:00:00Z"));
    dialogHeading.textContent = "Actions for " + formatted;
    dialogDate.textContent = day;
    var helper = window.GMTPayPeriods;
    var period = helper && typeof helper.periodForDate === "function" ? helper.periodForDate(day) : null;
    dialogNote.textContent = period
      ? "Choose an action for this date. New timesheet entries are always accepted and filed to the " + period.key + " pay-month workbook (" + period.start + " to " + period.end + ")."
      : "Choose an action for this date. New timesheet entries are accepted and routed to the matching pay-month workbook automatically.";
    if (previewPanel) {
      var escapePreview = function (value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
          return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
        });
      };
      var previewTitle = String(options && options.previewTitle || (recordId ? recordKindLabel(recordKind) : "No entry selected"));
      var previewDetail = String(options && options.previewDetail || (recordId ? "Protected record " + recordId : "No submitted entry is attached to this date."));
      var previewStatus = String(options && options.previewStatus || "");
      previewPanel.innerHTML = '<p class="portal-card-kicker">Entry preview</p><h3>' + escapePreview(previewTitle) + '</h3><p class="small-text"><strong>Date:</strong> ' + day + '</p>' + (recordKind ? '<p class="small-text"><strong>Type:</strong> ' + escapePreview(recordKindLabel(recordKind)) + '</p>' : '') + (previewStatus ? '<p class="small-text"><strong>Status:</strong> ' + escapePreview(previewStatus) + '</p>' : '') + '<p class="calendar-day-actions-preview-detail">' + escapePreview(previewDetail) + '</p>';
    }
    timesheetLink.href = href("/timesheets/create.html", { day: day }, "#day-" + day);
    if (editEntryLink) {
      editEntryLink.hidden = !canEdit;
      editEntryLink.textContent = "";
      if (canEdit) {
        var label = recordKindLabel(recordKind);
        editEntryLink.innerHTML = "<strong>Edit " + label + "</strong><small>Open the permitted editor for this protected record.</small>";
        editEntryLink.href = editHrefFor(recordKind, recordId, day);
      }
    }
    if (deleteEntryButton) {
      deleteEntryButton.hidden = !canDelete;
      deleteEntryButton.disabled = false;
    }
    if (deleteEntryStatus) {
      deleteEntryStatus.hidden = true;
      deleteEntryStatus.textContent = "";
    }
    eventsLink.href = href("/portal/submissions", { day: day });
    taskLink.href = href("/tasks/", { date: day });
    timeOffLink.href = href("/calendar/", { request: "time-off", date: day }, "#calendar-form");
    timesheetLink.classList.remove("is-disabled");
    timesheetLink.removeAttribute("aria-disabled");
    timesheetLink.removeAttribute("tabindex");
    if (typeof target.showModal === "function") target.showModal();
    else target.setAttribute("open", "");
  }

  document.addEventListener("click", function (event) {
    var entry = event.target.closest && event.target.closest("[data-calendar-record-id][data-calendar-date]");
    if (entry) {
      event.preventDefault();
      open(entry.getAttribute("data-calendar-date"), {
        recordId: entry.getAttribute("data-calendar-record-id") || "",
        recordKind: entry.getAttribute("data-calendar-record-kind") || entry.getAttribute("data-calendar-kind") || "",
        canEdit: entry.getAttribute("data-calendar-can-edit") === "true",
        canDelete: entry.getAttribute("data-calendar-can-delete") === "true",
        previewTitle: entry.getAttribute("data-calendar-preview-title") || entry.getAttribute("aria-label") || "Entry",
        previewDetail: entry.getAttribute("data-calendar-preview") || entry.getAttribute("title") || "Protected calendar entry",
        previewStatus: entry.getAttribute("data-calendar-preview-status") || ""
      });
      return;
    }
    var trigger = event.target.closest && event.target.closest("[data-calendar-day]");
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute("data-calendar-day"), {
      recordId: trigger.getAttribute("data-calendar-record-id") || "",
      recordKind: trigger.getAttribute("data-calendar-record-kind") || "",
      canEdit: trigger.getAttribute("data-calendar-can-edit") === "true",
      canDelete: trigger.getAttribute("data-calendar-can-delete") === "true"
    });
  });

  window.GMTCalendarActions = { open: open, currentPayMonth: currentPayMonth, payMonthKeyForDate: payMonthKeyForDate };
}());
