(function () {
  "use strict";

  var root = document.querySelector("[data-submissions-calendar]");
  if (!root) return;
  var status = document.getElementById("submissions-calendar-status");
  var title = document.querySelector("[data-submissions-calendar-title]");
  var previous = document.querySelector("[data-submissions-calendar-prev]");
  var next = document.querySelector("[data-submissions-calendar-next]");
  var viewDate = new Date();
  var events = [];

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }
  function dateKey(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + "-" + match[2] + "-" + match[3] : "";
  }
  function eventDate(event) { return dateKey(event && (event.date || event.startDate || event.event_date || event.record_date)); }
  function dedupe(items) {
    var seen = {};
    return (items || []).filter(function (event) {
      var id = String(event && (event.id || event.source_record_id) || [eventDate(event), event && event.title, event && event.type, event && event.owner].join("|"));
      if (!eventDate(event) || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }
  function render() {
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    if (title) title.textContent = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(viewDate);
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
      var labels = dayEvents.slice(0, 2).map(function (event) {
        var type = String(event.type || "general").toLowerCase().replace(/[^a-z]+/g, "-");
        return '<span class="calendar-event calendar-event-' + safe(type) + '" title="' + safe(event.title || "Event") + '">' + safe(event.title || event.type || "Event") + '</span>';
      }).join("");
      if (dayEvents.length > 2) labels += '<span class="calendar-more">+' + (dayEvents.length - 2) + " more</span>";
      html += '<span class="portal-calendar-day' + (key === today ? ' is-today' : '') + '"><time datetime="' + key + '">' + day + '</time>' + (labels || '<span class="portal-calendar-no-entry">—</span>') + '</span>';
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
    events = local;
    if (window.GMTPortalApi && typeof window.GMTPortalApi.enabled === "function" && window.GMTPortalApi.enabled()) {
      try {
        var history = await window.GMTPortalApi.history("calendar");
        var protectedEvents = (history && Array.isArray(history.records) ? history.records : []).map(function (record) {
          return { id: record.source_record_id, title: record.event_title || record.title || "Calendar request", date: record.event_date || record.record_date || record.start_date, type: record.event_type || record.type || "General", owner: record.owner || record.employee_name || "" };
        });
        events = events.concat(protectedEvents);
      } catch (_) {}
    }
    events = dedupe(events);
    if (status) status.textContent = events.length ? "Shared calendar: " + events.length + " event" + (events.length === 1 ? "" : "s") + "." : "Shared calendar connected. No events published yet.";
    render();
  }
  if (previous) previous.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); render(); });
  if (next) next.addEventListener("click", function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); render(); });
  render();
  load();
}());
