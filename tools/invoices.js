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
  var table = $("xero-invoice-table");
  var invoiceSearch = $("xero-invoice-search");
  var customerFilter = $("xero-invoice-customer");
  var statusFilter = $("xero-invoice-status");
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

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character];
    });
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
    if (list.length && !tenantId) tenantId = String(list[0].tenant_id || "");
    if (chip) chip.textContent = list.length ? "Connected" : (xeroBody && xeroBody.configured ? "Not connected" : "Not configured");
    if (connect) connect.hidden = list.length > 0;
    if (status) status.textContent = xeroBody && xeroBody.configured
      ? (list.length ? "The Accounts Xero connection is ready. Invoices are managed in Xero and linked GMT records are logged here." : "Xero is configured but no organisation is connected yet. Connect once to enable Accounts invoice management.")
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
    return (Array.isArray(invoices) ? invoices : []).filter(function (invoice) {
      var haystack = [invoice.invoice_number, invoice.contact_name].join(" ").toLowerCase();
      return (!query || haystack.indexOf(query) >= 0) && (!customer || String(invoice.contact_name || "") === customer) && (!statusValue || String(invoice.status || "") === statusValue);
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

  async function loadInvoices() {
    if (!loadButton || !api.xeroInvoices) return;
    var list = connectionList();
    if (!list.length) { renderInvoices([]); if (listStatus) listStatus.textContent = "Connect Xero to load the invoice register."; return; }
    tenantId = selectedTenant() || tenantId || String(list[0].tenant_id || "");
    loadButton.disabled = true;
    if (listStatus) listStatus.textContent = "Loading invoices from Xero…";
    try {
      var result = await api.xeroInvoices(tenantId, 100, 1, "");
      renderInvoices(result && result.invoices || []);
      if (listStatus) listStatus.textContent = (result && result.invoices ? result.invoices.length : 0) + " invoice" + ((result && result.invoices && result.invoices.length === 1) ? "" : "s") + " loaded from " + safe(result && result.tenant && result.tenant.tenant_name || "Xero") + ".";
    } catch (error) {
      renderInvoices([]); if (listStatus) listStatus.textContent = error && error.message ? error.message : "The Xero invoice register could not be loaded.";
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
      var results = await Promise.all([api.xeroSetupData(selectedTenant()), api.xeroRecords()]);
      setupData = results[0];
      var contacts = setupData.contacts || [];
      if (contactSelect) contactSelect.innerHTML = '<option value="">Choose a customer</option>' + contacts.map(function (contact) { return '<option value="' + safe(contact.id) + '">' + safe(contact.name + (contact.email ? " · " + contact.email : "")) + '</option>'; }).join("");
      var records = results[1].records || [];
      recordRows = records;
      if (recordSelect) recordSelect.innerHTML = records.map(function (record) { return '<option value="' + safe(record.record_id) + '">' + safe((record.kind === "estimates" ? "Estimate" : "Job card") + " · " + record.title + (record.customer ? " · " + record.customer : "") + (record.total == null ? "" : " · " + money(record.total, "GBP"))) + '</option>'; }).join("") || '<option value="">No active estimates or job cards</option>';
      filterRecordRows();
      renderRecordChips();
      if (editingInvoiceId && lines) {
        lines.querySelectorAll(".xero-invoice-line").forEach(function (row) {
          var account = row.querySelector('[data-line="account"]'); var tax = row.querySelector('[data-line="tax"]');
          if (account) { var accountValue = account.value; account.innerHTML = accountOptions(accountValue); }
          if (tax) { var taxValue = tax.value; tax.innerHTML = taxOptions(taxValue); }
        });
      }
    } catch (error) {
      if (editorStatus) editorStatus.textContent = error && error.message ? error.message : "Customers and GMT records could not be loaded from Xero.";
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
        var linkSummary = (detail.links || []).map(function (link) { return safe(link.record_kind === "estimates" ? "Estimate" : "Job card") + " · " + safe(link.record_id); }).join("<br>") || "No GMT estimate or job card linked.";
        var auditSummary = (detail.audit || []).map(function (item) { return safe(item.occurred_at) + " · " + safe(item.action) + " · " + safe(item.actor_upn) + (item.before_status || item.after_status ? " · " + safe(item.before_status) + " → " + safe(item.after_status) : ""); }).join("<br>") || "No GMT invoice actions recorded yet.";
        auditPanel.hidden = false;
        auditPanel.innerHTML = "<strong>Linked records</strong><p>" + linkSummary + "</p><strong>Recent GMT actions</strong><p>" + auditSummary + "</p>";
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
  if (refresh) refresh.addEventListener("click", loadStatus);
  if (loadButton) loadButton.addEventListener("click", loadInvoices);
  if (statusFilter) statusFilter.addEventListener("change", loadInvoices);
  if (invoiceSearch) invoiceSearch.addEventListener("input", function () { renderInvoices(invoiceRows); });
  if (customerFilter) customerFilter.addEventListener("change", function () { renderInvoices(invoiceRows); });
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



  resetEditor();
  loadStatus();
}());
