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
  var retry = document.querySelector("[data-portal-calendar-retry]");
  var viewDate = new Date();
  var events = [];
  var helper = window.GMTCalendarData || {};

  function safe(value) { return typeof helper.safe === "function" ? helper.safe(value) : String(value == null ? "" : value); }
  function dateKey(value) { return typeof helper.key === "function" ? helper.key(value) : String(value || "").slice(0, 10); }
  function eventDate(event) { return dateKey(event && (event.date || event.startDate || event.event_date || event.record_date)); }
  function eventType(event) { return String(event && event.type || "general").toLowerCase().replace(/[^a-z]+/g, "-"); }
  function eventCategory(event) {
    var kind = String(event && (event.type || event.kind || event.recordKind) || "").toLowerCase();
    if (/timesheet|clock|absence|holiday|sick|time.?off/.test(kind)) return "timesheets";
    if (/job.?card|jobcard/.test(kind)) return "jobcards";
    if (/estimate|quote/.test(kind)) return "estimates";
    if (/task/.test(kind)) return "tasks";
    if (/enquir|contact/.test(kind)) return "enquiries";
    if (/invoice/.test(kind)) return "invoices";
    if (/calendar|event|training|meeting/.test(kind)) return "calendar";
    return "other";
  }
  function eventVisible(event) {
    var filterGroup = document.querySelector("[data-calendar-filters]");
    if (!filterGroup) return true;
    var input = filterGroup.querySelector('[data-calendar-filter="' + eventCategory(event) + '"]');
    return !input || input.checked;
  }
  function payWeekBadge(key) {
    var periods = window.GMTPayPeriods;
    var period = periods && typeof periods.periodForDate === "function" ? periods.periodForDate(key) : null;
    return period && period.start === key ? '<span class="calendar-week-badge">(W1)</span>' : "";
  }
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
    events.filter(eventVisible).forEach(function (event) { var key = eventDate(event); if (!byDay[key]) byDay[key] = []; byDay[key].push(event); });
    var today = dateKey(new Date().toISOString());
    var html = '<div class="portal-calendar-grid">';
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (day) { html += '<span class="portal-calendar-weekday">' + day + "</span>"; });
    for (var blank = 0; blank < offset; blank += 1) html += '<span class="portal-calendar-day is-empty" aria-hidden="true"></span>';
    for (var day = 1; day <= days; day += 1) {
      var key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayEvents = byDay[key] || [];
      var labels = dayEvents.map(function (event, eventIndex) {
        var label = (event.title || event.type || "Event") + (event.detail ? " · " + event.detail : "");
        var content = "<strong>" + safe(event.title || event.type || "Event") + "</strong>" + (event.detail ? "<small>" + safe(event.detail) + "</small>" : "");
        return '<button type="button" class="calendar-event calendar-event-' + safe(eventType(event)) + (eventIndex > 3 ? ' is-overflow' : '') + '" data-calendar-record-id="' + safe(eventRecordId(event)) + '" data-calendar-record-kind="' + safe(eventKind(event)) + '" data-calendar-can-edit="' + String(eventCanEdit(event)) + '" data-calendar-can-delete="' + String(eventCanDelete(event)) + '" data-calendar-preview-title="' + safe(event.title || event.type || "Event") + '" data-calendar-preview="' + safe(event.detail || label) + '" data-calendar-preview-status="' + safe(event.status || "") + '" data-calendar-date="' + safe(key) + '" aria-label="' + safe(label) + '" title="' + safe(label) + '">' + content + "</button>";
      }).join("");
      if (dayEvents.length > 4) labels += '<button type="button" class="calendar-more" data-calendar-open-day="' + key + '" aria-label="Show all ' + dayEvents.length + ' entries for ' + key + '">+' + (dayEvents.length - 4) + " more</button>";
      var dateMarkup = isCurrentPayMonth(key)
        ? '<button type="button" class="portal-calendar-day-date" data-calendar-day="' + key + '" aria-label="Actions for ' + key + '">' + day + '</button>'
        : '<time datetime="' + key + '">' + day + '</time>';
      html += '<span class="portal-calendar-day' + (key === today ? " is-today" : "") + (payWeekBadge(key) ? " is-pay-week-start" : "") + '">' + dateMarkup + payWeekBadge(key) + (labels || '<span class="portal-calendar-no-entry">—</span>') + "</span>";
    }
    root.innerHTML = html + "</div>";
  }

  async function load() {
    events = [];
    render();
    if (status) status.textContent = "Loading shared calendar and authorised portal records…";
    if (retry) { retry.hidden = false; retry.disabled = true; retry.textContent = "Reload calendar"; }
    var published = [];
    var publishedLoaded = false;
    var publishedFailed = false;
    var authorised = [];
    var employees = [];
    var historyLoaded = false;
    var historyFailed = false;
    try {
      var response = await fetch("../data/calendar/events.json?v=" + Date.now(), { cache: "no-store" });
      if (!response || !response.ok) throw new Error("Calendar feed request failed");
      var body = await response.json();
      var feedEvents = Array.isArray(body) ? body : (body && Array.isArray(body.events) ? body.events : null);
      if (!feedEvents) throw new Error("Calendar feed has an invalid format");
      published = feedEvents;
      publishedLoaded = true;
    } catch (_) {
      publishedFailed = true;
    }

    var api = window.GMTPortalApi;
    if (api && typeof api.enabled === "function" && api.enabled() && typeof api.history === "function") {
      try {
        var history = await api.history("all");
        authorised = history && Array.isArray(history.records) ? history.records : [];
        employees = history && history.meta && history.meta.completion && Array.isArray(history.meta.completion.employees)
          ? history.meta.completion.employees : [];
        historyLoaded = true;
      } catch (_) {
        historyFailed = true;
      }
    }
    var derived = typeof helper.recordsToEvents === "function"
      ? helper.recordsToEvents(authorised, { employees: employees })
      : [];
    events = typeof helper.mergeEvents === "function"
      ? helper.mergeEvents(published.concat(derived), { employees: employees })
      : published.concat(derived);

    if (status) {
      var count = events.length;
      var countLabel = count + " authorised calendar entr" + (count === 1 ? "y" : "ies");
      if (publishedFailed && historyFailed) status.textContent = "Calendar sources unavailable. Published events and portal history could not be loaded.";
      else if (publishedFailed) status.textContent = "Published calendar unavailable. Showing " + countLabel + ".";
      else if (historyFailed) status.textContent = "Portal history unavailable. Showing " + published.length + " published event" + (published.length === 1 ? "" : "s") + ".";
      else if (!count && publishedLoaded && historyLoaded) status.textContent = "No published events or authorised dated portal records are available yet.";
      else if (publishedLoaded && historyLoaded) status.textContent = "Shared calendar: " + countLabel + ".";
      else if (publishedLoaded) status.textContent = published.length
        ? "Published shared calendar: " + published.length + " entr" + (published.length === 1 ? "y" : "ies") + "."
        : "No published events are available on the shared calendar yet.";
      else status.textContent = "No shared calendar source is available in this session.";
    }
    if (retry) {
      retry.textContent = publishedFailed || historyFailed ? "Retry calendar load" : "Reload calendar";
      retry.disabled = false;
    }
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
  var filterGroup = document.querySelector("[data-calendar-filters]");
  if (filterGroup) filterGroup.addEventListener("change", render);
  if (retry) retry.addEventListener("click", load);
  render();
  load();
}());
