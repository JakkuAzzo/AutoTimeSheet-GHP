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
  var current = 0;

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function payloadFor(record) {
    if (!record || typeof record.payload !== "object" || record.payload === null) return {};
    return record.payload;
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
}());
