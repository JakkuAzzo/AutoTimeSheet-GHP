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
  var eventsLink = null;
  var taskLink = null;
  var timeOffLink = null;

  function validDay(value) {
    var day = String(value || "");
    if (!DAY_PATTERN.test(day)) return false;
    var parts = day.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function currentPayMonth() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    var year = parts.find(function (part) { return part.type === "year"; });
    var month = parts.find(function (part) { return part.type === "month"; });
    return (year && year.value ? year.value : "") + "-" + (month && month.value ? month.value : "");
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

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "calendar-day-actions-dialog";
    dialog.setAttribute("aria-labelledby", "calendar-day-actions-title");
    dialog.innerHTML =
      '<div class="calendar-day-actions-header"><div><p class="portal-card-kicker">Calendar day</p><h2 id="calendar-day-actions-title">Day actions</h2><p id="calendar-day-actions-date" class="small-text"></p></div><button type="button" class="secondary calendar-day-actions-close" data-calendar-actions-close aria-label="Close day actions">Close</button></div>' +
      '<p id="calendar-day-actions-note" class="calendar-day-actions-note"></p>' +
      '<div class="calendar-day-actions-grid">' +
        '<a class="calendar-day-action" data-calendar-action-timesheet><strong>Create timesheet</strong><small>Open the daily entry for this pay month.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-events><strong>View this day’s events</strong><small>Review submissions and shared calendar records.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-task><strong>Create task</strong><small>Start a task with this date as its due date.</small></a>' +
        '<a class="calendar-day-action" data-calendar-action-time-off><strong>Request time off</strong><small>Open a dated absence or leave request.</small></a>' +
      '</div>';
    document.body.appendChild(dialog);
    dialogHeading = dialog.querySelector("#calendar-day-actions-title");
    dialogDate = dialog.querySelector("#calendar-day-actions-date");
    dialogNote = dialog.querySelector("#calendar-day-actions-note");
    timesheetLink = dialog.querySelector("[data-calendar-action-timesheet]");
    eventsLink = dialog.querySelector("[data-calendar-action-events]");
    taskLink = dialog.querySelector("[data-calendar-action-task]");
    timeOffLink = dialog.querySelector("[data-calendar-action-time-off]");
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog || event.target.closest("[data-calendar-actions-close]")) dialog.close();
    });
    dialog.addEventListener("cancel", function () { dialog.close(); });
    return dialog;
  }

  function open(day) {
    if (!validDay(day)) return;
    var target = ensureDialog();
    var month = String(day).slice(0, 7);
    var isCurrentPayMonth = month === currentPayMonth();
    var formatted = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" }).format(new Date(day + "T12:00:00Z"));
    dialogHeading.textContent = "Actions for " + formatted;
    dialogDate.textContent = day;
    dialogNote.textContent = isCurrentPayMonth
      ? "Choose an action for this date. Timesheet editing is available while the date is in the current pay month."
      : "This date is outside the current pay month. You can review or request work, while timesheet editing remains limited to the current pay month.";
    timesheetLink.href = href("/timesheets/create.html", { day: day }, "#day-" + day);
    eventsLink.href = href("/portal/submissions.html", { day: day });
    taskLink.href = href("/tasks/", { date: day });
    timeOffLink.href = href("/calendar/", { request: "time-off", date: day }, "#calendar-form");
    timesheetLink.classList.toggle("is-disabled", !isCurrentPayMonth);
    timesheetLink.setAttribute("aria-disabled", String(!isCurrentPayMonth));
    if (!isCurrentPayMonth) timesheetLink.setAttribute("tabindex", "-1");
    else timesheetLink.removeAttribute("tabindex");
    if (typeof target.showModal === "function") target.showModal();
    else target.setAttribute("open", "");
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest && event.target.closest("[data-calendar-day]");
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute("data-calendar-day"));
  });

  window.GMTCalendarActions = { open: open, currentPayMonth: currentPayMonth };
}());
