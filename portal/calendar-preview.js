(function () {
  "use strict";

  var root = document.querySelector("[data-portal-calendar]");
  if (!root) return;

  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var monthLabel = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  var weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var html = '<div class="portal-calendar-month-title">' + monthLabel + '</div><div class="portal-calendar-grid">';

  weekdays.forEach(function (day) { html += '<span class="portal-calendar-weekday">' + day + '</span>'; });
  for (var blank = 0; blank < firstDay; blank += 1) html += '<span class="portal-calendar-day is-empty" aria-hidden="true"></span>';
  for (var day = 1; day <= daysInMonth; day += 1) {
    var isToday = day === now.getDate();
    html += '<span class="portal-calendar-day' + (isToday ? ' is-today' : '') + '">' + day + '</span>';
  }
  html += '</div><p class="portal-calendar-empty">No approved events published.</p>';
  root.innerHTML = html;
}());
