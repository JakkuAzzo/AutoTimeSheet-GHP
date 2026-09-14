(function () {
  "use strict";

  var status = document.getElementById("submissions-status");
  var list = document.getElementById("submissions-list");
  var preview = document.getElementById("submissions-preview");
  var filter = document.getElementById("submissions-filter");
  var refresh = document.getElementById("submissions-refresh");
  var records = [];
  var realRecordCount = 0;
  var historyMeta = {};
  var selected = -1;
  var busy = false;

  function requestedRecordId() {
    try { return new URLSearchParams(window.location.search).get("record") || ""; } catch (_) { return ""; }
  }

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }
  function actionKey(record) {
    var value = String(record && (record.kind || record.action || record.category || record.record_type || "timesheet")).toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1 || value.indexOf("contact") !== -1) return "enquiries";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1) return "tasks";
    return "timesheets";
  }
  function actionLabel(record) { return String(record && (record.demo_label || record.action || record.kind || "Timesheet")).replace(/[_-]/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }); }
  function displayName(record) {
    if (record && record.is_demo) return record.demo_name || "Example record";
    if (record && actionKey(record) === "enquiries") return record.customer_name || record.employee_name || record.employee_upn || "Customer enquiry";
    return (record && (record.employee_name || record.employee_upn)) || "GMT submission";
  }
  function period(record) {
    if (record && record.record_date) return "Date " + record.record_date;
    if (record && (record.start_date || record.end_date)) return "Week " + (record.start_date || "not dated") + " to " + (record.end_date || "not dated");
    return "Not dated";
  }
  function visibleRecords() { return records.filter(function (record) { return filter && filter.value !== "all" ? actionKey(record) === filter.value : true; }); }
  function emptyMessage() {
    if (filter && filter.value === "all" && historyMeta.is_operations_admin && !historyMeta.is_admin) return "No non-timesheet submissions are available yet. This account can see all job cards, estimates, tasks and calendar requests; employee timesheets remain owner-filtered.";
    return "No submitted documents match this filter.";
  }
  function destination(record) {
    var key = actionKey(record);
    return key === "job-cards" ? "../jobs/" : key === "estimates" ? "../tools/estimates.html" : key === "tasks" ? "../tasks/" : key === "calendar" ? "../calendar/" : key === "enquiries" ? "../#workshop-enquiry" : "timesheets.html";
  }
  function withExamples(realRecords) {
    var result = Array.isArray(realRecords) ? realRecords.slice() : [];
    var today = new Date().toISOString().slice(0, 10);
    var examples = [
      { record_id: "demo-job-card", kind: "job-cards", action: "job_card_example", demo_label: "Job card example", demo_name: "Example job card", status: "Example only", record_date: today, source: "GMT demonstration" },
      { record_id: "demo-estimate", kind: "estimates", action: "estimate_example", demo_label: "Estimate example", demo_name: "Example estimate", status: "Example only", record_date: today, source: "GMT demonstration" },
      { record_id: "demo-task", kind: "tasks", action: "task_example", demo_label: "Task example", demo_name: "Example task", status: "Example only", record_date: today, source: "GMT demonstration" }
    ];
    examples.forEach(function (example) { result.push(Object.assign({ is_demo: true }, example)); });
    return result;
  }
  function renderEnquiryPreview(record) {
    var messages = Array.isArray(record.messages) ? record.messages : [];
    if (!messages.length && record.message) messages = [{ direction: "inbound", author: record.customer_name || "Customer", body: record.message, at: record.submitted_at || "" }];
    var thread = messages.length ? messages.map(function (message) {
      var outbound = String(message.direction || "inbound").toLowerCase() === "outbound";
      return '<article class="enquiry-thread-message ' + (outbound ? 'is-outbound' : 'is-inbound') + '"><div class="enquiry-thread-message-meta"><strong>' + safe(message.author || (outbound ? "GMT team" : record.customer_name || "Customer")) + '</strong><time datetime="' + safe(message.at || "") + '">' + safe(message.at || "") + '</time></div><p>' + safe(message.body || message.subject || "") + '</p></article>';
    }).join("") : '<p class="small-text">No message body has been filed yet. Open the inbox thread to review the source conversation.</p>';
    var outlookLink = record.conversation_url ? '<p><a class="button button-link" href="' + safe(record.conversation_url) + '" target="_blank" rel="noopener">Open inbox thread</a></p>' : '<p class="small-text">The Outlook conversation link will appear after the Microsoft 365 intake flow links this enquiry.</p>';
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">Customer enquiry</p><h2>' + safe(record.customer_name || "Unnamed customer") + '</h2></div><span class="portal-status">' + safe(record.status || "New") + '</span></div><div class="timesheet-paper-meta"><p><strong>Request:</strong> ' + safe(record.request_type || "General enquiry") + '</p><p><strong>Email:</strong> ' + safe(record.customer_email || "Not provided") + '</p><p><strong>Phone:</strong> ' + safe(record.customer_phone || "Not provided") + '</p><p><strong>Inbox:</strong> ' + safe(record.mailbox || "GMT enquiries inbox") + ' · ' + safe(record.inbox_status || "Awaiting inbox synchronisation") + '</p><p><strong>Thread ID:</strong> ' + safe(record.thread_id || record.conversation_id || "Not linked") + '</p></div><section class="enquiry-thread" aria-label="Enquiry email thread"><h3>Email thread</h3>' + thread + '</section>' + outlookLink + '<form class="enquiry-reply-form" data-enquiry-reply-form="' + safe(record.source_record_id || "") + '"><label for="enquiry-reply">Add to this thread<textarea id="enquiry-reply" name="reply" rows="4" placeholder="Add an internal note or reply for Accounts to send" required></textarea></label><button type="submit" class="secondary">Save to protected thread</button><p class="small-text" data-enquiry-reply-status role="status">Replies are saved to the protected record. Microsoft 365 inbox sending remains flow-managed.</p></form>';
    var replyForm = preview.querySelector("[data-enquiry-reply-form]");
    if (replyForm) replyForm.addEventListener("submit", function (event) { saveEnquiryReply(event, record); });
  }
  async function saveEnquiryReply(event, record) {
    event.preventDefault();
    var form = event.currentTarget;
    var input = form.querySelector("[name=reply]");
    var feedback = form.querySelector("[data-enquiry-reply-status]");
    var body = String(input && input.value || "").trim();
    if (!body || !window.GMTPortalApi || typeof window.GMTPortalApi.updateRecord !== "function") return;
    var messages = Array.isArray(record.messages) ? record.messages.slice() : [];
    messages.push({ id: "reply-" + Date.now(), direction: "outbound", author: "GMT team", body: body, at: new Date().toISOString() });
    if (feedback) feedback.textContent = "Saving to the protected enquiry thread…";
    form.querySelector("button[type=submit]").disabled = true;
    try {
      await window.GMTPortalApi.updateRecord(record.source_record_id, {
        kind: "enquiries",
        action: "reply_request",
        status: "Reply queued",
        recordDate: record.record_date || "",
        payload: { enquiryId: record.enquiry_id || record.source_record_id, customerName: record.customer_name, customerEmail: record.customer_email, customerPhone: record.customer_phone, requestType: record.request_type, message: record.message, conversationUrl: record.conversation_url, conversationId: record.conversation_id, threadId: record.thread_id, inboxStatus: "Reply queued for Microsoft 365", mailbox: record.mailbox, replyTo: record.reply_to || record.customer_email, messages: messages }
      });
      record.messages = messages;
      record.status = "Reply queued";
      if (input) input.value = "";
      if (feedback) feedback.textContent = "Saved. Accounts can send or continue this thread from the linked inbox conversation.";
      renderEnquiryPreview(record);
    } catch (error) {
      if (feedback) feedback.textContent = error && error.message ? error.message : "The reply could not be saved.";
      form.querySelector("button[type=submit]").disabled = false;
    }
  }
  function renderPreview(record) {
    if (!preview) return;
    if (!record) { preview.innerHTML = '<p class="small-text">Select a document to preview it.</p>'; return; }
    if (actionKey(record) === "enquiries") { renderEnquiryPreview(record); return; }
    var label = actionLabel(record);
    var employee = displayName(record);
    var statusValue = record.is_demo ? "Example only" : (record.status || "Submitted");
    var demoDescription = record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '';
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(employee) + '</h2></div><span class="portal-status">' + safe(statusValue) + '</span></div><div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(label) + '</p><p><strong>Period:</strong> ' + safe(period(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.is_demo ? "Example data" : (record.submitted_at || record.submittedAt || "Not recorded")) + '</p><p><strong>Updated:</strong> ' + safe(record.is_demo ? "Example data" : (record.updated_at || record.updatedAt || record.submitted_at || "Not recorded")) + '</p><p><strong>Source:</strong> ' + safe(record.is_demo ? "GMT demonstration" : (record.source || "Protected GMT portal")) + '</p></div>' + demoDescription + '<p class="small-text">This view is filtered by the signed-in account privilege. Open the source area for the full document.</p><div class="portal-item-actions"><a class="button button-link" href="' + destination(record) + '">Open ' + safe(label) + '</a></div>';
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
      list.innerHTML = '<p class="small-text portal-history-empty">' + safe(emptyMessage()) + '</p>';
      renderPreview(null);
      selected = -1;
      return;
    }
    list.innerHTML = visible.map(function (record, index) {
      return '<button type="button" class="estimate-history-item' + (record.is_demo ? ' submission-demo-item' : '') + '" data-submission-index="' + index + '" aria-current="' + String(index === selected) + '"><strong>' + safe(displayName(record)) + '</strong><span>' + safe(actionLabel(record)) + '</span><small>' + safe(period(record)) + ' · ' + safe(record.is_demo ? "Example only · not submitted" : (record.status || "Submitted")) + '</small></button>';
    }).join("");
    if (typeof list.querySelectorAll === "function") list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.addEventListener("click", function () { select(Number(button.getAttribute("data-submission-index"))); }); });
    if (selected < 0 || selected >= visible.length) {
      var requested = requestedRecordId();
      var requestedIndex = requested ? visible.findIndex(function (record) { return String(record.source_record_id || record.record_id || "") === requested; }) : -1;
      selected = requestedIndex >= 0 ? requestedIndex : 0;
    }
    select(selected);
  }
  async function load() {
    if (busy) return;
    busy = true;
    if (refresh) refresh.disabled = true;
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      realRecordCount = 0;
      records = withExamples([]);
      historyMeta = {};
      if (status) status.textContent = "Protected submission history is not connected yet. Showing labelled examples so the document views remain discoverable.";
      render();
      if (refresh) refresh.disabled = false;
      busy = false;
      return;
    }
    if (status) status.textContent = "Loading your authorised submissions…";
    try {
      var body = await window.GMTPortalApi.history("all");
      var realRecords = body && Array.isArray(body.records) ? body.records : [];
      realRecordCount = realRecords.length;
      records = withExamples(realRecords);
      historyMeta = body && body.meta && typeof body.meta === "object" ? body.meta : {};
      var scope = body && body.meta && body.meta.visible_scope ? " Access: " + body.meta.visible_scope + "." : "";
      if (status) status.textContent = realRecordCount
        ? "Showing " + realRecordCount + " submitted document" + (realRecordCount === 1 ? "" : "s") + " authorised for your signed-in GMT identity, plus labelled examples." + scope
        : "No submitted documents are currently available for this account. Labelled examples are shown below." + scope;
      render();
    } catch (error) {
      realRecordCount = 0;
      records = withExamples([]);
      historyMeta = {};
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
