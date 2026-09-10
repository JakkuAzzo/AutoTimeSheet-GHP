(() => {
  const CONFIG = window.GMT_APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const lines = $('estimate-lines');
  const preview = $('estimate-preview');
  const status = $('estimate-status');
  const historyStatus = $('estimate-history-status');
  const historyList = $('estimate-history-list');
  const historyPreview = $('estimate-history-preview');
  const historyRefresh = $('estimate-history-refresh');
  const sendButton = $('send-estimate');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = (value) => new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP' }).format(Number(value) || 0);
  const today = new Date();
  let historyRecords = [];
  let selectedHistory = -1;

  function portalProfile() {
    try { return JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}'); } catch (_) { return {}; }
  }

  function normaliseScopes(value) {
    if (Array.isArray(value)) return value.map((scope) => String(scope || '').trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
    return [];
  }

  function historyStorageKey() {
    const profile = portalProfile();
    const identity = String(profile.subject || profile.username || 'signed-in-account').trim();
    return `gmt.estimates.history.v1.${encodeURIComponent(identity).slice(0, 160)}`;
  }

  function readLocalHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(historyStorageKey()) || '[]');
      return Array.isArray(value) ? value.filter((record) => record && typeof record === 'object') : [];
    } catch (_) { return []; }
  }

  function saveLocalEstimate(record) {
    try {
      const existing = readLocalHistory();
      const next = [record, ...existing.filter((item) => item.recordId !== record.recordId)].slice(0, 50);
      localStorage.setItem(historyStorageKey(), JSON.stringify(next));
    } catch (_) {
      // A storage failure must not stop the protected send request.
    }
  }

  function portalApiEnabled() {
    return !!(window.GMTPortalApi && typeof window.GMTPortalApi.enabled === 'function' && window.GMTPortalApi.enabled());
  }

  function estimateRecordId(d) {
    const identity = portalProfile().username || d.email || d.company || 'estimate';
    return `estimate-${String(identity).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)}-${String(d.number || 'draft').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80)}`;
  }

  function protectedEstimateRecord(d, status = 'Pending client send', issue = '') {
    return {
      recordId: estimateRecordId(d),
      kind: 'estimates',
      action: 'client_send',
      status,
      issue,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      employeeName: portalProfile().name || d.preparedBy || '',
      employeeEmail: portalProfile().username || d.email || '',
      recordDate: d.date,
      payload: { ...d, estimateNumber: d.number }
    };
  }

  function addLine(values = {}) {
    const row = document.createElement('div');
    row.className = 'estimate-line';
    row.innerHTML = `<label>Description<input data-line="description" required placeholder="Supply and fitting" value="${esc(values.description || '')}"></label><label>Qty<input data-line="quantity" type="number" min="0" step="0.01" value="${values.quantity ?? 1}"></label><label>Unit price<input data-line="unit" type="number" min="0" step="0.01" value="${values.unit ?? 0}"></label><div class="estimate-line-total" data-line-total>£0.00</div><button type="button" class="estimate-line-remove" aria-label="Remove estimate line">Remove</button>`;
    row.querySelector('.estimate-line-remove').addEventListener('click', () => { row.remove(); render(); });
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', render));
    lines.appendChild(row);
    render();
  }

  function data() {
    const items = [...lines.querySelectorAll('.estimate-line')].map((row) => ({
      description: row.querySelector('[data-line="description"]').value.trim(),
      quantity: Number(row.querySelector('[data-line="quantity"]').value) || 0,
      unit: Number(row.querySelector('[data-line="unit"]').value) || 0
    })).filter((item) => item.description || item.unit);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit, 0);
    const vatRate = Number($('estimate-vat-rate').value) || 0;
    const vat = subtotal * vatRate / 100;
    return { number:$('estimate-number').value.trim(), date:$('estimate-date').value, attention:$('estimate-attention').value.trim(), company:$('estimate-company').value.trim(), email:$('estimate-client-email').value.trim(), validity:$('estimate-validity').value, preparedBy:$('estimate-prepared-by').value.trim(), vatRate, reference:$('estimate-reference').value.trim(), opening:$('estimate-opening').value.trim(), terms:$('estimate-terms').value.trim(), items, subtotal, vat, total:subtotal + vat };
  }

  function documentHtml(item) {
    const d = item || data();
    return `<div class="estimate-paper-header"><img class="estimate-paper-logo" src="${location.origin}${location.pathname.replace(/tools\/estimates\.html.*$/, '')}image.png" alt="GMT Electrical Services Ltd"><div class="estimate-paper-company"><p>Electric Motor Repairs &amp; Rewinds</p><p>Electrical &amp; Mechanical Engineers</p><p>Air Conditioning Repair &amp; Service</p><p>93-95 Gloucester Rd, Croydon CR0 2DN</p><p>Tel 020 8683 0464</p><p>info@gmt-services.co.uk</p></div></div><h1 class="estimate-paper-title">Estimate</h1><div class="estimate-paper-meta"><div><p><strong>For the attention of:</strong> ${esc(d.attention || 'Client contact')}</p><p><strong>Company:</strong> ${esc(d.company || 'Client company')}</p><p><strong>Re:</strong> ${esc(d.reference || 'Estimate')}</p></div><div><p><strong>Date:</strong> ${esc(d.date || '')}</p><p><strong>Estimate no:</strong> ${esc(d.number || '')}</p></div></div><div class="estimate-paper-body"><p>${esc(d.opening || '').replace(/\n/g, '<br>')}</p><table class="estimate-paper-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${(Array.isArray(d.items) ? d.items : []).map((x) => `<tr><td>${esc(x.description)}</td><td>${Number(x.quantity) || 0}</td><td>${money(x.unit)}</td><td>${money((Number(x.quantity) || 0) * (Number(x.unit) || 0))}</td></tr>`).join('') || '<tr><td colspan="4">No line items added.</td></tr>'}</tbody></table><div class="estimate-paper-total"><p><span>Subtotal</span><strong>${money(d.subtotal)}</strong></p><p><span>VAT (${Number(d.vatRate) || 0}%)</span><strong>${money(d.vat)}</strong></p><p class="grand-total"><span>Total</span><strong>${money(d.total)}</strong></p></div></div><p class="estimate-paper-terms">${esc(d.terms || '')}<br><br>Estimate validity: ${esc(d.validity || '30')} days.</p><p>Regards,<br>${esc(d.preparedBy || 'GMT Electrical Services Ltd')}</p>`;
  }

  function render() {
    const d = data();
    lines.querySelectorAll('.estimate-line').forEach((row) => { const q = Number(row.querySelector('[data-line="quantity"]').value) || 0; const u = Number(row.querySelector('[data-line="unit"]').value) || 0; row.querySelector('[data-line-total]').textContent = money(q * u); });
    preview.innerHTML = documentHtml(d);
    if (sendButton) sendButton.disabled = !d.email;
  }

  function wordDownload() {
    const d = data();
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)} - Estimate</title><style>body{font-family:Arial;color:#1e293b;margin:48px}h1{text-align:center;letter-spacing:.1em;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}td:not(:first-child),th:not(:first-child){text-align:right}.total{margin-left:auto;width:260px}</style></head><body>${documentHtml(d)}</body></html>`;
    const blob = new Blob([content], { type:'application/msword' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${d.number || 'GMT-estimate'}.doc`; link.click(); URL.revokeObjectURL(link.href);
    status.textContent = 'Word-compatible estimate downloaded. Review it before sending.';
  }

  function addHidden(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value == null ? '' : value;
    form.appendChild(input);
  }

  function addAttachment(form, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.createElement('input');
    input.type = 'file'; input.name = 'attachment'; input.hidden = true; input.files = transfer.files;
    form.appendChild(input);
  }

  async function sendToClient() {
    const formElement = $('estimate-form');
    if (!formElement.reportValidity()) return;
    const d = data();
    if (!d.email) { status.textContent = 'Enter the client email before sending this estimate.'; $('estimate-client-email').focus(); return; }
    const endpoint = String(CONFIG.estimateSendEndpoint || CONFIG.estimateFormSubmitEndpoint || '').trim();
    if (!endpoint) { status.textContent = 'Client sending is not configured yet. Download the document and use the approved Accounts workflow.'; return; }
    const accountsBcc = String(CONFIG.estimateAccountsBcc || CONFIG.formSubmitCc || '').trim();
    if (!accountsBcc) { status.textContent = 'Client sending is waiting for the approved Accounts BCC route to be configured.'; return; }
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)} - Estimate</title></head><body>${documentHtml(d)}</body></html>`;
    const file = new File([content], `${d.number || 'GMT-estimate'}.doc`, { type:'application/msword' });
    const frame = document.createElement('iframe');
    frame.name = `estimate-submit-${Date.now()}`; frame.hidden = true; document.body.appendChild(frame);
    const form = document.createElement('form');
    form.method = 'POST'; form.action = endpoint; form.target = frame.name; form.enctype = 'multipart/form-data'; form.hidden = true;
    addHidden(form, '_subject', `[GMT][ESTIMATE][CLIENT] ${d.number} | ${d.company}`);
    addHidden(form, '_template', 'box'); addHidden(form, '_captcha', 'false');
    addHidden(form, '_to', d.email); addHidden(form, 'to', d.email);
    addHidden(form, '_bcc', accountsBcc); addHidden(form, 'bcc', accountsBcc);
    addHidden(form, 'gmt_type', 'estimate'); addHidden(form, 'gmt_schema_version', '2');
    addHidden(form, 'gmt_send_mode', 'client'); addHidden(form, 'gmt_estimate_number', d.number); addHidden(form, 'gmt_estimate_date', d.date);
    addHidden(form, 'gmt_client_company', d.company); addHidden(form, 'gmt_client_contact', d.attention);
    addHidden(form, 'gmt_client_email', d.email); addHidden(form, 'gmt_accounts_bcc', accountsBcc); addHidden(form, 'gmt_reference', d.reference);
    addHidden(form, 'gmt_subtotal', d.subtotal.toFixed(2)); addHidden(form, 'gmt_vat', d.vat.toFixed(2));
    addHidden(form, 'gmt_total', d.total.toFixed(2)); addHidden(form, 'gmt_submitted_at', new Date().toISOString());
    addHidden(form, 'message', 'Please send the attached estimate to the client email and BCC Accounts for filing.');
    addAttachment(form, file);
    let protectedRecord = null;
    try {
      if (portalApiEnabled()) {
        protectedRecord = protectedEstimateRecord(d);
        await window.GMTPortalApi.saveRecord(protectedRecord);
      }
      const response = await fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' }, credentials: 'omit' });
      const responseText = await response.text();
      let result = null;
      try { result = responseText ? JSON.parse(responseText) : null; } catch (_) {}
      if (!response.ok || (result && (result.success === false || result.success === 'false'))) throw new Error(result && result.message ? result.message : `Estimate delivery failed (${response.status}).`);
      const sentAt = new Date().toISOString();
      const localRecord = { ...d, sentAt, status: 'Sent to client', recordId: protectedRecord ? protectedRecord.recordId : `${d.number || 'estimate'}|${sentAt}` };
      saveLocalEstimate(localRecord);
      historyRecords = [localRecord, ...historyRecords.filter((record) => record.recordId !== localRecord.recordId)];
      renderHistory(historyRecords, portalApiEnabled() ? 'protected portal history' : 'this browser');
      if (protectedRecord) await window.GMTPortalApi.updateRecord(protectedRecord.recordId, { ...protectedRecord, status: 'Sent to client', issue: '', updatedAt: sentAt });
      status.textContent = 'Estimate sent to the client and recorded for Accounts filing.';
    } catch (error) {
      if (protectedRecord) {
        try { await window.GMTPortalApi.updateRecord(protectedRecord.recordId, { ...protectedRecord, status: 'Delivery failed', issue: error.message || 'Estimate delivery failed', updatedAt: new Date().toISOString() }); } catch (_) {}
      }
      status.textContent = error.message || 'Estimate could not be sent.';
    } finally {
      form.remove(); frame.remove();
    }
  }

  function normaliseHistoryRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const items = Array.isArray(record.items) ? record.items.map((item) => ({ description: item.description || item.Description || '', quantity: Number(item.quantity ?? item.Quantity) || 0, unit: Number(item.unit ?? item.Unit ?? item.unitPrice) || 0 })).filter((item) => item.description) : [];
    return { number: record.estimate_number || record.estimateNumber || record.number || '', date: record.estimate_date || record.estimateDate || record.date || '', attention: record.client_contact || record.clientContact || record.attention || '', company: record.client_company || record.clientCompany || record.company || '', email: record.client_email || record.clientEmail || record.email || '', validity: record.validity || '30', preparedBy: record.prepared_by || record.preparedBy || '', vatRate: Number(record.vat_rate ?? record.vatRate) || 0, reference: record.reference || '', opening: record.opening || '', terms: record.terms || '', items, subtotal: Number(record.subtotal) || 0, vat: Number(record.vat) || 0, total: Number(record.total) || 0, sentAt: record.sent_at || record.sentAt || record.submitted_at || record.submittedAt || '', status: record.status || 'Sent', recordId: record.source_record_id || record.sourceRecordId || record.recordId || `${record.number || 'estimate'}|${record.sentAt || record.submittedAt || ''}` };
  }

  function renderHistory(records, source) {
    historyRecords = records.map(normaliseHistoryRecord).filter(Boolean);
    if (!historyRecords.length) {
      historyList.innerHTML = '<p class="small-text portal-history-empty">No estimates have been sent from this account.</p>';
      historyPreview.innerHTML = '<p class="small-text">Select an estimate to preview it.</p>';
      selectedHistory = -1;
      return;
    }
    historyList.innerHTML = historyRecords.map((record, index) => `<button type="button" class="estimate-history-item" data-history-index="${index}" aria-current="${index === 0 ? 'true' : 'false'}"><strong>${esc(record.number || 'Estimate')}</strong><span>${esc(record.company || 'Client company')}</span><small>${esc(record.date || 'No date')} · ${esc(record.status || 'Sent')}</small></button>`).join('');
    historyList.querySelectorAll('[data-history-index]').forEach((button) => button.addEventListener('click', () => selectHistory(Number(button.dataset.historyIndex))));
    selectHistory(selectedHistory >= 0 && selectedHistory < historyRecords.length ? selectedHistory : 0);
    if (historyStatus && source) historyStatus.textContent = `Showing ${historyRecords.length} estimate${historyRecords.length === 1 ? '' : 's'} from ${source}.`;
  }

  function selectHistory(index) {
    if (!historyRecords[index]) return;
    selectedHistory = index;
    historyList.querySelectorAll('[data-history-index]').forEach((button) => { button.setAttribute('aria-current', String(Number(button.dataset.historyIndex) === index)); });
    historyPreview.innerHTML = documentHtml(historyRecords[index]);
  }

  async function loadEstimateHistory() {
    const localRecords = readLocalHistory();
    const endpoint = String(CONFIG.estimateHistoryEndpoint || '').trim();
    if (!endpoint && portalApiEnabled()) {
      historyStatus.textContent = 'Loading protected estimate history…';
      try {
        const body = await window.GMTPortalApi.history('estimates');
        renderHistory(body && Array.isArray(body.records) ? body.records : [], 'protected portal history');
        return;
      } catch (_) {
        // The labelled local fallback below remains available during an outage.
      }
    }
    if (!endpoint) {
      if (localRecords.length) {
        renderHistory(localRecords, 'this browser; protected history is not connected');
        historyStatus.textContent = 'Protected Microsoft 365 estimate history is not connected. Showing estimates sent from this browser.';
      } else {
        historyStatus.textContent = 'Protected Microsoft 365 estimate history is not connected yet.';
        renderHistory([], 'this account');
      }
      return;
    }
    historyStatus.textContent = 'Loading protected estimate history…';
    try {
      const headers = { Accept: 'application/json' };
      const scopes = normaliseScopes(CONFIG.estimateHistoryScopes);
      let auth = window.GMT_PORTAL_AUTH || {};
      if (scopes.length) {
        if (typeof auth.acquireToken !== 'function' && window.GMT_PORTAL_AUTH_READY) auth = await window.GMT_PORTAL_AUTH_READY;
        if (typeof auth.acquireToken !== 'function') throw new Error('Sign-in context unavailable');
        const token = await auth.acquireToken(scopes);
        if (!token) throw new Error('History access token unavailable');
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store', headers });
      if (response.status === 401) throw new Error('Your GMT sign-in has expired');
      if (response.status === 403) throw new Error('Your GMT account is not authorised to view these estimates');
      if (!response.ok) throw new Error('History request failed');
      const body = await response.json();
      if (!body || !Array.isArray(body.records)) throw new Error('History response was not valid');
      renderHistory(body.records, 'protected Microsoft 365 history');
    } catch (_) {
      if (localRecords.length) {
        renderHistory(localRecords, 'this browser; protected history could not be loaded');
        historyStatus.textContent = 'Protected estimate history could not be loaded. Showing estimates sent from this browser only.';
      } else {
        historyStatus.textContent = 'Your previous estimates could not be loaded. Please try again or contact Accounts.';
        renderHistory([], 'this account');
      }
    }
  }

  $('estimate-date').value = today.toISOString().slice(0, 10);
  const profile = portalProfile();
  if (profile.name && !$('estimate-prepared-by').value) $('estimate-prepared-by').value = profile.name;
  $('add-estimate-line').addEventListener('click', () => addLine());
  $('download-estimate-word').addEventListener('click', wordDownload);
  $('print-estimate').addEventListener('click', () => { render(); window.print(); });
  $('send-estimate').addEventListener('click', sendToClient);
  if (historyRefresh) historyRefresh.addEventListener('click', loadEstimateHistory);
  $('clear-estimate').addEventListener('click', () => { if (confirm('Clear this estimate?')) { lines.innerHTML = ''; addLine(); status.textContent = 'Estimate cleared.'; } });
  document.querySelectorAll('#estimate-form input, #estimate-form textarea').forEach((input) => input.addEventListener('input', render));
  addLine({ description:'', quantity:1, unit:0 });
  loadEstimateHistory();
})();
