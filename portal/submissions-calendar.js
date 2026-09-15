(function () {
  "use strict";

  var root = document.querySelector("[data-submissions-calendar]");
  if (!root) return;
  var status = document.getElementById("submissions-calendar-status");
  var title = document.querySelector("[data-submissions-calendar-title]");
  var previous = document.querySelector("[data-submissions-calendar-prev]");
  var next = document.querySelector("[data-submissions-calendar-next]");
  var picker = document.querySelector("[data-submissions-calendar-picker]");
  var input = document.querySelector("[data-submissions-calendar-input]");
  var viewDate = new Date();
  var events = [];
  var helper = window.GMTCalendarData || {};

  function safe(value) {
    return typeof helper.safe === "function" ? helper.safe(value) : String(value == null ? "" : value).replace(/[&<>"']/g, function (character) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]; });
  }
  function dateKey(value) {
    if (typeof helper.key === "function") return helper.key(value);
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + "-" + match[2] + "-" + match[3] : "";
  }
  function eventDate(event) { return dateKey(event && (event.date || event.startDate || event.event_date || event.record_date)); }
  function eventType(event) { return String(event && event.type || "general").toLowerCase().replace(/[^a-z]+/g, "-"); }
  function choose(event) {
    if (!event || !event.recordId) return;
    document.dispatchEvent(new CustomEvent("gmt:calendar-select", { detail: { recordId: event.recordId, date: event.date } }));
  }
  function render() {
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(viewDate);
    if (title) title.textContent = monthLabel;
    if (input) input.value = year + "-" + String(month + 1).padStart(2, "0");
    if (picker) picker.setAttribute("aria-label", "Choose calendar month: " + monthLabel);
    var first = new Date(year, month, 1);
    var offset = (first.getDay() + 6) % 7;
    var days = new Date(year, month + 1, 0).getDate();
    var byDay = {};
    events.forEach(function (event) { var key = eventDate(event); if (!byDay[key]) byDay[key] = []; byDay[key].push(event); });
    var today = dateKey(new Date().toISOString());
    var html = '<div class="portal-calendar-grid">';
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(function (day) { html += '<span class="portal-calendar-weekday">' + day + '</span>'; });
    for (var blank = 0; blank < offset; blank += 1) html += '<span class="portal-calendar-day is-empty" aria-hidden="true"></span>';
    for (var day = 1; day <= days; day += 1) {
      var key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      var dayEvents = byDay[key] || [];
      var labels = dayEvents.slice(0, 4).map(function (event) {
        // Row-level detail already includes the review marker when one of the
        // clock, break or schedule checks failed. Do not append it a second
        // time when the source record also carries an issue summary.
        var issueLabel = event.issue && !/\breview\b/i.test(String(event.detail || "")) ? " · review" : "";
        var detail = (event.detail || "") + issueLabel;
        var label = (event.title || event.type || "Event") + (detail ? " · " + detail : "");
        var content = "<strong>" + safe(event.title || event.type || "Event") + "</strong>" + (detail ? "<small>" + safe(detail) + "</small>" : "");
        if (event.recordId) return '<button type="button" class="calendar-event calendar-event-' + safe(eventType(event)) + '" data-calendar-record-id="' + safe(event.recordId) + '" data-calendar-date="' + safe(event.date) + '" title="' + safe(label) + '">' + content + "</button>";
        return '<span class="calendar-event calendar-event-' + safe(eventType(event)) + '" title="' + safe(label) + '">' + content + "</span>";
      }).join("");
      if (dayEvents.length > 4) labels += '<span class="calendar-more">+' + (dayEvents.length - 4) + " more</span>";
      html += '<span class="portal-calendar-day' + (key === today ? " is-today" : "") + '"><time datetime="' + key + '">' + day + "</time>" + (labels || '<span class="portal-calendar-no-entry">—</span>') + "</span>";
    }
    root.innerHTML = html + "</div>";
    root.querySelectorAll("[data-calendar-record-id]").forEach(function (button) {
      button.addEventListener("click", function () { choose({ recordId: button.getAttribute("data-calendar-record-id"), date: button.getAttribute("data-calendar-date") }); });
    });
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
        // Ask for all authorised records. The Worker still applies the signed
        // in account policy, while this lets timesheet daily rows populate the
        // same shared calendar as calendar requests.
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
    if (status) status.textContent = events.length ? "Shared calendar: " + events.length + " entr" + (events.length === 1 ? "y" : "ies") + ". Select an entry to open its record." : "Shared calendar connected. No events or dated submissions have been filed yet.";
    render();
  }
  if (previous) previous.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); render(); });
  if (next) next.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); render(); });
  if (picker && input) picker.addEventListener("click", function () {
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    if (typeof input.showPicker === "function") { try { input.showPicker(); return; } catch (_) {} }
    input.click();
  });
  if (input) input.addEventListener("change", function () {
    var match = String(input.value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return;
    viewDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    render();
  });
  render();
  load();
}());
