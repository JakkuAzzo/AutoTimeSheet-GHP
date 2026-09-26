(function () {
  "use strict";

  var carousel = document.querySelector("[data-updates-carousel]");
  if (!carousel) return;

  var slides = Array.prototype.slice.call(carousel.querySelectorAll("[data-updates-slide]"));
  var dots = Array.prototype.slice.call(carousel.querySelectorAll("[data-updates-dot]"));
  var previous = carousel.querySelector("[data-updates-prev]");
  var next = carousel.querySelector("[data-updates-next]");
  var board = document.getElementById("portal-task-board");
  var status = document.getElementById("portal-task-board-status");
  var notificationList = document.getElementById("portal-notifications");
  var current = 0;
  var notificationRecords = [];
  var notificationDialog = null;

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function payloadFor(record) {
    if (!record || typeof record.payload !== "object" || record.payload === null) return {};
    return record.payload;
  }

  function notificationKind(record, payload) {
    if (payload && payload.editNotification) return "Timesheet change";
    var value = String(record && (record.kind || record.action || record.category || "") || "").toLowerCase();
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1 || value.indexOf("contact") !== -1) return "Enquiry";
    if (value.indexOf("task") !== -1) return "Task";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "Calendar";
    if (value.indexOf("job") !== -1) return "Job card";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "Estimate";
    if (value.indexOf("invoice") !== -1) return "Invoice";
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1) return "Clock / break";
    return "Timesheet";
  }

  function notificationTitle(record, payload) {
    var kind = notificationKind(record, payload);
    if (kind === "Timesheet change") return (payload.editNotification && payload.editNotification.targetName) || record.employee_name || "Timesheet updated";
    return record.customer_name || record.event_title || record.task_title || record.job_ref || record.estimate_number || payload.title || payload.customerName || payload.eventTitle || payload.jobReference || payload.number || kind;
  }

  function notificationDetails(record, payload) {
    var kind = notificationKind(record, payload);
    var parts = [];
    if (kind === "Timesheet change") parts.push((payload.editNotification && payload.editNotification.message) || payload.editNote || "Timesheet updated", record.record_date || record.start_date || "");
    if (kind === "Task") parts.push(payload.jobReference || record.job_reference || "Task");
    if (kind === "Enquiry") parts.push(payload.requestType || record.request_type || "General enquiry", payload.message || record.message || "");
    if (kind === "Calendar") parts.push(payload.type || record.event_type || "Calendar request", payload.date || record.event_date || record.record_date || "");
    if (kind === "Job card") parts.push(payload.client || record.client || "Job card");
    if (kind === "Estimate") parts.push(payload.company || record.client_company || "Estimate");
    if (kind === "Timesheet" || kind === "Clock / break") parts.push(record.record_date || record.start_date || "Timesheet");
    parts.push(record.status || payload.status || "Submitted");
    return parts.filter(function (part) { return String(part || "").trim(); }).join(" · ");
  }

  function notificationDate(record, payload) {
    return record.updated_at || record.submitted_at || payload.updatedAt || payload.submittedAt || record.record_date || record.event_date || "";
  }

  function truncate(value, max) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function ensureNotificationDialog() {
    if (notificationDialog) return notificationDialog;
    notificationDialog = document.createElement("dialog");
    notificationDialog.className = "portal-notification-dialog";
    notificationDialog.setAttribute("aria-labelledby", "portal-notification-dialog-title");
    notificationDialog.innerHTML = '<div class="portal-notification-dialog-header"><div><p class="eyebrow">GMT notification</p><h2 id="portal-notification-dialog-title">Submission details</h2></div><button type="button" class="secondary" data-notification-close>Close</button></div><div data-notification-dialog-body></div>';
    document.body.appendChild(notificationDialog);
    notificationDialog.addEventListener("click", function (event) {
      if (event.target === notificationDialog || event.target.closest("[data-notification-close]")) notificationDialog.close();
    });
    notificationDialog.addEventListener("cancel", function () { notificationDialog.close(); });
    return notificationDialog;
  }

  function openNotification(index) {
    var record = notificationRecords[Number(index)];
    if (!record) return;
    var payload = payloadFor(record);
    var dialog = ensureNotificationDialog();
    var body = dialog.querySelector("[data-notification-dialog-body]");
    var kind = notificationKind(record, payload);
    var title = notificationTitle(record, payload);
    var details = notificationDetails(record, payload);
    var full = Object.keys(payload).map(function (key) { return '<dt>' + safe(key.replace(/([A-Z])/g, " $1")) + '</dt><dd>' + safe(typeof payload[key] === "object" ? JSON.stringify(payload[key]) : payload[key]) + '</dd>'; }).join("");
    if (body) body.innerHTML = '<p class="portal-card-kicker">' + safe(kind) + '</p><h3>' + safe(title) + '</h3><p class="small-text">' + safe(details) + '</p><dl class="portal-notification-details"><dt>Status</dt><dd>' + safe(record.status || payload.status || "Submitted") + '</dd><dt>Submitted</dt><dd>' + safe(record.submitted_at || payload.submittedAt || "Not recorded") + '</dd><dt>Updated</dt><dd>' + safe(record.updated_at || payload.updatedAt || "Not recorded") + '</dd>' + full + '</dl><p><a class="portal-text-link" href="/portal/submissions?record=' + encodeURIComponent(record.source_record_id || record.record_id || "") + '">Open in Submitted documents →</a></p>';
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
  }

  function renderNotifications(records) {
    if (!notificationList) return;
    // Timesheets remain visible in the dedicated history/calendar views. The
    // dashboard updates feed is reserved for operational updates such as
    // enquiries, tasks, calendar requests, job cards, estimates and invoices.
    notificationRecords = (Array.isArray(records) ? records : []).filter(function (record) {
      var payload = payloadFor(record);
      var kind = notificationKind(record, payload);
      return kind !== "Timesheet" && kind !== "Clock / break";
    }).slice().sort(function (left, right) {
      return String(right.updated_at || right.submitted_at || "").localeCompare(String(left.updated_at || left.submitted_at || ""));
    }).slice(0, 8);
    if (!notificationRecords.length) {
      notificationList.innerHTML = '<div class="portal-notification-empty" role="status"><span aria-hidden="true">✓</span><div><strong>No new notifications</strong><small>You are up to date.</small></div></div>';
      return;
    }
    notificationList.innerHTML = notificationRecords.map(function (record, index) {
      var payload = payloadFor(record);
      var kind = notificationKind(record, payload);
      var title = notificationTitle(record, payload);
      var details = notificationDetails(record, payload);
      return '<button type="button" class="portal-notification-bubble" data-notification-index="' + index + '"><span class="portal-notification-kind">' + safe(kind) + '</span><strong>' + safe(truncate(title, 64)) + '</strong><small>' + safe(truncate(details, 110)) + ' · ' + safe(truncate(notificationDate(record, payload), 28)) + '</small></button>';
    }).join("");
    notificationList.querySelectorAll("[data-notification-index]").forEach(function (button) { button.addEventListener("click", function () { openNotification(button.getAttribute("data-notification-index")); }); });
  }

  function taskTitle(record, payload) {
    return record.task_title || payload.title || record.title || "Untitled task";
  }

  function taskAssignee(record, payload) {
    return record.assignee || record.task_assignee || payload.assignee || payload.assignedTo || "Unassigned";
  }

  function taskCreator(record, payload) {
    return record.created_by || record.createdBy || payload.createdBy || payload.created_by || record.employee_name || record.employee_upn || "GMT account";
  }

  function taskProgress(record, payload) {
    var raw = record.progress;
    if (raw === undefined || raw === null || raw === "") raw = record.task_progress;
    if (raw === undefined || raw === null || raw === "") raw = payload.progress;
    var numeric = Number(raw);
    if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(numeric)) {
      var bounded = Math.max(0, Math.min(100, numeric));
      return { value: bounded, label: bounded + "%" };
    }
    var taskStatus = String(record.status || payload.status || "Submitted").trim();
    if (/complete|done/i.test(taskStatus)) return { value: 100, label: "100% · Completed" };
    if (/in[ -]?progress|working/i.test(taskStatus)) return { value: 50, label: "50% · In progress" };
    if (/assigned|to[ -]?do|pending|submitted|saved|received/i.test(taskStatus)) return { value: 0, label: "0% · " + taskStatus };
    return { value: null, label: taskStatus || "Not started" };
  }

  function taskRecords(body) {
    return body && Array.isArray(body.records) ? body.records.filter(function (record) {
      return record && (record.kind === undefined || String(record.kind).toLowerCase() === "tasks");
    }) : [];
  }

  function renderTask(record) {
    var payload = payloadFor(record);
    var progress = taskProgress(record, payload);
    var title = taskTitle(record, payload);
    var assignee = taskAssignee(record, payload);
    var creator = taskCreator(record, payload);
    var taskStatus = String(record.status || payload.status || "Submitted");
    var due = record.due_date || payload.due || "No due date";
    var job = record.job_reference || payload.jobReference || "No job reference";
    var bar = progress.value === null ? "" : '<span class="portal-task-progress-bar" style="width:' + progress.value + '%"></span>';
    return '<article class="portal-task-card">' +
      '<div class="portal-task-card-heading"><h3>' + safe(title) + '</h3><span class="portal-task-status">' + safe(taskStatus) + '</span></div>' +
      '<p class="portal-task-card-reference">' + safe(job) + ' · Due ' + safe(due) + '</p>' +
      '<dl class="portal-task-card-meta">' +
        '<div><dt>Assigned to</dt><dd>' + safe(assignee) + '</dd></div>' +
        '<div><dt>Created by</dt><dd>' + safe(creator) + '</dd></div>' +
      '</dl>' +
      '<div class="portal-task-progress"><div class="portal-task-progress-label"><strong>Progress</strong><span>' + safe(progress.label) + '</span></div>' +
        '<div class="portal-task-progress-track" role="progressbar" aria-label="' + safe(title) + ' progress" aria-valuemin="0" aria-valuemax="100"' + (progress.value === null ? '' : ' aria-valuenow="' + progress.value + '"') + '>' + bar + '</div></div>' +
      '</article>';
  }

  function renderTasks(records) {
    if (!board) return;
    if (!records.length) {
      board.innerHTML = '<p class="portal-task-board-empty">No submitted tasks are available for this account yet.</p>';
      return;
    }
    board.innerHTML = records.map(renderTask).join("");
  }

  function show(index) {
    if (!slides.length) return;
    current = (index + slides.length) % slides.length;
    slides.forEach(function (slide, slideIndex) {
      var active = slideIndex === current;
      slide.hidden = !active;
      slide.setAttribute("aria-hidden", String(!active));
      slide.id = "portal-updates-slide-" + slideIndex;
    });
    dots.forEach(function (dot, dotIndex) {
      var active = dotIndex === current;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-selected", String(active));
      dot.tabIndex = active ? 0 : -1;
    });
  }

  async function loadTasks() {
    if (!board || !status) return;
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      status.textContent = "Protected task history is not connected.";
      renderTasks([]);
      return;
    }
    try {
      var body = await window.GMTPortalApi.history("tasks");
      var records = taskRecords(body);
      status.textContent = records.length ? records.length + " submitted task" + (records.length === 1 ? "" : "s") + "." : "No submitted tasks yet.";
      renderTasks(records);
    } catch (error) {
      status.textContent = error && error.message ? error.message : "Submitted tasks could not be loaded.";
      renderTasks([]);
    }
  }

  async function loadNotifications() {
    if (!notificationList) return;
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.history !== "function" || !window.GMTPortalApi.enabled || !window.GMTPortalApi.enabled()) {
      renderNotifications([]);
      return;
    }
    try {
      var body = await window.GMTPortalApi.history("all");
      renderNotifications(body && Array.isArray(body.records) ? body.records : []);
    } catch (_) {
      renderNotifications([]);
    }
  }

  if (previous) previous.addEventListener("click", function () { show(current - 1); });
  if (next) next.addEventListener("click", function () { show(current + 1); });
  dots.forEach(function (dot, index) {
    dot.addEventListener("click", function () { show(index); });
    dot.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") { event.preventDefault(); show(current + 1); dots[current].focus(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); show(current - 1); dots[current].focus(); }
    });
  });

  show(0);
  loadTasks();
  loadNotifications();
}());
