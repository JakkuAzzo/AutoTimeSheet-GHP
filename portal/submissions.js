(function () {
  "use strict";

  var status = document.getElementById("submissions-status");
  var list = document.getElementById("submissions-list");
  var preview = document.getElementById("submissions-preview");
  var filter = document.getElementById("submissions-filter");
  var refresh = document.getElementById("submissions-refresh");
  var records = [];
  var selected = -1;
  var busy = false;

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }
  function actionKey(record) {
    var value = String(record && (record.kind || record.action || record.category || record.record_type || "timesheet")).toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1) return "tasks";
    return "timesheets";
  }
  function actionLabel(record) { return String(record && (record.action || record.kind || "Timesheet")).replace(/[_-]/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }); }
  function period(record) {
    if (record && record.record_date) return "Date " + record.record_date;
    if (record && (record.start_date || record.end_date)) return "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
    return "Not dated";
  }
  function visibleRecords() { return records.filter(function (record) { return filter && filter.value !== "all" ? actionKey(record) === filter.value : true; }); }
  function destination(record) {
    var key = actionKey(record);
    return key === "job-cards" ? "../jobs/" : key === "estimates" ? "../tools/estimates.html" : key === "tasks" ? "../tasks/" : key === "calendar" ? "../calendar/" : "timesheets.html";
  }
  function renderPreview(record) {
    if (!preview) return;
    if (!record) { preview.innerHTML = '<p class="small-text">Select a document to preview it.</p>'; return; }
    var label = actionLabel(record);
    var employee = record.employee_name || record.employee_upn || "Signed-in GMT account";
    var statusValue = record.status || "Submitted";
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(employee) + '</h2></div><span class="portal-status">' + safe(statusValue) + '</span></div><div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(label) + '</p><p><strong>Period:</strong> ' + safe(period(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.submitted_at || record.submittedAt || "Not recorded") + '</p><p><strong>Updated:</strong> ' + safe(record.updated_at || record.updatedAt || record.submitted_at || "Not recorded") + '</p><p><strong>Source:</strong> ' + safe(record.source || "Protected GMT portal") + '</p></div><p class="small-text">This view is filtered by the signed-in account privilege. Open the source area for the full document.</p><div class="portal-item-actions"><a class="button button-link" href="' + destination(record) + '">Open ' + safe(label) + '</a></div>';
  }
  function select(index) {
    selected = Number(index);
    var visible = visibleRecords();
    if (list && typeof list.querySelectorAll === "function") list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.setAttribute("aria-current", String(Number(button.getAttribute("data-submission-index")) === selected)); });
    renderPreview(visible[selected]);
  }
  function render() {
    var visible = visibleRecords();
    if (!list) return;
    if (!visible.length) {
      list.innerHTML = '<p class="small-text portal-history-empty">No submitted documents match this filter.</p>';
      renderPreview(null);
      selected = -1;
      return;
    }
    list.innerHTML = visible.map(function (record, index) {
      return '<button type="button" class="estimate-history-item" data-submission-index="' + index + '" aria-current="' + String(index === selected) + '"><strong>' + safe(record.employee_name || record.employee_upn || "GMT submission") + '</strong><span>' + safe(actionLabel(record)) + '</span><small>' + safe(period(record)) + ' · ' + safe(record.status || "Submitted") + '</small></button>';
    }).join("");
    if (typeof list.querySelectorAll === "function") list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.addEventListener("click", function () { select(Number(button.getAttribute("data-submission-index"))); }); });
    if (selected < 0 || selected >= visible.length) selected = 0;
    select(selected);
  }
  async function load() {
    if (busy) return;
    busy = true;
    if (refresh) refresh.disabled = true;
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      records = [];
      if (status) status.textContent = "Protected submission history is not connected yet.";
      render();
      if (refresh) refresh.disabled = false;
      busy = false;
      return;
    }
    if (status) status.textContent = "Loading your authorised submissions…";
    try {
      var body = await window.GMTPortalApi.history("all");
      records = body && Array.isArray(body.records) ? body.records : [];
      var scope = body && body.meta && body.meta.visible_scope ? " Access: " + body.meta.visible_scope + "." : "";
      if (status) status.textContent = records.length
        ? "Showing " + records.length + " submitted document" + (records.length === 1 ? "" : "s") + " authorised for your signed-in GMT identity." + scope
        : "No submitted documents are currently available for this account." + scope;
      render();
    } catch (error) {
      records = [];
      if (status) status.textContent = error && error.message ? error.message : "Submitted documents could not be loaded. Please try again or contact Accounts.";
      render();
    } finally {
      if (refresh) refresh.disabled = false;
      busy = false;
    }
  }
  if (filter) filter.addEventListener("change", function () { selected = -1; render(); });
  if (refresh) refresh.addEventListener("click", load);
  document.addEventListener("DOMContentLoaded", load);
}());
