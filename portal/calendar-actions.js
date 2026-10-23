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
  var payMonthStartButton = null;
  var payMonthStartPanel = null;
  var payMonthStartForm = null;
  var payMonthStartLabel = null;
  var payMonthStartStatus = null;
  var selectedCalendarDay = '';
  var activeRecord = null;
  var requestDialog = null;

  function validDay(value) {
    var day = String(value || "");
    if (!DAY_PATTERN.test(day)) return false;
    var parts = day.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function portalProfile() {
    try {
      var raw = window.localStorage && window.localStorage.getItem("gmt.portal.profile.v1");
      var profile = raw ? JSON.parse(raw) : {};
      return profile && typeof profile === "object" ? profile : {};
    } catch (_) { return {}; }
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

  // Use the central GMT payroll-period calendar so the cycle from 24 August
  // through 20 September stays in Pay Month 2026-09; payroll is processed on
  // Friday 18 September. Future dates route from the same cycle policy.
  function payMonthKeyForDate(value) {
    var helper = window.GMTPayPeriods;
    return helper && typeof helper.payMonthKeyForDate === "function"
      ? helper.payMonthKeyForDate(value)
      : (validDay(value) ? String(value).slice(0, 7) : "");
  }

  function monthLabel(value) {
    if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return String(value || 'pay month');
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(value + '-01T12:00:00Z'));
  }

  function fullDateLabel(value) {
    if (!validDay(value)) return String(value || '');
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
  }

  function refreshPayMonthStartPrompt() {
    if (!payMonthStartForm || !payMonthStartLabel) return;
    var helper = window.GMTPayPeriods;
    var select = payMonthStartForm.elements.monthKey;
    var key = String(select && select.value || '');
    var choice = select && select.selectedOptions && select.selectedOptions[0];
    var prefix = choice && choice.getAttribute('data-choice-label') || 'the selected pay month';
    payMonthStartLabel.textContent = 'Confirm: set ' + fullDateLabel(selectedCalendarDay) + ' as the start of ' + prefix + ' (' + monthLabel(key) + ').';
    var period = helper && helper.periodForMonth && helper.periodForMonth(key);
    var current = period && period.start || '';
    var old = payMonthStartForm.querySelector('[data-pay-month-start-current]');
    if (old) old.textContent = current ? 'Current start: ' + current + '.' : '';
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

  function isDailyTimesheet(kind) {
    return /timesheet|submission|clock|break|absence/i.test(String(kind || ""));
  }

  function editHrefFor(kind, recordId, day) {
    var label = recordKindLabel(kind);
    if (!recordId) return "";
    if (label === "timesheet") return href("/timesheets/create.html", { edit: recordId, day: day }, "#day-" + day);
    if (label === "calendar request") return href("/portal/submissions", { record: recordId, day: day, tab: "calendar" });
    if (label === "task") return href("/tasks/", { edit: recordId, date: day }, "#task-form");
    if (label === "job card") return href("/jobs/", { record: recordId });
    if (label === "estimate") return href("/tools/estimates.html", { record: recordId });
    if (label === "invoice") return href("/tools/invoices.html", { record: recordId });
    return href("/portal/submissions", { record: recordId });
  }

  function calendarEntryFromElement(element, day) {
    var recordId = element.getAttribute("data-calendar-record-id") || "";
    return {
      recordId: recordId,
      recordKind: element.getAttribute("data-calendar-record-kind") || "",
      canEdit: element.getAttribute("data-calendar-can-edit") === "true",
      canDelete: element.getAttribute("data-calendar-can-delete") === "true",
      title: element.getAttribute("data-calendar-preview-title") || element.getAttribute("aria-label") || element.textContent.trim() || "Calendar entry",
      detail: element.getAttribute("data-calendar-preview") || element.getAttribute("title") || element.textContent.trim() || "",
      status: element.getAttribute("data-calendar-preview-status") || "",
      day: day
    };
  }

  function dayEntriesFor(trigger, day) {
    var cell = trigger && trigger.closest && trigger.closest(".portal-calendar-day, .calendar-day");
    if (!cell) return [];
    return Array.prototype.map.call(cell.querySelectorAll(".calendar-event"), function (element) { return calendarEntryFromElement(element, day); });
  }

  function previewEntryFor(element, day) {
    return calendarEntryFromElement(element, day);
  }

  function selectEntry(day, entry) {
    entry = entry || {};
    var recordId = String(entry.recordId || "");
    var recordKind = String(entry.recordKind || "");
    activeRecord = { recordId: recordId, recordKind: recordKind, canDelete: entry.canDelete === true && !!recordId, day: day };
    var escapePreview = function (value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
      });
    };
    if (previewPanel) {
      var previewTitle = String(entry.title || (recordId ? recordKindLabel(recordKind) : "Calendar entry"));
      var previewDetail = String(entry.detail || (recordId ? "Protected record " + recordId : "Shared calendar entry"));
      var previewStatus = String(entry.status || "");
      previewPanel.innerHTML = '<p class="portal-card-kicker">Entry preview</p><h3>' + escapePreview(previewTitle) + '</h3><p class="small-text"><strong>Date:</strong> ' + day + '</p>' + (recordKind ? '<p class="small-text"><strong>Type:</strong> ' + escapePreview(recordKindLabel(recordKind)) + '</p>' : '') + (previewStatus ? '<p class="small-text"><strong>Status:</strong> ' + escapePreview(previewStatus) + '</p>' : '') + '<p class="calendar-day-actions-preview-detail">' + escapePreview(previewDetail) + '</p>';
    }
    var canEdit = entry.canEdit === true && !!recordId;
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
      deleteEntryButton.hidden = !(entry.canDelete === true && !!recordId) || (isDailyTimesheet(recordKind) && !canEdit);
      deleteEntryButton.disabled = false;
      deleteEntryButton.innerHTML = isDailyTimesheet(recordKind)
        ? "<strong>Remove day</strong><small>Open this day in the pay-month sheet. Review and save the removal there.</small>"
        : "<strong>Delete entry</strong><small>Remove this entry from active history and the calendar.</small>";
    }
  }

  function showDayEntries(day, entries) {
    var escapePreview = function (value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
      });
    };
    if (!previewPanel) return;
    if (!entries.length) {
      previewPanel.innerHTML = '<p class="portal-card-kicker">Day preview</p><h3>No entries yet</h3><p class="small-text">There are no shared or submitted entries for this date.</p>';
      return;
    }
    previewPanel.innerHTML = '<p class="portal-card-kicker">All entries for this day</p><h3>' + entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + '</h3><div class="calendar-day-entry-list">' + entries.map(function (entry, index) {
      var detail = [recordKindLabel(entry.recordKind), entry.status, entry.detail].filter(Boolean).join(' · ');
      return '<button type="button" class="calendar-day-entry-choice" data-day-entry-index="' + index + '"><strong>' + escapePreview(entry.title || 'Calendar entry') + '</strong><small>' + escapePreview(detail) + '</small></button>';
    }).join('') + '</div>';
    previewPanel.querySelectorAll('[data-day-entry-index]').forEach(function (button) {
      button.addEventListener('click', function () {
        previewPanel.querySelectorAll('[data-day-entry-index]').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
        selectEntry(day, entries[Number(button.getAttribute('data-day-entry-index'))]);
      });
    });
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
        '<button type="button" class="calendar-day-action" data-calendar-action-paymonth hidden><strong>Set pay-month start day</strong><small>Choose whether this date starts the current or next pay month.</small></button>' +
        '<a class="calendar-day-action" data-calendar-action-events><strong>View this day’s events</strong><small>Review dated timesheets and calendar requests.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-task><strong>Create task</strong><small>Start a task with this date as its due date.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-time-off><strong>Request time off</strong><small>Open a dated absence or leave request.</small></a>' +
      '</div><section class="calendar-pay-month-start-panel" data-pay-month-start-panel hidden><form data-pay-month-start-form><label for="calendar-pay-month-choice">Apply this date to</label><select id="calendar-pay-month-choice" name="monthKey" required></select><p class="small-text" data-pay-month-start-current></p><p class="small-text" data-pay-month-start-confirm></p><div class="pay-month-edit-actions"><button type="submit">Confirm and save start day</button><button type="button" class="secondary" data-pay-month-start-cancel>Cancel</button></div><p class="calendar-day-actions-status" data-pay-month-start-status role="status"></p></form></section>' +
      '<p class="calendar-day-actions-status" data-calendar-action-status role="status" hidden></p></div><article class="calendar-day-actions-preview" data-calendar-action-preview aria-live="polite"><p class="portal-card-kicker">Entry preview</p><h3>No entry selected</h3><p class="small-text">Tap or click a dated entry to preview its details here.</p></article></div>';
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
    payMonthStartButton = dialog.querySelector("[data-calendar-action-paymonth]");
    payMonthStartPanel = dialog.querySelector("[data-pay-month-start-panel]");
    payMonthStartForm = dialog.querySelector("[data-pay-month-start-form]");
    payMonthStartLabel = dialog.querySelector("[data-pay-month-start-confirm]");
    payMonthStartStatus = dialog.querySelector("[data-pay-month-start-status]");
    payMonthStartButton.addEventListener("click", function () {
      if (!payMonthStartPanel) return;
      payMonthStartPanel.hidden = false;
      payMonthStartStatus.textContent = "";
      refreshPayMonthStartPrompt();
      var select = payMonthStartForm.elements.monthKey;
      if (select && typeof select.focus === "function") select.focus();
    });
    payMonthStartForm.elements.monthKey.addEventListener("change", refreshPayMonthStartPrompt);
    payMonthStartForm.querySelector("[data-pay-month-start-cancel]").addEventListener("click", function () {
      payMonthStartPanel.hidden = true;
      payMonthStartStatus.textContent = "";
    });
    payMonthStartForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var helper = window.GMTPayPeriods;
      var portalApi = window.GMTPortalApi;
      var monthKey = String(payMonthStartForm.elements.monthKey.value || "");
      var period = helper && helper.periodForMonth ? helper.periodForMonth(monthKey) : null;
      if (!helper || !helper.canManagePayMonthStarts || !period || !portalApi || typeof portalApi.setPayMonthStart !== "function") {
        payMonthStartStatus.textContent = "Pay-month start changes are unavailable for this signed-in account.";
        return;
      }
      var saveButton = payMonthStartForm.querySelector('button[type="submit"]');
      saveButton.disabled = true;
      payMonthStartStatus.textContent = "Saving the " + monthLabel(monthKey) + " boundary…";
      try {
        var response = await portalApi.setPayMonthStart({ monthKey: monthKey, startDate: selectedCalendarDay, expectedOldStart: period.start });
        helper.replaceStartDates(response.startDates || {});
        helper.currentMonthKey = String(response.currentMonthKey || "");
        helper.nextMonthKey = String(response.nextMonthKey || "");
        helper.settingsLoaded = true;
        document.dispatchEvent(new CustomEvent("gmt:pay-month-start-updated", { detail: response }));
        payMonthStartStatus.textContent = response.changed === false
          ? monthLabel(monthKey) + " already starts on " + selectedCalendarDay + "."
          : monthLabel(monthKey) + " now starts on " + selectedCalendarDay + ". Refreshing sheets…";
        if (response.changed !== false) window.setTimeout(function () { window.location.reload(); }, 1200);
      } catch (error) {
        payMonthStartStatus.textContent = error && error.message ? error.message : "The pay-month start could not be saved.";
      } finally {
        saveButton.disabled = false;
      }
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog || event.target.closest("[data-calendar-actions-close]")) dialog.close();
    });
    if (deleteEntryButton) deleteEntryButton.addEventListener("click", async function () {
      if (!activeRecord || !activeRecord.recordId || !activeRecord.canDelete) return;
      if (isDailyTimesheet(activeRecord.recordKind)) {
        window.location.assign(href("/portal/submissions", { record: activeRecord.recordId, day: activeRecord.day }));
        return;
      }
      var kindLabel = recordKindLabel(activeRecord.recordKind);
      if (!window.GMTPortalApi || typeof window.GMTPortalApi.deleteRecord !== "function") {
        if (deleteEntryStatus) { deleteEntryStatus.hidden = false; deleteEntryStatus.textContent = "Protected deletion is unavailable in this session."; }
        return;
      }
      var deleteTarget = activeRecord.day ? " for " + activeRecord.day : "";
      if (typeof window.confirm === "function" && !window.confirm("Delete this " + kindLabel + deleteTarget + " from active history?")) return;
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
    if (editEntryLink) editEntryLink.addEventListener("click", function (event) {
      if (!activeRecord || recordKindLabel(activeRecord.recordKind) !== "calendar request") return;
      event.preventDefault();
      openCalendarRequest(activeRecord.day, activeRecord.recordId);
    });
    if (timeOffLink) timeOffLink.addEventListener("click", function (event) {
      event.preventDefault();
      openCalendarRequest(activeRecord && activeRecord.day || "");
    });
    return dialog;
  }

  function ensureRequestDialog() {
    if (requestDialog) return requestDialog;
    requestDialog = document.createElement("dialog");
    requestDialog.className = "calendar-day-actions-dialog calendar-request-dialog";
    requestDialog.setAttribute("aria-labelledby", "calendar-request-title");
    requestDialog.innerHTML = '<form class="calendar-request-form"><div class="calendar-day-actions-header"><div><p class="portal-card-kicker">Calendar request</p><h2 id="calendar-request-title">Request time off</h2></div><button type="button" class="secondary" data-calendar-request-close>Close</button></div><label>Title<input name="title" required maxlength="160" value="Time off request"></label><label>Date<input name="date" type="date" required></label><label>Type<select name="type"><option>Holiday</option><option>Sick Day</option><option>General</option><option>Training</option></select></label><label>Notes<textarea name="notes" rows="4"></textarea></label><div class="pay-month-edit-actions"><button type="submit">Submit request</button><span class="small-text" data-calendar-request-status role="status"></span></div></form>';
    document.body.appendChild(requestDialog);
    requestDialog.querySelector("[data-calendar-request-close]").addEventListener("click", function () { requestDialog.close(); });
    requestDialog.querySelector("form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var status = form.querySelector("[data-calendar-request-status]");
      var button = form.querySelector('button[type="submit"]');
      var values = new FormData(form);
      var date = String(values.get("date") || "");
      var title = String(values.get("title") || "").trim();
      if (!validDay(date) || !title) { status.textContent = "Enter a title and valid date."; return; }
      if (!window.GMTPortalApi || typeof window.GMTPortalApi.saveRecord !== "function" || (typeof window.GMTPortalApi.enabled === "function" && !window.GMTPortalApi.enabled())) { status.textContent = "Protected requests are unavailable in this session."; return; }
      var profile = portalProfile();
      var requesterName = String(profile.name || "");
      var requesterUpn = String(profile.username || profile.upn || "");
      var recordId = String(form.dataset.editRecordId || form.dataset.requestRecordId || "") || "calendar-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      var updated = Boolean(form.dataset.editRecordId);
      var submittedAt = updated ? String(form.dataset.originalSubmittedAt || "") : new Date().toISOString();
      var updatedAt = updated ? new Date().toISOString() : "";
      if (updated && !submittedAt) {
        status.textContent = "Original request creation time is unavailable. Reload the calendar request before editing.";
        return;
      }
      form.dataset.requestRecordId = recordId;
      var payload = { title: title, date: date, type: String(values.get("type") || "Holiday"), notes: String(values.get("notes") || ""), owner: requesterName };
      button.disabled = true;
      status.textContent = "Saving request…";
      try {
        var saved = await window.GMTPortalApi.saveRecord({ recordId: recordId, kind: "calendar", action: updated ? "update_request" : "create_request", status: "Pending approval", recordDate: date, submittedAt: submittedAt, ...(updated ? { updatedAt: updatedAt } : {}), employeeName: requesterName, employeeEmail: requesterUpn, payload: payload });
        if (saved === null) throw new Error("Protected request service is unavailable.");
        var attempted = queueCalendarRequestEmail(recordId, payload, updated, requesterName, requesterUpn, submittedAt, updatedAt);
        status.textContent = attempted ? "Request saved. Email submission attempted; delivery is not confirmed." : "Request saved for Accounts review. No email route is configured.";
        document.dispatchEvent(new CustomEvent("gmt:history-record-updated", { detail: { recordId: recordId } }));
        window.setTimeout(function () { if (requestDialog && requestDialog.open) requestDialog.close(); }, 1800);
      } catch (error) {
        status.textContent = error && error.message ? error.message : "The request could not be saved.";
      } finally {
        button.disabled = false;
      }
    });
    return requestDialog;
  }

  function queueCalendarRequestEmail(recordId, payload, updated, requesterName, requesterUpn, submittedAt, updatedAt) {
    var config = window.GMT_APP_CONFIG || {};
    var endpoint = config.calendarFormSubmitEndpoint || config.fallbackFormSubmitEndpoint || config.formSubmitEndpoint;
    if (!endpoint) return false;
    var frame = document.createElement("iframe");
    frame.name = "gmt-calendar-request-" + Date.now();
    frame.hidden = true;
    var form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint;
    form.target = frame.name;
    form.hidden = true;
    function add(name, value) {
      var input = document.createElement("input");
      input.name = name;
      input.value = String(value || "");
      form.appendChild(input);
    }
    add("_subject", updated ? "GMT calendar request update" : "GMT calendar request");
    add("_template", "box");
    add("_captcha", "false");
    add("_url", window.location.href);
    add("submission_type", updated ? "Calendar Update" : "Calendar Request");
    if (config.formSubmitCc) add("_cc", config.formSubmitCc);
    var date = String(payload.date || "");
    var match = date.match(/^(\d{4})-(\d{2})-/);
    var action = updated ? "update_request" : "create_request";
    add("gmt_schema_version", "1");
    add("gmt_type", "calendar");
    add("gmt_action", action);
    add("gmt_record_id", recordId);
    add("gmt_status", "Pending approval");
    add("gmt_employee", requesterName || "");
    add("gmt_requester_upn", requesterUpn || "");
    add("gmt_year", match ? match[1] : "");
    add("gmt_month", match ? match[2] : "");
    add("gmt_calendar_name", "GMT Operational Calendar");
    add("gmt_submitted_at", submittedAt || new Date().toISOString());
    if (updatedAt) {
      add("gmt_updated_at", updatedAt);
      add("updated_at", updatedAt);
    }
    add("event_id", recordId);
    add("event_title", payload.title);
    add("event_date", date);
    add("event_type", payload.type);
    add("notes", payload.notes);
    add("requested_by", requesterName || "");
    add("requested_by_upn", requesterUpn || "");
    add("submitted_at", submittedAt || new Date().toISOString());
    document.body.appendChild(frame);
    document.body.appendChild(form);
    form.submit();
    window.setTimeout(function () { form.remove(); frame.remove(); }, 4000);
    return true;
  }

  async function openCalendarRequest(day, recordId) {
    var target = ensureRequestDialog();
    var form = target.querySelector("form");
    form.reset();
    form.dataset.editRecordId = recordId || "";
    form.dataset.requestRecordId = recordId || "";
    form.dataset.originalSubmittedAt = "";
    form.elements.date.value = validDay(day) ? day : "";
    form.querySelector("[data-calendar-request-status]").textContent = "";
    if (recordId && window.GMTPortalApi && typeof window.GMTPortalApi.getRecord === "function") {
      try {
        var result = await window.GMTPortalApi.getRecord(recordId);
        var record = result && result.record || result || {};
        var payload = result && (result.payload || record.payload) || {};
        form.dataset.originalSubmittedAt = String(record.submitted_at || record.submittedAt || payload.submittedAt || "");
        form.elements.title.value = payload.title || "Calendar request";
        form.elements.date.value = validDay(payload.date) ? payload.date : form.elements.date.value;
        form.elements.type.value = payload.type || "General";
        form.elements.notes.value = payload.notes || "";
      } catch (_) {
        form.querySelector("[data-calendar-request-status]").textContent = "Existing details could not be loaded. Review before saving.";
      }
    }
    if (dialog && dialog.open) dialog.close();
    if (typeof target.showModal === "function") target.showModal();
    else target.setAttribute("open", "");
  }

  async function open(day, options) {
    if (!validDay(day)) return;
    var helper = window.GMTPayPeriods;
    if (helper && helper.ready && typeof helper.ready.then === "function") await helper.ready;
    var target = ensureDialog();
    var selectedEntry = options && options.selectedEntry || null;
    var entries = options && Array.isArray(options.entries) ? options.entries : [];
    selectedCalendarDay = day;
    var formatted = fullDateLabel(day);
    dialogHeading.textContent = "Actions for " + formatted;
    dialogDate.textContent = day;
    var period = helper && typeof helper.periodForDate === "function" ? helper.periodForDate(day) : null;
    dialogNote.textContent = period
      ? "Choose an action for this date. New timesheet entries are always accepted and filed to the " + period.key + " pay-month workbook. Cycle start: " + period.start + ". Cycle end: " + (period.cycleEnd || period.end) + ". Payroll Friday: " + (period.payrollFriday || period.payrollEnd || period.end) + "."
      : "Choose an action for this date. New timesheet entries are accepted and routed to the matching pay-month workbook automatically.";
    timesheetLink.href = href("/timesheets/create.html", { day: day }, "#day-" + day);
    if (selectedEntry) selectEntry(day, selectedEntry);
    else {
      activeRecord = { recordId: "", recordKind: "", canDelete: false, day: day };
      if (editEntryLink) editEntryLink.hidden = true;
      if (deleteEntryButton) deleteEntryButton.hidden = true;
      showDayEntries(day, entries);
    }
    if (deleteEntryStatus) {
      deleteEntryStatus.hidden = true;
      deleteEntryStatus.textContent = "";
    }
    eventsLink.href = href("/portal/timesheets", { day: day, month: day.slice(0, 7) });
    taskLink.href = href("/tasks/", { date: day });
    timeOffLink.href = href("/portal/submissions", { request: "time-off", date: day });
    if (payMonthStartButton) payMonthStartButton.hidden = !(helper && helper.settingsLoaded && helper.canManagePayMonthStarts === true);
    if (payMonthStartPanel) payMonthStartPanel.hidden = true;
    if (payMonthStartForm && helper && helper.settingsLoaded) {
      var currentKey = String(helper.currentMonthKey || currentPayMonth());
      var nextKey = String(helper.nextMonthKey || helper.nextPayMonthKey && helper.nextPayMonthKey(currentKey) || "");
      var choice = payMonthStartForm.elements.monthKey;
      if (choice) {
        choice.innerHTML = '<option value="' + currentKey + '" data-choice-label="Current pay month">Current ' + monthLabel(currentKey) + '</option>' +
          (nextKey ? '<option value="' + nextKey + '" data-choice-label="Next pay month">Next month ' + monthLabel(nextKey) + '</option>' : '');
      }
      if (payMonthStartStatus) payMonthStartStatus.textContent = "";
      refreshPayMonthStartPrompt();
    }
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
        selectedEntry: previewEntryFor(entry, entry.getAttribute("data-calendar-date"))
      });
      return;
    }
    var trigger = event.target.closest && event.target.closest("[data-calendar-open-day], [data-calendar-day]");
    if (!trigger) return;
    event.preventDefault();
    var day = trigger.getAttribute("data-calendar-open-day") || trigger.getAttribute("data-calendar-day");
    open(day, { entries: dayEntriesFor(trigger, day) });
  });

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(window.location.search || "");
    if (params.get("request") === "time-off") openCalendarRequest(params.get("date") || "");
  });

  window.GMTCalendarActions = { open: open, currentPayMonth: currentPayMonth, payMonthKeyForDate: payMonthKeyForDate };
}());
