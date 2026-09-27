(function () {
  "use strict";

  var root = document.querySelector("[data-portal-calendar]");
  if (!root) return;
  var status = document.getElementById("portal-calendar-status");
  var title = document.querySelector("[data-portal-calendar-title]");
  var monthPicker = document.querySelector("[data-portal-calendar-picker]");
  var monthInput = document.querySelector("[data-portal-calendar-input]");
  var previous = document.querySelector("[data-portal-calendar-prev]");
  var next = document.querySelector("[data-portal-calendar-next]");
  var viewDate = new Date();
  var events = [];
  var helper = window.GMTCalendarData || {};

  function safe(value) { return typeof helper.safe === "function" ? helper.safe(value) : String(value == null ? "" : value); }
  function dateKey(value) { return typeof helper.key === "function" ? helper.key(value) : String(value || "").slice(0, 10); }
  function eventDate(event) { return dateKey(event && (event.date || event.startDate || event.event_date || event.record_date)); }
  function eventType(event) { return String(event && event.type || "general").toLowerCase().replace(/[^a-z]+/g, "-"); }
  function eventRecordId(event) { return String(event && (event.recordId || event.record_id || event.source_record_id || event.id) || ""); }
  function eventKind(event) { return String(event && (event.type || event.kind || "general") || ""); }
  function eventCanEdit(event) {
    return !!(event && (event.can_edit === true || event.canEdit === true || event.record && (event.record.can_edit === true || event.record.canEdit === true)));
  }
  function eventCanDelete(event) {
    return !!(event && (event.can_delete === true || event.canDelete === true || event.record && (event.record.can_delete === true || event.record.canDelete === true)));
  }
  function currentMonthKey() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === "year"; });
    var month = parts.find(function (part) { return part.type === "month"; });
    return (year && year.value ? year.value : "") + "-" + (month && month.value ? month.value : "");
  }
  function isCurrentPayMonth(key) {
    // Calendar dates are entry points, not an editability gate. Users may
    // create a timesheet for any date; the form routes it to the correct
    // payroll workbook after the date is chosen.
    return !!String(key || '').match(/^\d{4}-\d{2}-\d{2}$/);
  }

  function render() {
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(viewDate);
    if (title) title.textContent = monthLabel;
    if (monthPicker) monthPicker.setAttribute("aria-label", "Choose calendar month: " + monthLabel);
    if (monthInput) monthInput.value = year + "-" + String(month + 1).padStart(2, "0");
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var days = new Date(year, month + 1, 0).getDate();
    var byDay = {};
    events.forEach(function (event) { var key = eventDate(event); if (!byDay[key]) byDay[key] = []; byDay[key].push(event); });
    var today = dateKey(new Date().toISOString());
    var html = '<div class="portal-calendar-grid">';
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (day) { html += '<span class="portal-calendar-weekday">' + day + "</span>"; });
    for (var blank = 0; blank < offset; blank += 1) html += '<span class="portal-calendar-day is-empty" aria-hidden="true"></span>';
    for (var day = 1; day <= days; day += 1) {
      var key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayEvents = byDay[key] || [];
      var labels = dayEvents.slice(0, 4).map(function (event) {
        var label = (event.title || event.type || "Event") + (event.detail ? " · " + event.detail : "");
        var content = "<strong>" + safe(event.title || event.type || "Event") + "</strong>" + (event.detail ? "<small>" + safe(event.detail) + "</small>" : "");
        return '<button type="button" class="calendar-event calendar-event-' + safe(eventType(event)) + '" data-calendar-record-id="' + safe(eventRecordId(event)) + '" data-calendar-record-kind="' + safe(eventKind(event)) + '" data-calendar-can-edit="' + String(eventCanEdit(event)) + '" data-calendar-can-delete="' + String(eventCanDelete(event)) + '" data-calendar-preview-title="' + safe(event.title || event.type || "Event") + '" data-calendar-preview="' + safe(event.detail || label) + '" data-calendar-preview-status="' + safe(event.status || "") + '" data-calendar-date="' + safe(key) + '" aria-label="' + safe(label) + '" title="' + safe(label) + '">' + content + "</button>";
      }).join("");
      if (dayEvents.length > 4) labels += '<span class="calendar-more">+' + (dayEvents.length - 4) + " more</span>";
      var dateMarkup = isCurrentPayMonth(key)
        ? '<button type="button" class="portal-calendar-day-date" data-calendar-day="' + key + '" aria-label="Actions for ' + key + '">' + day + '</button>'
        : '<time datetime="' + key + '">' + day + '</time>';
      html += '<span class="portal-calendar-day' + (new Date(key + 'T12:00:00Z').getUTCDay() % 6 === 0 ? ' is-weekend' : '') + (key === today ? " is-today" : "") + '">' + dateMarkup + (labels || '<span class="portal-calendar-no-entry">—</span>') + "</span>";
    }
    root.innerHTML = html + "</div>";
  }

  async function load() {
    var local = typeof helper.localEvents === "function" ? helper.localEvents() : [];
    try {
      var response = await fetch("../data/calendar/events.json?v=" + Date.now(), { cache: "no-store" });
      if (response.ok) {
        var body = await response.json();
        local = Array.isArray(body) ? body : (Array.isArray(body.events) ? body.events : []);
      }
    } catch (_) {}
    var protectedRecords = [];
    var historyMeta = {};
    if (window.GMTPortalApi && typeof window.GMTPortalApi.enabled === "function" && window.GMTPortalApi.enabled()) {
      try {
        // The dashboard requests all authorised dated records so its shared
        // calendar matches Submitted documents. The narrower route remains
        // available as `GMTPortalApi.history("calendar")` when only requests
        // are needed.
        var history = await window.GMTPortalApi.history("all");
        protectedRecords = history && Array.isArray(history.records) ? history.records : [];
        historyMeta = history && history.meta && typeof history.meta === "object" ? history.meta : {};
      } catch (_) {}
    }
    var employees = historyMeta.completion && historyMeta.completion.employees || [];
    var derived = typeof helper.recordsToEvents === "function" ? helper.recordsToEvents(protectedRecords, { employees: employees }) : [];
    events = typeof helper.mergeEvents === "function"
      ? helper.mergeEvents(local.concat(derived), { employees: employees })
      : local.concat(derived);
    if (status) status.textContent = events.length ? "Shared calendar: " + events.length + " entr" + (events.length === 1 ? "y" : "ies") + "." : "Shared calendar connected. No events or dated submissions have been filed yet.";
    render();
  }

  if (previous) previous.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); render(); });
  if (next) next.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); render(); });
  if (monthPicker && monthInput) monthPicker.addEventListener("click", function () {
    try { monthInput.focus({ preventScroll: true }); } catch (_) { monthInput.focus(); }
    if (typeof monthInput.showPicker === "function") { try { monthInput.showPicker(); return; } catch (_) {} }
    monthInput.click();
  });
  if (monthInput) monthInput.addEventListener("change", function () {
    var match = String(monthInput.value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return;
    viewDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    render();
  });
  render();
  load();
}());
