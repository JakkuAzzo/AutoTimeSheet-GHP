(function () {
  "use strict";

  var api = window.GMTPortalApi || {};
  var $ = function (id) { return document.getElementById(id); };
  var invoiceMain = $("xero-invoice-main");
  var accessGate = $("xero-access-gate");
  var chip = $("xero-connection-chip");
  var status = $("xero-status");
  var connections = $("xero-connections");
  var connect = $("xero-connect");
  var refresh = $("xero-refresh");
  var loadButton = $("xero-invoice-load");
  var listStatus = $("xero-invoice-status-message");
  var progress = $("xero-invoice-progress");
  var table = $("xero-invoice-table");
  var invoiceSearch = $("xero-invoice-search");
  var customerFilter = $("xero-invoice-customer");
  var statusFilter = $("xero-invoice-status");
  var fromFilter = $("xero-invoice-from");
  var toFilter = $("xero-invoice-to");
  var editor = $("xero-invoice-editor");
  var editorStatus = $("xero-invoice-editor-status");
  var lines = $("xero-invoice-lines");
  var contactSelect = $("xero-contact");
  var recordSelect = $("xero-invoice-links");
  var recordSearch = $("xero-record-search");
  var recordChips = $("xero-invoice-links-chips");
  var selectedPanel = $("xero-invoice-selected");
  var saveButton = $("xero-create-invoice");
  var sendButton = $("xero-send-invoice");
  var deleteButton = $("xero-delete-invoice");
  var saveLinksButton = $("xero-save-invoice-links");
  var auditPanel = $("xero-invoice-audit");
  var tenantId = "";
  var xeroBody = null;
  var setupData = null;
  var editingInvoiceId = "";
  var lookupsPromise = Promise.resolve();
  var invoiceRows = [];
  var recordRows = [];
  var invoiceCacheKey = function () { return "gmt-xero-invoice-index:" + selectedTenant(); };

  function readInvoiceCache() {
    try { var raw = sessionStorage.getItem(invoiceCacheKey()); var parsed = raw ? JSON.parse(raw) : null; return parsed && Array.isArray(parsed.invoices) ? parsed : null; } catch (_) { return null; }
  }

  function writeInvoiceCache(invoices, tenant) {
    try { sessionStorage.setItem(invoiceCacheKey(), JSON.stringify({ cached_at: new Date().toISOString(), tenant: tenant || "Xero", invoices: invoices })); } catch (_) {}
  }

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
  }

  function consumeXeroReturn() {
    var params = new URLSearchParams(window.location.search);
    var result = params.get("xero");
    if (result !== "connected" && result !== "error") return null;
    var reason = params.get("xero_reason") || "";
    try { window.history.replaceState({}, document.title, window.location.pathname + window.location.hash); } catch (_) {}
    return { result: result, reason: reason };
  }

  function showXeroReturn(result) {
    if (!result) return;
    if (result.result === "connected") {
      if (status) status.textContent = "Xero connected successfully. The invoice register is refreshing.";
      return;
    }
    var messages = {
      "authorisation-denied": "Xero reconnect was not completed because access was declined or cancelled.",
      "invalid-state": "Xero reconnect could not verify the sign-in session. Start reconnect again from this page.",
      "expired-state": "The Xero reconnect session expired. Start reconnect again from this page.",
      "token-exchange": "Xero returned, but did not complete authorisation. Check the Xero app callback URL and try again.",
      "no-tenant": "Xero authorisation completed without returning a GMT organisation.",
      "missing-code": "Xero did not return an authorisation code. Start reconnect again.",
      "not-configured": "Xero is not fully configured on the portal service.",
      "storage-not-configured": "The portal could not store the Xero authorisation. Contact the portal administrator."
    };
    if (status) status.textContent = messages[result.reason] || "Xero reconnect did not complete. Start reconnect again or contact the portal administrator.";
    if (chip) chip.textContent = "Reconnect incomplete";
    if (connect) { connect.hidden = false; connect.style.display = ""; connect.textContent = "Reconnect Xero"; }
  }

  function money(value, currency) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "Not recorded";
    try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(number); } catch (_) { return (currency || "GBP") + " " + number.toFixed(2); }
  }

  function connectionList() { return xeroBody && Array.isArray(xeroBody.connections) ? xeroBody.connections : []; }
  function selectedTenant() {
    var select = connections && connections.querySelector("select");
    return String(select && select.value || tenantId || "");
  }

  function renderConnections() {
    var list = connectionList();
    var reconnectNeeded = list.some(function (item) { return !!item.last_error; });
    if (list.length && !tenantId) tenantId = String(list[0].tenant_id || "");
    if (chip) chip.textContent = reconnectNeeded ? "Reconnect required" : (list.length ? "Connected" : (xeroBody && xeroBody.configured ? "Not connected" : "Not configured"));
    if (connect) {
      connect.hidden = list.length > 0 && !reconnectNeeded;
      connect.style.display = connect.hidden ? "none" : "";
      connect.textContent = reconnectNeeded ? "Reconnect Xero" : "Connect Xero";
    }
    if (status) status.textContent = xeroBody && xeroBody.configured
      ? (reconnectNeeded ? "Xero needs to be reauthorised. Reconnect the Accounts connection to restore invoice access." : (list.length ? "The Accounts Xero connection is ready. Invoices are managed in Xero and linked GMT records are logged here." : "Xero is configured but no organisation is connected yet. Connect once to enable Accounts invoice management."))
      : "Xero is not configured on the portal service yet.";
    if (!connections) return;
    if (!list.length) { connections.innerHTML = '<p class="portal-history-empty">No Xero organisation is connected.</p>'; return; }
    connections.innerHTML = list.length === 1
      ? '<p><strong>' + safe(list[0].tenant_name || "Xero organisation") + '</strong><br><span class="small-text">' + safe(list[0].connected_at || "") + (list[0].last_error ? ' · ' + safe(list[0].last_error) : '') + '</span></p>'
      : '<label>Organisation<select aria-label="Choose Xero organisation">' + list.map(function (item) { return '<option value="' + safe(item.tenant_id) + '"' + (String(item.tenant_id) === tenantId ? ' selected' : '') + '>' + safe(item.tenant_name || item.tenant_id) + '</option>'; }).join("") + '</select></label>';
    var select = connections.querySelector("select");
    if (select) select.addEventListener("change", function () { tenantId = select.value; refreshTenantData(); });
  }

  function filterInvoiceRows(invoices) {
    var query = String(invoiceSearch && invoiceSearch.value || "").trim().toLowerCase();
    var customer = String(customerFilter && customerFilter.value || "");
    var statusValue = String(statusFilter && statusFilter.value || "");
    var from = String(fromFilter && fromFilter.value || "");
    var to = String(toFilter && toFilter.value || "");
    return (Array.isArray(invoices) ? invoices : []).filter(function (invoice) {
      var haystack = [invoice.invoice_number, invoice.contact_name].join(" ").toLowerCase();
      var date = String(invoice.date || "").slice(0, 10);
      return (!query || haystack.indexOf(query) >= 0) && (!customer || String(invoice.contact_name || "") === customer) && (!statusValue || String(invoice.status || "") === statusValue) && (!from || date >= from) && (!to || date <= to);
    });
  }

  function renderCustomerFilter(invoices) {
    if (!customerFilter) return;
    var selected = customerFilter.value;
    var customers = Array.from(new Set((invoices || []).map(function (invoice) { return String(invoice.contact_name || "").trim(); }).filter(Boolean))).sort();
    customerFilter.innerHTML = '<option value="">All customers</option>' + customers.map(function (customer) { return '<option value="' + safe(customer) + '">' + safe(customer) + '</option>'; }).join("");
    customerFilter.value = customers.indexOf(selected) >= 0 ? selected : "";
  }

  function renderInvoices(invoices) {
    if (!table) return;
    invoiceRows = Array.isArray(invoices) ? invoices : [];
    renderCustomerFilter(invoiceRows);
    var body = filterInvoiceRows(invoiceRows).filter(function (invoice) { return !invoice.type || invoice.type === "ACCREC"; });
    table.innerHTML = '<thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Date</th><th>Due</th><th>Total</th><th>Amount due</th><th>Actions</th></tr></thead><tbody>' + (body.length ? body.map(function (invoice) {
      var invoiceNumber = String(invoice.invoice_number || "").trim();
      var reference = invoice.url && invoiceNumber ? '<a href="' + safe(invoice.url) + '" target="_blank" rel="noopener">' + safe(invoiceNumber) + ' ↗</a>' : safe(invoiceNumber || "—");
      var state = safe(invoice.display_status || invoice.status || "Not recorded");
      var manage = '<button type="button" class="secondary xero-invoice-action-button" data-xero-manage="' + safe(invoice.invoice_id) + '">Manage</button>';
      return '<tr data-xero-selected="' + safe(invoice.invoice_id) + '"><td data-label="Invoice"><strong>' + reference + '</strong></td><td data-label="Customer">' + safe(invoice.contact_name || "Not recorded") + '</td><td data-label="Status"><span class="portal-status">' + state + '</span></td><td data-label="Date">' + safe(invoice.date || "Not recorded") + '</td><td data-label="Due">' + safe(invoice.due_date || "Not recorded") + '</td><td data-label="Total">' + safe(money(invoice.total, invoice.currency)) + '</td><td data-label="Amount due">' + safe(money(invoice.amount_due, invoice.currency)) + '</td><td data-label="Actions">' + manage + '</td></tr>';
    }).join("") : '<tr><td colspan="8">No invoices matched this filter.</td></tr>') + '</tbody>';
    table.querySelectorAll("[data-xero-manage]").forEach(function (button) {
      button.addEventListener("click", function () { openInvoice(button.getAttribute("data-xero-manage")); });
    });
  }

  function renderRecordChips() {
    if (!recordChips) return;
    var selected = selectedRecordIds();
    recordChips.innerHTML = selected.map(function (id) {
      var option = recordSelect && recordSelect.querySelector('option[value="' + CSS.escape(id) + '"]');
      return '<span class="xero-invoice-link-chip">' + safe(option ? option.textContent : id) + '</span>';
    }).join("") || '<span class="small-text">No estimates or job cards linked yet.</span>';
  }

  function filterRecordRows() {
    var query = String(recordSearch && recordSearch.value || "").trim().toLowerCase();
    if (!recordSelect) return;
    Array.prototype.forEach.call(recordSelect.options, function (option) { option.hidden = Boolean(query && option.textContent.toLowerCase().indexOf(query) < 0); });
  }

  function renderRelatedRecords(links, detail) {
    var records = Array.isArray(links) ? links : [];
    var estimates = Array.isArray(detail && detail.related_estimates) ? detail.related_estimates : [];
    var jobCards = Array.isArray(detail && detail.related_job_cards) ? detail.related_job_cards : [];
    var emailThreads = Array.isArray(detail && detail.email_threads) ? detail.email_threads : [];
    if (!records.length && !estimates.length && !jobCards.length && !emailThreads.length) return '<strong>Related GMT records</strong><p class="small-text">No estimate, job card, or estimate email is linked to this invoice yet.</p>';
    var cards = records.map(function (link) {
      var kind = link.record_kind === "estimates" ? "Estimate" : "Job card";
      var title = link.record_title || link.record_id || kind;
      var context = [link.customer, link.record_date, link.record_status].filter(Boolean).join(" · ");
      var email = link.email_url ? ' <a href="' + safe(link.email_url) + '" target="_blank" rel="noopener">Open job email ↗</a>' : '';
      return '<li><strong>' + safe(kind) + ' · ' + safe(title) + '</strong>' + (context ? '<span class="small-text">' + safe(context) + '</span>' : '') + '<span class="small-text"><a href="' + safe(link.history_url || '#') + '">Open record in GMT ↗</a>' + email + '</span></li>';
    }).join("");
    var estimateCards = estimates.map(function (item) { return '<li><strong>Estimate · ' + safe(item.estimate_number || item.canonical_id) + '</strong><span class="small-text">' + safe([item.client, item.estimate_date, item.reference, item.correlation_rule].filter(Boolean).join(' · ')) + '</span><span class="small-text">' + (item.history_url ? '<a href="' + safe(item.history_url) + '">Open estimate in GMT ↗</a>' : '') + (item.outlook_url ? ' · <a href="' + safe(item.outlook_url) + '" target="_blank" rel="noopener">Open estimate email ↗</a>' : '') + '</span></li>'; }).join('');
    var jobCardCards = jobCards.map(function (item) { return '<li><strong>Job card · ' + safe(item.record_id) + '</strong><span class="small-text"><a href="' + safe(item.history_url || '#') + '">Open job card in GMT ↗</a></span></li>'; }).join('');
    var emails = emailThreads.map(function (item) { return '<li><strong>Estimate email · ' + safe(item.subject || item.canonical_id) + '</strong><span class="small-text">' + safe(item.match_status || 'related') + (item.outlook_url ? ' · <a href="' + safe(item.outlook_url) + '" target="_blank" rel="noopener">Open in Outlook ↗</a>' : '') + '</span></li>'; }).join('');
    return '<strong>Related GMT records</strong><p class="small-text">These records may share the same work even when Xero invoice numbers change or more than one invoice is used.</p><ul class="xero-related-record-list">' + cards + estimateCards + jobCardCards + emails + '</ul>';
  }

  async function loadInvoices() {
    if (!loadButton || !api.xeroInvoices) return;
    var list = connectionList();
    if (!list.length) { renderInvoices([]); if (listStatus) listStatus.textContent = "Connect Xero to load the invoice register."; return; }
    tenantId = selectedTenant() || tenantId || String(list[0].tenant_id || "");
    loadButton.disabled = true;
    var cached = readInvoiceCache();
    if (cached) {
      invoiceRows = cached.invoices;
      renderInvoices(invoiceRows);
      if (listStatus) listStatus.textContent = cached.invoices.length + " cached invoice" + (cached.invoices.length === 1 ? "" : "s") + " shown · refreshing from Xero…";
    }
    if (progress) { progress.hidden = false; progress.removeAttribute("value"); }
    if (listStatus) listStatus.textContent = "Loading all invoices from Xero…";
    try {
      var all = [], page = 1, batch = [];
      do {
        var result = await api.xeroInvoices(tenantId, 100, page, "");
        batch = result && Array.isArray(result.invoices) ? result.invoices : [];
        all = all.concat(batch);
        invoiceRows = all;
        renderInvoices(all);
        if (progress) progress.value = page;
        if (listStatus) listStatus.textContent = all.length + " invoice" + (all.length === 1 ? "" : "s") + " loaded…";
        page += 1;
      } while (batch.length === 100 && page <= 1000);
      if (progress) { progress.hidden = true; progress.removeAttribute("value"); }
      writeInvoiceCache(all, result && result.tenant && result.tenant.tenant_name || "Xero");
      if (listStatus) listStatus.textContent = all.length + " invoice" + (all.length === 1 ? "" : "s") + " loaded from " + safe(result && result.tenant && result.tenant.tenant_name || "Xero") + ".";
    } catch (error) {
      // Keep the pages already received visible. Xero can throttle a long
      // all-time walk, and clearing the register makes a recoverable partial
      // result look like a portal failure.
      renderInvoices(invoiceRows);
      if (invoiceRows.length) {
        writeInvoiceCache(invoiceRows, "Xero");
        if (listStatus) listStatus.textContent = invoiceRows.length + " invoices loaded; more could not be fetched right now. Try Refresh to continue.";
      } else if (listStatus) {
        listStatus.textContent = error && error.message ? error.message : "The Xero invoice register could not be loaded.";
      }
      if (progress) progress.hidden = true;
    } finally { loadButton.disabled = false; }
  }

  async function refreshTenantData() {
    lookupsPromise = loadLookups();
    await lookupsPromise;
    await loadInvoices();
  }

  function accountOptions(selected) {
    var accounts = setupData && Array.isArray(setupData.accounts) ? setupData.accounts : [];
    return '<option value="">Choose account</option>' + accounts.map(function (account) { return '<option value="' + safe(account.code) + '"' + (account.code === selected ? ' selected' : '') + '>' + safe(account.code + " · " + account.name) + '</option>'; }).join("");
  }

  function taxOptions(selected) {
    var rates = setupData && Array.isArray(setupData.tax_rates) ? setupData.tax_rates : [];
    return '<option value="">Choose tax</option>' + rates.map(function (rate) { return '<option value="' + safe(rate.type) + '"' + (rate.type === selected ? ' selected' : '') + '>' + safe(rate.name + " · " + rate.rate + "%") + '</option>'; }).join("");
  }

  function addLine(line) {
    if (!lines) return;
    var item = line || {};
    var row = document.createElement("div");
    row.className = "xero-invoice-line";
    row.innerHTML = '<label>Description<input data-line="description" required maxlength="4000" value="' + safe(item.description || "") + '"></label>' +
      '<label>Quantity<input data-line="quantity" type="number" min="0.01" step="0.01" required value="' + safe(item.quantity || 1) + '"></label>' +
      '<label>Unit price<input data-line="unit" type="number" min="0" step="0.01" required value="' + safe(item.unit_amount == null ? "" : item.unit_amount) + '"></label>' +
      '<label>Account<select data-line="account" required>' + accountOptions(item.account_code || "") + '</select></label>' +
      '<label>Tax<select data-line="tax" required>' + taxOptions(item.tax_type || "") + '</select></label>' +
      '<button type="button" class="secondary" data-remove-line>Remove</button>';
    row.querySelector("[data-remove-line]").addEventListener("click", function () { if (lines.children.length > 1) row.remove(); });
    lines.appendChild(row);
    renderInvoicePreview();
  }

  function renderInvoicePreview() {
    var preview = $("xero-invoice-preview");
    if (!preview) return;
    var number = String($("xero-number") && $("xero-number").value || "").trim() || "New invoice";
    var customer = contactSelect && contactSelect.selectedOptions[0] ? contactSelect.selectedOptions[0].textContent : "Choose a customer";
    var rows = lines ? Array.prototype.slice.call(lines.querySelectorAll(".xero-invoice-line")).map(function (row) {
      var description = row.querySelector('[data-line="description"]')?.value.trim() || "Invoice item";
      var quantity = Number(row.querySelector('[data-line="quantity"]')?.value || 0);
      var unit = Number(row.querySelector('[data-line="unit"]')?.value || 0);
      return { description: description, quantity: quantity, total: quantity * unit };
    }) : [];
    var total = rows.reduce(function (sum, row) { return sum + row.total; }, 0);
    $("xero-preview-number").textContent = number;
    $("xero-preview-customer").textContent = customer;
    $("xero-preview-lines").innerHTML = rows.length ? rows.map(function (row) { return '<div class="xero-preview-line"><span>' + safe(row.description) + ' × ' + safe(row.quantity) + '</span><strong>' + safe(money(row.total, "GBP")) + '</strong></div>'; }).join("") : '<p class="small-text">Add an invoice line to preview it here.</p>';
    $("xero-preview-total").textContent = money(total, "GBP");
  }

  function selectedRecordIds() {
    return recordSelect ? Array.prototype.slice.call(recordSelect.selectedOptions).map(function (option) { return option.value; }).filter(Boolean) : [];
  }

  function invoiceInput() {
    return {
      contactId: contactSelect && contactSelect.value,
      invoiceNumber: $("xero-number") && $("xero-number").value.trim(),
      date: $("xero-date") && $("xero-date").value,
      dueDate: $("xero-due-date") && $("xero-due-date").value,
      reference: $("xero-reference") && $("xero-reference").value.trim(),
      lineAmountTypes: $("xero-line-amount-types") && $("xero-line-amount-types").value,
      lineItems: lines ? Array.prototype.slice.call(lines.querySelectorAll(".xero-invoice-line")).map(function (row) {
        return { description: row.querySelector('[data-line="description"]').value.trim(), quantity: Number(row.querySelector('[data-line="quantity"]').value), unitAmount: Number(row.querySelector('[data-line="unit"]').value), accountCode: row.querySelector('[data-line="account"]').value, taxType: row.querySelector('[data-line="tax"]').value };
      }) : []
    };
  }

  async function loadLookups() {
    if (!api.xeroSetupData || !api.xeroRecords) return;
    try {
      var results = await Promise.allSettled([api.xeroSetupData(selectedTenant()), api.xeroRecords()]);
      var errors = [];
      if (results[0].status === "fulfilled") {
        setupData = results[0].value || {};
        var contacts = setupData.contacts || [];
        if (contactSelect) contactSelect.innerHTML = '<option value="">Choose a customer</option>' + contacts.map(function (contact) { return '<option value="' + safe(contact.id) + '">' + safe(contact.name + (contact.email ? " · " + contact.email : "")) + '</option>'; }).join("");
      } else {
        errors.push(results[0].reason && results[0].reason.message || "Xero customers could not be loaded");
        if (contactSelect) contactSelect.innerHTML = '<option value="">Xero customers unavailable — use Refresh</option>';
      }
      if (results[1].status === "fulfilled") {
        var records = results[1].value && results[1].value.records || [];
        recordRows = records;
        if (recordSelect) recordSelect.innerHTML = records.map(function (record) { return '<option value="' + safe(record.record_id) + '">' + safe((record.kind === "estimates" ? "Estimate" : "Job card") + " · " + record.title + (record.customer ? " · " + record.customer : "") + (record.total == null ? "" : " · " + money(record.total, "GBP"))) + '</option>'; }).join("") || '<option value="">No active estimates or job cards</option>';
      } else {
        errors.push(results[1].reason && results[1].reason.message || "GMT records could not be loaded");
        if (recordSelect) recordSelect.innerHTML = '<option value="">GMT records unavailable — use Refresh</option>';
      }
      filterRecordRows();
      renderRecordChips();
      if (editingInvoiceId && lines) {
        lines.querySelectorAll(".xero-invoice-line").forEach(function (row) {
          var account = row.querySelector('[data-line="account"]'); var tax = row.querySelector('[data-line="tax"]');
          if (account) { var accountValue = account.value; account.innerHTML = accountOptions(accountValue); }
          if (tax) { var taxValue = tax.value; tax.innerHTML = taxOptions(taxValue); }
        });
      }
      if (errors.length && editorStatus) editorStatus.textContent = errors.join(" · ") + ". Use Refresh to retry without losing your invoice edits.";
    } catch (error) {
      if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Customers and GMT records could not be loaded.";
    }
  }

  function setEditorEditable(editable) {
    if (!editor) return;
    editor.querySelectorAll("input,select,#xero-add-invoice-line").forEach(function (field) { field.disabled = !editable; });
    if (recordSelect) recordSelect.disabled = false;
    if (saveButton) saveButton.hidden = !editable;
  }

  function resetEditor() {
    editingInvoiceId = "";
    if (editor) editor.reset();
    if (lines) lines.innerHTML = "";
    addLine();
    if ($("xero-date")) $("xero-date").value = new Date().toISOString().slice(0, 10);
    if (saveButton) { saveButton.textContent = "Save draft invoice"; saveButton.hidden = false; }
    if (sendButton) sendButton.hidden = true;
    if (deleteButton) deleteButton.hidden = true;
    if (saveLinksButton) saveLinksButton.hidden = true;
    if (auditPanel) { auditPanel.hidden = true; auditPanel.innerHTML = ""; }
    setEditorEditable(true);
    if (editorStatus) editorStatus.textContent = "Choose a customer and add at least one line. New invoices are saved as drafts in Xero.";
  }

  async function openInvoice(invoiceId) {
    if (!api.xeroInvoice) return;
    if (editorStatus) editorStatus.textContent = "Loading invoice from Xero…";
    try {
      await lookupsPromise;
      var result = await api.xeroInvoice(invoiceId, selectedTenant());
      var detail = result || {};
      var invoice = detail.invoice || {};
      editingInvoiceId = invoiceId;
      if (selectedPanel) { selectedPanel.hidden = false; selectedPanel.innerHTML = '<strong>Selected invoice</strong><p>' + safe(invoice.invoice_number || "—") + ' · ' + safe(invoice.display_status || invoice.status || "Not recorded") + ' · ' + safe(money(invoice.total, invoice.currency)) + '</p>'; }
      table.querySelectorAll("[data-xero-selected]").forEach(function (row) { row.classList.toggle("is-selected", row.getAttribute("data-xero-selected") === invoiceId); });
      if (contactSelect) contactSelect.value = detail.contact_id || "";
      $("xero-number").value = invoice.invoice_number || "";
      $("xero-date").value = (invoice.date || "").slice(0, 10);
      $("xero-due-date").value = (invoice.due_date || "").slice(0, 10);
      $("xero-reference").value = detail.reference || "";
      $("xero-line-amount-types").value = detail.line_amount_types || "Exclusive";
      if (lines) lines.innerHTML = "";
      (detail.line_items || []).forEach(addLine);
      if (!detail.line_items || !detail.line_items.length) addLine();
      if (recordSelect) Array.prototype.forEach.call(recordSelect.options, function (option) { option.selected = (detail.links || []).some(function (link) { return link.record_id === option.value; }); });
      renderRecordChips();
      setEditorEditable(!!detail.policy?.canEdit);
      if (saveLinksButton) saveLinksButton.hidden = false;
      if (auditPanel) {
        var auditSummary = (detail.audit || []).map(function (item) { return safe(item.occurred_at) + " · " + safe(item.action) + " · " + safe(item.actor_upn) + (item.before_status || item.after_status ? " · " + safe(item.before_status) + " → " + safe(item.after_status) : ""); }).join("<br>") || "No GMT invoice actions recorded yet.";
        auditPanel.hidden = false;
        auditPanel.innerHTML = renderRelatedRecords(detail.links, detail) + "<strong>Recent GMT actions</strong><p>" + auditSummary + "</p>";
      }
      if (saveButton) saveButton.textContent = "Save invoice changes";
      if (sendButton) { sendButton.hidden = !detail.policy?.canSend; sendButton.textContent = invoice.status === "AUTHORISED" ? "Send invoice" : "Approve and send"; }
      if (deleteButton) { deleteButton.hidden = !detail.policy?.canDelete; deleteButton.textContent = detail.policy?.deleteAction === "void" ? "Void unpaid invoice" : "Delete draft"; }
      if (editorStatus) editorStatus.textContent = "Editing " + (invoice.invoice_number || invoice.invoice_id) + " · " + (invoice.display_status || invoice.status) + ". Xero remains the financial source of truth.";
      renderInvoicePreview();
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) { if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Invoice could not be loaded."; }
  }

  async function loadStatus() {
    if (!api.xeroStatus) {
      if (accessGate) accessGate.textContent = "The protected Xero service is unavailable. Invoices are restricted to authenticated Accounts administrators.";
      return;
    }
    try {
      xeroBody = await api.xeroStatus();
      if (invoiceMain) { invoiceMain.hidden = false; invoiceMain.removeAttribute("aria-hidden"); }
      if (accessGate) accessGate.hidden = true;
      renderConnections();
      await refreshTenantData();
    } catch (error) {
      if (invoiceMain) { invoiceMain.hidden = true; invoiceMain.setAttribute("aria-hidden", "true"); }
      if (accessGate) accessGate.textContent = error && error.status === 403
        ? "This page is restricted to authenticated Accounts administrators."
        : "Accounts access could not be verified. " + (error && error.message ? error.message : "Xero status could not be loaded.");
      if (chip) chip.textContent = error && error.status === 403 ? "Accounts only" : "Unavailable";
      if (connect) connect.disabled = true;
      if (loadButton) loadButton.disabled = true;
      if (saveButton) saveButton.disabled = true;
    }
  }

  if (connect) connect.addEventListener("click", async function () {
    connect.disabled = true;
    if (status) status.textContent = "Opening Xero authorisation…";
    try { var result = await api.xeroConnect(); if (result && result.authorization_url) window.location.assign(result.authorization_url); else if (status) status.textContent = "Xero authorisation URL was not returned."; }
    catch (error) { if (status) status.textContent = error && error.message ? error.message : "Xero could not be connected."; connect.disabled = false; }
  });
  if (refresh) refresh.addEventListener("click", function () { try { sessionStorage.removeItem(invoiceCacheKey()); } catch (_) {} loadStatus(); });
  if (loadButton) loadButton.addEventListener("click", loadInvoices);
  if (statusFilter) statusFilter.addEventListener("change", function () { renderInvoices(invoiceRows); });
  if (invoiceSearch) invoiceSearch.addEventListener("input", function () { renderInvoices(invoiceRows); });
  if (customerFilter) customerFilter.addEventListener("change", function () { renderInvoices(invoiceRows); });
  if (fromFilter) fromFilter.addEventListener("change", function () { renderInvoices(invoiceRows); });
  if (toFilter) toFilter.addEventListener("change", function () { renderInvoices(invoiceRows); });
  if (recordSearch) recordSearch.addEventListener("input", filterRecordRows);
  if (recordSelect) recordSelect.addEventListener("change", renderRecordChips);
  if (editor) editor.addEventListener("input", renderInvoicePreview);
  if (editor) editor.addEventListener("change", renderInvoicePreview);
  if ($("xero-add-invoice-line")) $("xero-add-invoice-line").addEventListener("click", function () { addLine(); });
  if ($("xero-invoice-reset")) $("xero-invoice-reset").addEventListener("click", resetEditor);

  if (editor) editor.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!editor.reportValidity()) return;
    saveButton.disabled = true;
    if (editorStatus) editorStatus.textContent = editingInvoiceId ? "Saving invoice changes to Xero…" : "Creating draft invoice in Xero…";
    var requestBody = { tenantId: selectedTenant(), invoice: invoiceInput(), recordIds: selectedRecordIds() };
    try {
      var result = editingInvoiceId ? await api.xeroUpdateInvoice(editingInvoiceId, requestBody) : await api.xeroCreateInvoice(requestBody);
      editingInvoiceId = result && result.invoice ? result.invoice.invoice_id : editingInvoiceId;
      if (editorStatus) editorStatus.textContent = "Draft saved in Xero. The GMT audit trail has been updated.";
      await loadInvoices();
      if (editingInvoiceId) await openInvoice(editingInvoiceId);
    } catch (error) { if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Invoice could not be saved to Xero."; }
    finally { if (saveButton) saveButton.disabled = false; }
  });

  if (sendButton) sendButton.addEventListener("click", async function () {
    if (!editingInvoiceId || !window.confirm("Approve this draft invoice if needed and send it to the customer using Xero?")) return;
    sendButton.disabled = true;
    if (editorStatus) editorStatus.textContent = "Approving and sending through Xero…";
    try { await api.xeroSendInvoice(editingInvoiceId, selectedTenant()); if (editorStatus) editorStatus.textContent = "Invoice sent through Xero."; await loadInvoices(); await openInvoice(editingInvoiceId); }
    catch (error) { if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Invoice was not sent."; }
    finally { sendButton.disabled = false; }
  });

  if (saveLinksButton) saveLinksButton.addEventListener("click", async function () {
    if (!editingInvoiceId || !api.xeroLinkInvoice) return;
    saveLinksButton.disabled = true;
    if (editorStatus) editorStatus.textContent = "Saving estimate and job card links…";
    try { await api.xeroLinkInvoice(editingInvoiceId, selectedRecordIds(), selectedTenant()); if (editorStatus) editorStatus.textContent = "Linked GMT records saved."; await openInvoice(editingInvoiceId); }
    catch (error) { if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Linked records could not be saved."; }
    finally { saveLinksButton.disabled = false; }
  });

  if (deleteButton) deleteButton.addEventListener("click", async function () {
    if (!editingInvoiceId || !window.confirm("Delete this draft invoice in Xero? Authorised invoices are voided instead. Paid or part-paid invoices are protected.")) return;
    deleteButton.disabled = true;
    if (editorStatus) editorStatus.textContent = "Updating invoice in Xero…";
    try { await api.xeroDeleteInvoice(editingInvoiceId, selectedTenant()); if (editorStatus) editorStatus.textContent = "Invoice removal recorded in Xero and GMT."; resetEditor(); await loadInvoices(); }
    catch (error) { if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Invoice could not be removed."; }
    finally { deleteButton.disabled = false; }
  });



  var xeroReturn = consumeXeroReturn();
  resetEditor();
  loadStatus().then(function () { showXeroReturn(xeroReturn); });
}());
