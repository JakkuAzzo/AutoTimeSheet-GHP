(function () {
  "use strict";

  var status = document.getElementById("submissions-status");
  var list = document.getElementById("submissions-list");
  var preview = document.getElementById("submissions-preview");
  var filter = document.getElementById("submissions-filter");
  var employeeFilterWrap = document.getElementById("submissions-employee-filter");
  var employeeFilter = document.getElementById("submissions-employee");
  var refresh = document.getElementById("submissions-refresh");
  var adminTimesheetSummary = document.getElementById("submissions-admin-timesheet-summary");
  var adminTimesheetStatus = document.getElementById("submissions-admin-timesheet-status");
  var adminTimesheetNote = document.getElementById("submissions-admin-timesheet-note");
  var adminTimesheetTable = document.getElementById("submissions-admin-timesheet-table");
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
  function money(value) {
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value) || 0); } catch (_) { return "£" + (Number(value) || 0).toFixed(2); }
  }
  function actionKey(record) {
    var value = String(record && (record.kind || record.action || record.category || record.record_type || "timesheet")).toLowerCase();
    if (value.indexOf("clock") !== -1 || value.indexOf("break") !== -1 || value.indexOf("absence") !== -1) return "clock";
    if (value.indexOf("enquir") !== -1 || value.indexOf("inquir") !== -1 || value.indexOf("contact") !== -1) return "enquiries";
    if (value.indexOf("job") !== -1) return "job-cards";
    if (value.indexOf("estimate") !== -1 || value.indexOf("quote") !== -1) return "estimates";
    if (value.indexOf("invoice") !== -1) return "invoices";
    if (value.indexOf("calendar") !== -1 || value.indexOf("event") !== -1 || value.indexOf("leave") !== -1) return "calendar";
    if (value.indexOf("task") !== -1) return "tasks";
    return "timesheets";
  }
  function typeLabel(record) {
    var key = actionKey(record);
    var labels = { timesheets: "Timesheet", clock: "Clock / breaks", enquiries: "Enquiry", "job-cards": "Job card", estimates: "Estimate", invoices: "Invoice", tasks: "Task", calendar: "Calendar request" };
    if (labels[key]) return labels[key];
    return String(record && (record.demo_label || record.action || record.kind || "Document")).replace(/[_-]/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }
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
  function currentEmployee() { return employeeFilter && employeeFilter.value ? String(employeeFilter.value).toLowerCase() : ""; }
  function employeeKey(record) {
    if (!record || record.is_demo || actionKey(record) === "enquiries") return "";
    return String(record.employee_upn || record.employee_name || "").trim().toLowerCase();
  }
  function compactDate(record) {
    if (record && record.record_date) return String(record.record_date);
    var start = String(record && (record.start_date || record.startDate) || "");
    var end = String(record && (record.end_date || record.endDate) || "");
    if (start && end && start !== end) return start + " – " + end;
    return start || end || "Not dated";
  }
  function visibleRecords() {
    var selectedType = filter && filter.value && filter.value !== "all" ? filter.value : "";
    var selectedEmployee = currentEmployee();
    return records.filter(function (record) {
      if (selectedType && actionKey(record) !== selectedType) return false;
      if (selectedEmployee && employeeKey(record) !== selectedEmployee) return false;
      return true;
    });
  }
  function populateEmployees(realRecords) {
    if (!employeeFilter) return 0;
    var selected = currentEmployee();
    var entries = new Map();
    function add(value, label) {
      value = String(value || "").trim();
      label = String(label || value || "").trim();
      if (!value || !label) return;
      var key = value.toLowerCase();
      if (!entries.has(key)) entries.set(key, { value: value, label: label });
    }
    var completionEmployees = historyMeta && historyMeta.completion && Array.isArray(historyMeta.completion.employees) ? historyMeta.completion.employees : [];
    completionEmployees.forEach(function (employee) { add(employee.employee_upn || employee.employee_name, employee.employee_name || employee.employee_upn); });
    (realRecords || []).forEach(function (record) {
      if (record && !record.is_demo && actionKey(record) !== "enquiries") add(record.employee_upn || record.employee_name, record.employee_name || record.employee_upn);
    });
    var sorted = Array.from(entries.values()).sort(function (left, right) { return left.label.localeCompare(right.label); });
    employeeFilter.innerHTML = '<option value="">All employees</option>' + sorted.map(function (entry) { return '<option value="' + safe(entry.value) + '">' + safe(entry.label) + '</option>'; }).join("");
    employeeFilter.value = selected;
    // Keep the control visible on every authorised document view. Accounts
    // receives the full roster; other identities simply see the employees
    // present in their authorised history (often just themselves).
    if (employeeFilterWrap) employeeFilterWrap.hidden = false;
    return sorted.length;
  }
  function emptyMessage() {
    if (filter && filter.value === "all" && historyMeta.is_operations_admin && !historyMeta.is_admin) return "No non-timesheet submissions are available yet. This account can see all job cards, estimates, tasks and calendar requests; employee timesheets remain owner-filtered.";
    return "No submitted documents match this filter.";
  }
  function destination(record) {
    var key = actionKey(record);
    return key === "job-cards" ? "../jobs/" : key === "estimates" ? "../tools/estimates.html" : key === "invoices" ? "../tools/invoices.html" : key === "tasks" ? "../tasks/" : key === "calendar" ? "../calendar/" : key === "enquiries" ? "../#workshop-enquiry" : "timesheets.html";
  }
  function timesheetHref(record, day) {
    var params = [];
    var recordId = record && (record.source_record_id || record.record_id || record.id);
    var employee = record && (record.employee_upn || record.employee_name);
    var month = String(record && (record.end_date || record.endDate || record.start_date || record.startDate || record.record_date || record.recordDate) || '').slice(0, 7);
    if (recordId && !record.is_demo) params.push('record=' + encodeURIComponent(recordId));
    if (employee && !record.is_demo) params.push('employee=' + encodeURIComponent(employee));
    if (/^\d{4}-\d{2}$/.test(month) && !record.is_demo) params.push('month=' + month);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) && !record.is_demo) params.push('day=' + encodeURIComponent(day));
    return 'timesheets.html' + (params.length ? '?' + params.join('&') : '');
  }
  function withExamples(realRecords) {
    var result = Array.isArray(realRecords) ? realRecords.slice() : [];
    var today = new Date().toISOString().slice(0, 10);
    var examples = [
      { record_id: "demo-job-card", kind: "job-cards", action: "job_card_example", demo_label: "Job card example", demo_name: "Example job card", status: "Example only", record_date: today, source: "GMT demonstration", payload: { jobReference: "GMT-DEMO-001", client: "Example client", site: "93-95 Gloucester Road, Croydon CR0 2DN", engineer: "Example engineer", plannedDate: today, description: "Example job card for review before a real job is submitted.", cardType: "EC", jobStatus: "Received", jobRevision: 1 } },
      { record_id: "demo-estimate", kind: "estimates", action: "estimate_example", demo_label: "Estimate example", demo_name: "Example estimate", status: "Example only", record_date: today, source: "GMT demonstration", payload: { number: "GMT-EST-DEMO-001", date: today, attention: "Example contact", company: "Example client", email: "client@example.com", validity: "30", preparedBy: "GMT Accounts", vatRate: 20, reference: "Re: example motor service", opening: "Thank you for your enquiry. This labelled example shows the client-facing estimate layout.", terms: "All works quoted are subject to confirmation. This is demonstration data only.", items: [{ description: "Inspection and service", quantity: 1, unit: 250 }], subtotal: 250, vat: 50, total: 300 } },
      { record_id: "demo-task", kind: "tasks", action: "task_example", demo_label: "Task example", demo_name: "Example task", status: "Example only", record_date: today, source: "GMT demonstration", payload: { title: "Example task", jobReference: "GMT-DEMO-001", assignee: "Example engineer", due: today, priority: "Normal", notes: "Example task for the GMT operational workflow." } }
    ];
    examples.forEach(function (example) { result.push(Object.assign({ is_demo: true }, example)); });
    return result;
  }

  function payloadFor(record) {
    return record && record.payload && typeof record.payload === "object" ? record.payload : {};
  }
  function sparseTimesheet(record) {
    return actionKey(record) === "timesheets" && !!(record && (record.daily_detail_issue || /daily rows were not returned/i.test(String(record.issue || ""))));
  }

  function jobPreviewData(record) {
    var payload = payloadFor(record);
    return {
      ref: record.job_ref || payload.jobReference || payload.ref || record.record_id || "EC 00000",
      client: record.client || payload.client || payload.company || "Customer / client",
      site: record.site || payload.site || payload.siteAddress || "Job address",
      engineer: record.engineer || payload.engineer || payload.assignedEngineer || "Engineer",
      date: record.planned_date || payload.plannedDate || payload.date || record.record_date || "Date",
      description: record.description || payload.description || "Job description / report"
    };
  }

  function renderEcJobSheet(data) {
    return '<article class="job-card-sheet job-card-sheet-ec" aria-label="EC job card preview">' +
      '<div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand">GMT Electrical Services</span></div><div class="job-sheet-number"><span>E.C.No</span><strong>' + safe(data.ref || "EC 00000") + '</strong></div></div>' +
      '<div class="job-sheet-meta-grid job-sheet-meta-ec"><div class="job-sheet-field"><span>Date:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field job-sheet-address"><span>Job Address:</span><strong>' + safe(data.site) + '</strong></div><div class="job-sheet-field"><span>Customer:</span><strong>' + safe(data.client) + '</strong></div><div class="job-sheet-field"><span>Contact:</span><strong>________________</strong></div><div class="job-sheet-field"><span>Order No:</span><strong>' + safe(data.ref || "EC 00000") + '</strong></div><div class="job-sheet-field"><span>Tel:</span><strong>________________</strong></div></div>' +
      '<div class="job-sheet-rule"></div><div class="job-sheet-section-title">Job description / Report</div><div class="job-sheet-lined job-sheet-report">' + safe(data.description) + '</div>' +
      '<div class="job-sheet-footer-grid"><div class="job-sheet-field"><span>Engineer:</span><strong>' + safe(data.engineer) + '</strong></div><div class="job-sheet-field"><span>Date Started:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field"><span>Date Completed:</span><strong>________________</strong></div></div></article>';
  }

  function renderMtaJobSheet(data) {
    return '<article class="job-card-sheet job-card-sheet-mta" aria-label="MTA job card preview">' +
      '<div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand job-sheet-brand-wide">GMT Electrical Services Ltd.</span></div><div class="job-sheet-number"><span>MTA No.</span><strong>' + safe(data.ref || "MTA 00000") + '</strong></div></div>' +
      '<div class="job-sheet-mta-meta"><div class="job-sheet-field"><span>Date:</span><strong>' + safe(data.date) + '</strong></div><div class="job-sheet-field"><span>Job authorised by:</span><strong>________________</strong></div><div class="job-sheet-field"><span>Tally:</span><strong>________________</strong></div></div>' +
      '<div class="job-sheet-mta-parties"><div class="job-sheet-box"><span>Invoiced to</span><strong>' + safe(data.client) + '</strong></div><div class="job-sheet-box"><span>Dispatched to</span><strong>' + safe(data.site) + '</strong><div class="job-sheet-signature"><small>Signature: __________________</small><small>Date: __________</small></div><small>Print name: ______________________________</small></div></div>' +
      '<div class="job-sheet-equipment"><div>MAKE</div><div>HP / KW</div><div>VOLTS</div><div>RPM</div><div>SERIAL No.</div><strong>' + safe(data.client) + '</strong><span>________</span><span>________</span><span>________</span><span>________________</span></div>' +
      '<div class="job-sheet-section-title">Report</div><div class="job-sheet-mta-report"><div class="job-sheet-lined job-sheet-report">' + safe(data.description) + '</div><div class="job-sheet-checklist"><span>SLOTS __________________</span><span>COILS __________________</span><span>GROUPS ________________</span><span>SPAN __________________</span><span>CONNECTION ____________</span><span>EXTRA __________________</span><span>WINDER _________________</span></div></div>' +
      '<div class="job-sheet-mta-footer"><div class="job-sheet-box"><span>Material / time / operative / price</span><strong>Engineer: ' + safe(data.engineer) + '</strong></div><div class="job-sheet-box"><span>Test report</span><small>2500 volts __________________</small><small>Megger _____________________</small><small>Tested by __________________</small><small>Authorised by ______________</small><small>Date ______________________</small></div></div></article>';
  }

  function renderJobCardPreview(record) {
    var payload = payloadFor(record);
    var data = jobPreviewData(record);
    var selectedType = String(record.card_type || payload.cardType || "EC").toUpperCase() === "MTA" ? "MTA" : "EC";
    preview.innerHTML = '<div class="submission-document-preview"><div class="job-card-preview-heading"><div><p class="portal-card-kicker">' + safe(selectedType) + ' card</p><h3>' + safe(record.is_demo ? "Example job card" : (record.job_ref || record.record_id || "Job card")) + '</h3></div><div class="job-card-preview-toggle" role="group" aria-label="Preview card format"><button type="button" class="secondary' + (selectedType === "EC" ? ' is-selected' : '') + '" data-submission-card-type="EC" aria-pressed="' + String(selectedType === "EC") + '">EC card</button><button type="button" class="secondary' + (selectedType === "MTA" ? ' is-selected' : '') + '" data-submission-card-type="MTA" aria-pressed="' + String(selectedType === "MTA") + '">MTA card</button></div></div><div class="job-card-preview" data-submission-job-sheet>' + (selectedType === "MTA" ? renderMtaJobSheet(data) : renderEcJobSheet(data)) + '</div>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '') + '</div>';
    preview.querySelectorAll("[data-submission-card-type]").forEach(function (button) {
      button.addEventListener("click", function () {
        var type = button.getAttribute("data-submission-card-type") === "MTA" ? "MTA" : "EC";
        preview.querySelectorAll("[data-submission-card-type]").forEach(function (item) { var active = item.getAttribute("data-submission-card-type") === type; item.classList.toggle("is-selected", active); item.setAttribute("aria-pressed", String(active)); });
        var sheet = preview.querySelector("[data-submission-job-sheet]");
        if (sheet) sheet.innerHTML = type === "MTA" ? renderMtaJobSheet(data) : renderEcJobSheet(data);
      });
    });
  }

  function estimatePreviewData(record) {
    var payload = payloadFor(record);
    var items = Array.isArray(record.items) && record.items.length ? record.items : (Array.isArray(payload.items) ? payload.items : []);
    items = items.map(function (item) { return { description: item.description || item.Description || "", quantity: Number(item.quantity ?? item.Quantity) || 0, unit: Number(item.unit ?? item.Unit ?? item.unitPrice) || 0 }; }).filter(function (item) { return item.description; });
    var subtotal = Number(record.subtotal ?? payload.subtotal);
    if (!Number.isFinite(subtotal)) subtotal = items.reduce(function (sum, item) { return sum + item.quantity * item.unit; }, 0);
    var vatRate = Number(record.vat_rate ?? payload.vatRate) || 0;
    var vat = Number(record.vat ?? payload.vat);
    if (!Number.isFinite(vat)) vat = subtotal * vatRate / 100;
    var total = Number(record.total ?? payload.total);
    if (!Number.isFinite(total)) total = subtotal + vat;
    return { number: record.estimate_number || payload.number || payload.estimateNumber || record.record_id || "GMT-EST-DEMO-001", date: record.estimate_date || payload.date || record.record_date || "", attention: record.client_contact || payload.attention || "Client contact", company: record.client_company || payload.company || "Client company", email: record.client_email || payload.email || "", validity: record.validity || payload.validity || "30", preparedBy: record.prepared_by || payload.preparedBy || "GMT Electrical Services Ltd", vatRate: vatRate, reference: record.reference || payload.reference || "Estimate", opening: record.opening || payload.opening || "", terms: record.terms || payload.terms || "", items: items, subtotal: subtotal, vat: vat, total: total };
  }

  function renderEstimatePreview(record) {
    var d = estimatePreviewData(record);
    var rows = d.items.map(function (item) { return '<tr><td>' + safe(item.description) + '</td><td>' + safe(item.quantity) + '</td><td>' + safe(money(item.unit)) + '</td><td>' + safe(money(item.quantity * item.unit)) + '</td></tr>'; }).join("") || '<tr><td colspan="4">No line items added.</td></tr>';
    preview.innerHTML = '<div class="estimate-paper-header"><img class="estimate-paper-logo" src="../image.png" alt="GMT Electrical Services Ltd logo"><div class="estimate-paper-company"><p>Electric Motor Repairs &amp; Rewinds</p><p>Electrical &amp; Mechanical Engineers</p><p>Air Conditioning Repair &amp; Service</p><p>93-95 Gloucester Rd, Croydon CR0 2DN</p><p>Tel 020 8683 0464</p><p>info@gmt-services.co.uk</p></div></div><h1 class="estimate-paper-title">Estimate</h1><div class="estimate-paper-meta"><div><p><strong>For the attention of:</strong> ' + safe(d.attention) + '</p><p><strong>Company:</strong> ' + safe(d.company) + '</p><p><strong>Re:</strong> ' + safe(d.reference) + '</p></div><div><p><strong>Date:</strong> ' + safe(d.date) + '</p><p><strong>Estimate no:</strong> ' + safe(d.number) + '</p></div></div><div class="estimate-paper-body"><p>' + safe(d.opening).replace(/\n/g, '<br>') + '</p><table class="estimate-paper-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table><div class="estimate-paper-total"><p><span>Subtotal</span><strong>' + safe(money(d.subtotal)) + '</strong></p><p><span>VAT (' + safe(d.vatRate) + '%)</span><strong>' + safe(money(d.vat)) + '</strong></p><p class="grand-total"><span>Total</span><strong>' + safe(money(d.total)) + '</strong></p></div></div><p class="estimate-paper-terms">' + safe(d.terms) + '<br><br>Estimate validity: ' + safe(d.validity) + ' days.</p><p>Regards,<br>' + safe(d.preparedBy) + '</p>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '');
  }

  function renderTaskPreview(record) {
    var payload = payloadFor(record);
    var title = record.task_title || payload.title || (record.is_demo ? "Example task" : "Task");
    var job = record.job_reference || payload.jobReference || "No job reference";
    var assignee = record.assignee || payload.assignee || "Unassigned";
    var due = record.due_date || payload.due || record.record_date || "No due date";
    var priority = record.priority || payload.priority || "Normal";
    preview.innerHTML = '<div class="submission-task-preview"><div class="submission-task-preview-header"><img class="submission-task-preview-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><div><p class="portal-card-kicker">GMT task</p><h2>' + safe(title) + '</h2></div><span class="portal-status">' + safe(record.status || "Example only") + '</span></div><div class="submission-task-preview-meta"><p><strong>Job reference:</strong> ' + safe(job) + '</p><p><strong>Assigned to:</strong> ' + safe(assignee) + '</p><p><strong>Due:</strong> ' + safe(due) + '</p><p><strong>Priority:</strong> ' + safe(priority) + '</p></div><div class="submission-task-preview-notes"><strong>Notes</strong><p>' + safe(payload.notes || "Example task for the GMT operational workflow.") + '</p></div>' + (record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '') + '</div>';
  }

  function renderAdminTimesheetSummary(meta) {
    if (!adminTimesheetSummary) return;
    var completion = meta && meta.completion;
    if (!meta || meta.is_admin !== true || !completion) {
      adminTimesheetSummary.hidden = true;
      return;
    }
    adminTimesheetSummary.hidden = false;
    var counts = completion.counts || {};
    if (adminTimesheetStatus) adminTimesheetStatus.textContent = "Pay month " + (completion.pay_month || "current") + " · " + Number(counts.completed || 0) + " completed · " + Number(counts.incomplete || 0) + " incomplete · " + Number(counts.missing || 0) + " missing.";
    var upstream = String(meta.upstream || "not-configured");
    var sourceMessage = upstream === "ok" ? "Microsoft 365 history is included in this Accounts view." : "Microsoft 365 history source status: " + upstream + ".";
    if (adminTimesheetNote) {
      var connectionAction = upstream === "flow-permission-not-configured"
        ? ' <a class="portal-text-link" href="timesheets.html?connect-history=1">Connect Microsoft 365 history access →</a>'
        : "";
      adminTimesheetNote.innerHTML = safe(sourceMessage + (completion.directory_configured ? " The configured employee roster is shown below." : " The employee roster is not configured, so only employees returned by history can be listed.")) + connectionAction;
    }
    var employees = Array.isArray(completion.employees) ? completion.employees : [];
    if (!adminTimesheetTable) return;
    if (!employees.length) {
      adminTimesheetTable.innerHTML = '<tbody><tr><td>No employee rows were returned by the protected history source.</td></tr></tbody>';
      return;
    }
    adminTimesheetTable.innerHTML = '<thead><tr><th>Employee</th><th>Status</th><th>Submitted records</th><th>Source variants</th><th>Missing / needs attention</th></tr></thead><tbody>' + employees.map(function (employee) {
      var statusValue = String(employee.status || "missing");
      var statusLabel = statusValue === "completed" ? "Completed" : statusValue === "incomplete" ? "Incomplete" : "Missing";
      var missingItems = Array.isArray(employee.missing) ? employee.missing.slice() : [];
      if (employee.review_flags) missingItems.push(employee.review_flags + ' daily review flag' + (employee.review_flags === 1 ? '' : 's'));
      var missing = missingItems.length ? missingItems.join("; ") : "None";
      var schedule = employee.schedule_label ? '<br><span class="small-text">Works: ' + safe(employee.schedule_label) + '</span>' : '';
      return '<tr><td data-label="Employee"><strong>' + safe(employee.employee_name || employee.employee_upn || "Unnamed employee") + '</strong><br><span class="small-text">' + safe(employee.employee_upn || "") + '</span>' + schedule + '</td><td data-label="Status"><span class="portal-status ' + safe(statusValue) + '">' + safe(statusLabel) + '</span></td><td data-label="Submitted records">' + safe(employee.submitted_records || 0) + '</td><td data-label="Source variants">' + safe(employee.source_variants || employee.submitted_records || 0) + '</td><td data-label="Missing / needs attention">' + safe(missing) + '</td></tr>';
    }).join("") + '</tbody>';
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
      renderEnquiryPreview(record);
      var nextFeedback = preview.querySelector("[data-enquiry-reply-status]");
      if (nextFeedback) nextFeedback.textContent = "Saved. Accounts can send or continue this thread from the linked inbox conversation.";
    } catch (error) {
      if (feedback) feedback.textContent = error && error.message ? error.message : "The reply could not be saved.";
      form.querySelector("button[type=submit]").disabled = false;
    }
  }
  function renderPreview(record, day) {
    if (!preview) return;
    if (!record) { preview.innerHTML = '<p class="small-text">Select a document to preview it.</p>'; return; }
    if (actionKey(record) === "enquiries") { renderEnquiryPreview(record); return; }
    if (actionKey(record) === "job-cards") { renderJobCardPreview(record); return; }
    if (actionKey(record) === "estimates") { renderEstimatePreview(record); return; }
    if (actionKey(record) === "tasks") { renderTaskPreview(record); return; }
    var label = typeLabel(record);
    var employee = displayName(record);
    var statusValue = record.is_demo ? "Example only" : (record.status || "Submitted");
    var demoDescription = record.is_demo ? '<p class="portal-history-demo">Example preview only. This row is not a submitted GMT record.</p>' : '';
    var sparseDetail = sparseTimesheet(record)
      ? '<p class="portal-history-warning"><strong>Daily detail unavailable:</strong> ' + safe(record.daily_detail_issue || "The Microsoft 365 history response returned the submission header without its daily rows.") + '</p><p class="small-text">Only the submitted header is available here. Clock-in, clock-out, break and total-hour values will appear after the intake/history flow returns the attached daily rows.</p>'
      : '';
    var timesheetAction = actionKey(record) === "timesheets"
      ? '<a class="button button-link" href="' + safe(timesheetHref(record, day)) + '">Open pay-month spreadsheet</a>'
      : '';
    preview.innerHTML = '<div class="timesheet-paper-header"><div><p class="portal-card-kicker">GMT submission</p><h2>' + safe(employee) + '</h2></div><span class="portal-status">' + safe(statusValue) + '</span></div><div class="timesheet-paper-meta"><p><strong>Type:</strong> ' + safe(label) + '</p><p><strong>Period:</strong> ' + safe(period(record)) + '</p><p><strong>Submitted:</strong> ' + safe(record.is_demo ? "Example data" : (record.submitted_at || record.submittedAt || "Not recorded")) + '</p><p><strong>Updated:</strong> ' + safe(record.is_demo ? "Example data" : (record.updated_at || record.updatedAt || record.submitted_at || "Not recorded")) + '</p><p><strong>Source:</strong> ' + safe(record.is_demo ? "GMT demonstration" : (record.source || "Protected GMT portal")) + '</p></div>' + sparseDetail + demoDescription + '<p class="small-text">This view is filtered by the signed-in account privilege. Open the source area for the full document.</p><div class="portal-item-actions">' + timesheetAction + '<a class="button button-link" href="' + destination(record) + '">Open ' + safe(label) + '</a></div>';
  }
  function select(index, day) {
    selected = Number(index);
    var visible = visibleRecords();
    if (list && typeof list.querySelectorAll === "function") list.querySelectorAll("[data-submission-index]").forEach(function (button) { button.setAttribute("aria-current", String(Number(button.getAttribute("data-submission-index")) === selected)); });
    renderPreview(visible[selected], day);
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
    list.innerHTML = '<div class="submission-record-header" role="row"><span role="columnheader">Username</span><span role="columnheader">Type</span><span role="columnheader">Date</span><span role="columnheader">Status</span></div>' + visible.map(function (record, index) {
      var reviewLabel = sparseTimesheet(record) ? " · Review: daily detail unavailable" : "";
      var statusLabel = record.is_demo ? "Example only" : ((record.status || "Submitted") + reviewLabel);
      var name = displayName(record);
      var email = record && (record.employee_upn || record.customer_email) || "";
      var type = typeLabel(record);
      return '<button type="button" role="listitem" class="estimate-history-item submission-record-row' + (record.is_demo ? ' submission-demo-item' : '') + '" data-submission-index="' + index + '" data-record-kind="' + safe(actionKey(record)) + '" aria-current="' + String(index === selected) + '" title="Open ' + safe(name) + ' ' + safe(type) + '"><span class="submission-record-cell submission-record-user"><strong>' + safe(name) + '</strong>' + (email ? '<small>' + safe(email) + '</small>' : '') + '</span><span class="submission-record-cell submission-record-type">' + safe(type) + '</span><span class="submission-record-cell submission-record-date">' + safe(compactDate(record)) + '</span><span class="submission-record-cell submission-record-status">' + safe(statusLabel) + '</span></button>';
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
      populateEmployees([]);
      renderAdminTimesheetSummary(historyMeta);
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
      populateEmployees(realRecords);
      renderAdminTimesheetSummary(historyMeta);
      var scope = body && body.meta && body.meta.visible_scope ? " Access: " + body.meta.visible_scope + "." : "";
      if (status) status.textContent = realRecordCount
        ? "Showing " + realRecordCount + " submitted document" + (realRecordCount === 1 ? "" : "s") + " authorised for your signed-in GMT identity, plus labelled examples." + scope
        : "No submitted documents are currently available for this account. Labelled examples are shown below." + scope;
      var adminNotice = document.getElementById("submissions-admin-timesheet-notice");
      if (adminNotice) {
        var hasTimesheet = realRecords.some(function (record) { return actionKey(record) === "timesheets" || actionKey(record) === "clock"; });
        if (historyMeta.is_admin === true && !hasTimesheet) {
          var upstream = String(historyMeta.upstream || "not-configured");
          var sourceText = upstream === "ok" ? "Microsoft 365 returned no employee timesheet rows for this account." : "The protected Microsoft 365 history source is currently " + upstream + ".";
          var historyHref = upstream === "flow-permission-not-configured" ? "timesheets.html?connect-history=1" : "timesheets.html";
          var historyAction = upstream === "flow-permission-not-configured" ? "Connect Microsoft 365 history access →" : "Open Accounts timesheet history and completion status →";
          adminNotice.hidden = false;
          adminNotice.innerHTML = "Accounts access is enabled. " + safe(sourceText) + " <a class=\"portal-text-link\" href=\"" + historyHref + "\">" + historyAction + "</a>";
        } else {
          adminNotice.hidden = true;
          adminNotice.textContent = "";
        }
      }
      render();
    } catch (error) {
      realRecordCount = 0;
      records = withExamples([]);
      historyMeta = {};
      populateEmployees([]);
      renderAdminTimesheetSummary(historyMeta);
      if (status) status.textContent = error && error.message ? error.message : "Submitted documents could not be loaded. Please try again or contact Accounts.";
      render();
    } finally {
      if (refresh) refresh.disabled = false;
      busy = false;
    }
  }
  if (filter) filter.addEventListener("change", function () { selected = -1; render(); });
  if (employeeFilter) employeeFilter.addEventListener("change", function () { selected = -1; render(); });
  if (refresh) refresh.addEventListener("click", load);
  // Shared calendar labels carry the protected source record ID. Selecting a
  // day therefore opens the same document preview as selecting its history
  // row, including records whose daily data came from a weekly attachment.
  document.addEventListener("gmt:calendar-select", function (event) {
    var detail = event && event.detail || {};
    var recordId = String(detail.recordId || "");
    if (!recordId) return;
    var visible = visibleRecords();
    var index = visible.findIndex(function (record) {
      return String(record && (record.source_record_id || record.record_id || record.id) || "") === recordId;
    });
    if (index < 0) return;
    select(index, detail.date);
    var item = list && list.querySelector('[data-submission-index="' + index + '"]');
    if (item && typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("DOMContentLoaded", load);
}());
