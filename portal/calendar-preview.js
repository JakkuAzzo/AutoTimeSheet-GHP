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
        return '<span class="calendar-event calendar-event-' + safe(eventType(event)) + '" title="' + safe(label) + '">' + content + "</span>";
      }).join("");
      if (dayEvents.length > 4) labels += '<span class="calendar-more">+' + (dayEvents.length - 4) + " more</span>";
      html += '<span class="portal-calendar-day' + (key === today ? " is-today" : "") + '"><time datetime="' + key + '">' + day + "</time>" + (labels || '<span class="portal-calendar-no-entry">—</span>') + "</span>";
    }
    root.innerHTML = html + "</div>";
  }

  async function load() {
    var local = [];
    try {
      var response = await fetch("../data/calendar/events.json?v=" + Date.now(), { cache: "no-store" });
      if (response.ok) {
        var body = await response.json();
        local = Array.isArray(body) ? body : (Array.isArray(body.events) ? body.events : []);
      }
    } catch (_) {}
    var protectedRecords = [];
    if (window.GMTPortalApi && typeof window.GMTPortalApi.enabled === "function" && window.GMTPortalApi.enabled()) {
      try {
        var history = await window.GMTPortalApi.history("all");
        protectedRecords = history && Array.isArray(history.records) ? history.records : [];
      } catch (_) {}
    }
    var derived = typeof helper.recordsToEvents === "function" ? helper.recordsToEvents(protectedRecords) : [];
    events = local.concat(derived);
    var seen = {};
    events = events.filter(function (event) {
      var id = String(event && (event.id || event.recordId || event.source_record_id) || [eventDate(event), event && event.title, event && event.type, event && event.owner, event && event.detail].join("|"));
      if (!eventDate(event) || seen[id]) return false;
      seen[id] = true;
      return true;
    });
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
