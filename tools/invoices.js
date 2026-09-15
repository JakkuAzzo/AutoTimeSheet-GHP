(function () {
  "use strict";

  var api = window.GMTPortalApi || {};
  var card = document.getElementById("xero-invoices-card");
  var chip = document.getElementById("xero-connection-chip");
  var status = document.getElementById("xero-status");
  var connections = document.getElementById("xero-connections");
  var connect = document.getElementById("xero-connect");
  var refresh = document.getElementById("xero-refresh");
  var loadButton = document.getElementById("xero-invoice-load");
  var listStatus = document.getElementById("xero-invoice-status-message");
  var table = document.getElementById("xero-invoice-table");
  var lookupForm = document.getElementById("xero-invoice-lookup");
  var lookupStatus = document.getElementById("xero-invoice-lookup-status");
  var lookupResult = document.getElementById("xero-invoice-result");
  var statusFilter = document.getElementById("xero-invoice-status");
  var tenantId = "";
  var xeroBody = null;

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

  function connectionList() {
    return xeroBody && Array.isArray(xeroBody.connections) ? xeroBody.connections : [];
  }

  function selectedTenant() {
    var select = connections && connections.querySelector("select");
    return String(select && select.value || tenantId || "");
  }

  function renderConnections() {
    var list = connectionList();
    if (list.length && !tenantId) tenantId = String(list[0].tenant_id || "");
    if (chip) chip.textContent = list.length ? "Connected · " + (list.length === 1 ? String(list[0].tenant_name || "Xero organisation") : list.length + " organisations") : (xeroBody && xeroBody.configured ? "Not connected" : "Not configured");
    if (status) status.textContent = xeroBody && xeroBody.configured
      ? (list.length ? "The Accounts Xero connection is ready. It is retained by the portal service and refreshed when needed." : "Xero is configured but no organisation is connected yet. Connect once to make the Accounts register available.")
      : "Xero is not configured on the portal service yet.";
    if (!connections) return;
    if (!list.length) {
      connections.innerHTML = '<p class="portal-history-empty">No Xero organisation is connected.</p>';
      return;
    }
    connections.innerHTML = list.length === 1
      ? '<p><strong>' + safe(list[0].tenant_name || "Xero organisation") + '</strong><br><span class="small-text">Connected ' + safe(list[0].connected_at || "") + (list[0].last_error ? ' · ' + safe(list[0].last_error) : '') + '</span></p>'
      : '<label>Organisation<select aria-label="Choose Xero organisation">' + list.map(function (item) { return '<option value="' + safe(item.tenant_id) + '"' + (String(item.tenant_id) === tenantId ? ' selected' : '') + '>' + safe(item.tenant_name || item.tenant_id) + '</option>'; }).join("") + '</select></label>';
    var select = connections.querySelector("select");
    if (select) select.addEventListener("change", function () { tenantId = select.value; loadInvoices(); });
  }

  function renderInvoices(invoices) {
    if (!table) return;
    var body = Array.isArray(invoices) ? invoices : [];
    table.innerHTML = '<thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Date</th><th>Due</th><th>Total</th><th>Amount due</th></tr></thead><tbody>' + (body.length ? body.map(function (invoice) {
      var reference = invoice.url ? '<a href="' + safe(invoice.url) + '" target="_blank" rel="noopener">' + safe(invoice.invoice_number || invoice.invoice_id || "View invoice") + ' ↗</a>' : safe(invoice.invoice_number || invoice.invoice_id || "Not numbered");
      return '<tr><td data-label="Invoice"><strong>' + reference + '</strong></td><td data-label="Customer">' + safe(invoice.contact_name || "Not recorded") + '</td><td data-label="Status"><span class="portal-status">' + safe(invoice.status || "Not recorded") + '</span></td><td data-label="Date">' + safe(invoice.date || "Not recorded") + '</td><td data-label="Due">' + safe(invoice.due_date || "Not recorded") + '</td><td data-label="Total">' + safe(money(invoice.total, invoice.currency)) + '</td><td data-label="Amount due">' + safe(money(invoice.amount_due, invoice.currency)) + '</td></tr>';
    }).join("") : '<tr><td colspan="7">No invoices matched this filter.</td></tr>') + '</tbody>';
  }

  async function loadInvoices() {
    if (!loadButton || !api.xeroInvoices) return;
    var list = connectionList();
    if (!list.length) {
      renderInvoices([]);
      if (listStatus) listStatus.textContent = "Connect Xero to load the invoice register.";
      return;
    }
    tenantId = selectedTenant() || tenantId || String(list[0].tenant_id || "");
    loadButton.disabled = true;
    if (listStatus) listStatus.textContent = "Loading invoices from Xero…";
    try {
      var result = await api.xeroInvoices(tenantId, 100, 1, statusFilter && statusFilter.value || "");
      renderInvoices(result && result.invoices || []);
      if (listStatus) listStatus.textContent = (result && result.invoices ? result.invoices.length : 0) + " invoice" + ((result && result.invoices && result.invoices.length === 1) ? "" : "s") + " loaded from " + safe(result && result.tenant && result.tenant.tenant_name || "Xero") + ".";
    } catch (error) {
      renderInvoices([]);
      if (listStatus) listStatus.textContent = error && error.message ? error.message : "The Xero invoice register could not be loaded.";
    } finally { loadButton.disabled = false; }
  }

  function renderLookup(invoice) {
    if (!lookupResult) return;
    if (!invoice) { lookupResult.hidden = true; lookupResult.innerHTML = ""; return; }
    lookupResult.hidden = false;
    lookupResult.innerHTML = '<div class="timesheet-paper-meta"><p><strong>Invoice:</strong> ' + safe(invoice.invoice_number || invoice.invoice_id || "Not numbered") + '</p><p><strong>Customer:</strong> ' + safe(invoice.contact_name || "Not recorded") + '</p><p><strong>Status:</strong> ' + safe(invoice.status || "Not recorded") + '</p><p><strong>Date:</strong> ' + safe(invoice.date || "Not recorded") + '</p><p><strong>Due:</strong> ' + safe(invoice.due_date || "Not recorded") + '</p><p><strong>Total:</strong> ' + safe(money(invoice.total, invoice.currency)) + '</p><p><strong>Amount due:</strong> ' + safe(money(invoice.amount_due, invoice.currency)) + '</p></div>' + (invoice.url ? '<p><a class="portal-text-link" href="' + safe(invoice.url) + '" target="_blank" rel="noopener">Open this invoice in Xero ↗</a></p>' : "");
  }

  async function loadStatus() {
    if (!api.xeroStatus) return;
    try {
      xeroBody = await api.xeroStatus();
      if (card) { card.hidden = false; card.setAttribute("aria-hidden", "false"); }
      renderConnections();
      await loadInvoices();
    } catch (error) {
      // A 403 is the deliberate Accounts-only boundary. Keep the Tools card
      // hidden for every other signed-in account and explain direct-page access
      // without exposing connection details.
      if (card) { card.hidden = true; card.setAttribute("aria-hidden", "true"); }
      if (status) status.textContent = error && error.status === 403 ? "This page is restricted to the Accounts administrator." : (error && error.message ? error.message : "Xero status could not be loaded.");
      if (chip) chip.textContent = error && error.status === 403 ? "Accounts only" : "Unavailable";
      if (connect) connect.disabled = true;
      if (loadButton) loadButton.disabled = true;
    }
  }

  if (connect) connect.addEventListener("click", async function () {
    connect.disabled = true;
    if (status) status.textContent = "Opening Xero authorisation…";
    try {
      var result = await api.xeroConnect();
      if (result && result.authorization_url) window.location.assign(result.authorization_url);
      else if (status) status.textContent = "Xero authorisation URL was not returned.";
    } catch (error) {
      if (status) status.textContent = error && error.message ? error.message : "Xero could not be connected.";
      connect.disabled = false;
    }
  });
  if (refresh) refresh.addEventListener("click", loadStatus);
  if (loadButton) loadButton.addEventListener("click", loadInvoices);
  if (statusFilter) statusFilter.addEventListener("change", loadInvoices);
  if (lookupForm) lookupForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var input = document.getElementById("xero-invoice-number");
    var number = String(input && input.value || "").trim();
    if (!number || !api.xeroLookupInvoice) return;
    if (lookupStatus) lookupStatus.textContent = "Searching Xero…";
    try {
      var result = await api.xeroLookupInvoice(number, selectedTenant() || tenantId);
      renderLookup(result && result.invoice);
      if (lookupStatus) lookupStatus.textContent = result && result.invoice ? "Invoice found in Xero." : "No invoice matched that number.";
    } catch (error) {
      renderLookup(null);
      if (lookupStatus) lookupStatus.textContent = error && error.message ? error.message : "The invoice lookup failed.";
    }
  });
  loadStatus();
}());
