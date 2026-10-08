import { mergeSharedEstimateIndex, normaliseHistoryRecord } from './estimate-history-data.mjs';

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

  async function indexAppEstimate(d, recordId, status = 'created') {
    if (!portalApiEnabled() || !window.GMTPortalApi.estimateIndexUpsert) return;
    await window.GMTPortalApi.estimateIndexUpsert({
      canonical_id: recordId || estimateRecordId(d),
      estimate_number: d.number,
      client: d.company,
      client_email: d.email,
      reference: d.reference,
      estimate_date: d.date,
      source: 'app',
      correlation_status: status === 'sent' ? 'ready' : 'unmatched'
    });
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

  function assetUrl(relativePath) {
    return new URL(`../${String(relativePath || '').replace(/^\/+/, '')}`, window.location.href).href;
  }

  function documentHtml(item) {
    const d = item || data();
    return `<div class="estimate-paper-header"><img class="estimate-paper-logo" src="${esc(assetUrl('image.png'))}" alt="GMT Electrical Services Ltd"><div class="estimate-paper-company"><p>Electric Motor Repairs &amp; Rewinds</p><p>Electrical &amp; Mechanical Engineers</p><p>Air Conditioning Repair &amp; Service</p><p>93-95 Gloucester Rd, Croydon CR0 2DN</p><p>Tel 020 8683 0464</p><p>info@gmt-services.co.uk</p></div></div><h1 class="estimate-paper-title">Estimate</h1><div class="estimate-paper-meta"><div><p><strong>For the attention of:</strong> ${esc(d.attention || 'Client contact')}</p><p><strong>Company:</strong> ${esc(d.company || 'Client company')}</p><p><strong>Re:</strong> ${esc(d.reference || 'Estimate')}</p></div><div><p><strong>Date:</strong> ${esc(d.date || '')}</p><p><strong>Estimate no:</strong> ${esc(d.number || '')}</p></div></div><div class="estimate-paper-body"><p>${esc(d.opening || '').replace(/\n/g, '<br>')}</p><table class="estimate-paper-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${(Array.isArray(d.items) ? d.items : []).map((x) => `<tr><td>${esc(x.description)}</td><td>${Number(x.quantity) || 0}</td><td>${money(x.unit)}</td><td>${money((Number(x.quantity) || 0) * (Number(x.unit) || 0))}</td></tr>`).join('') || '<tr><td colspan="4">No line items added.</td></tr>'}</tbody></table><div class="estimate-paper-total"><p><span>Subtotal</span><strong>${money(d.subtotal)}</strong></p><p><span>VAT (${Number(d.vatRate) || 0}%)</span><strong>${money(d.vat)}</strong></p><p class="grand-total"><span>Total</span><strong>${money(d.total)}</strong></p></div></div><p class="estimate-paper-terms">${esc(d.terms || '')}<br><br>Estimate validity: ${esc(d.validity || '30')} days.</p><p>Regards,<br>${esc(d.preparedBy || 'GMT Electrical Services Ltd')}</p>`;
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

  function archiveContentBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return btoa(binary);
  }

  async function sendToClient() {
    const formElement = $('estimate-form');
    if (!formElement.reportValidity()) return;
    const d = data();
    if (!d.email) { status.textContent = 'Enter the client email before sending this estimate.'; $('estimate-client-email').focus(); return; }
    if (!portalApiEnabled() || typeof window.GMTPortalApi.archiveAppEstimate !== 'function' || typeof window.GMTPortalApi.sendEstimate !== 'function') {
      status.textContent = 'The protected estimate archive and company send route are not connected. No email was sent.';
      return;
    }
    const accountsBcc = String(CONFIG.estimateAccountsBcc || 'accounts@gmt-services.co.uk').trim();
    if (!accountsBcc) { status.textContent = 'Client sending is waiting for the approved Accounts BCC route to be configured. No email was sent.'; return; }
    const approved = window.confirm(`Review before sending:\n\nEstimate ${d.number}\nClient: ${d.company}\nTo: ${d.email}\nAccounts copy: ${accountsBcc}\nTotal: ${money(d.total)}\n\nThe estimate will be filed in the shared archive before the email is sent. Continue?`);
    if (!approved) { status.textContent = 'Estimate not sent. Review the preview and choose Send to client when ready.'; return; }
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)} - Estimate</title></head><body>${documentHtml(d)}</body></html>`;
    let protectedRecord = null;
    try {
      protectedRecord = protectedEstimateRecord(d);
      await window.GMTPortalApi.saveRecord(protectedRecord);
      try { await indexAppEstimate(d, protectedRecord.recordId); } catch (_) { /* the protected estimate record remains available for the shared views */ }
      const sentAt = new Date().toISOString();
      const localRecord = { ...d, sentAt, status: 'Pending client send', recordId: protectedRecord.recordId };
      status.textContent = 'Filing the estimate in the shared SharePoint archive…';
      await window.GMTPortalApi.archiveAppEstimate({
        fileName: `${d.number || 'GMT-estimate'}.doc`, contentType: 'application/msword',
        contentBase64: archiveContentBase64(content), subject: `Estimate ${d.number} | ${d.company}`,
        estimate_number: d.number, customer: d.company, customer_email: d.email,
        recipient_emails: [d.email, accountsBcc], reference: d.reference,
        sent_at: sentAt, received_at: sentAt, source_record_id: protectedRecord.recordId
      });
      await loadArchive(true);
      status.textContent = 'Estimate filed. Sending through the approved Accounts mailbox…';
      const result = await window.GMTPortalApi.sendEstimate({
        recordId: protectedRecord.recordId, estimate: d,
        fileName: `${d.number || 'GMT-estimate'}.doc`, contentType: 'application/msword',
        contentBase64: archiveContentBase64(content), to: d.email
      });
      const finalSentAt = result?.sent_at || new Date().toISOString();
      localRecord.sentAt = finalSentAt;
      localRecord.status = 'Sent to client';
      saveLocalEstimate(localRecord);
      historyRecords = [localRecord, ...historyRecords.filter((record) => record.recordId !== localRecord.recordId)];
      renderHistory(historyRecords, portalApiEnabled() ? 'protected portal history' : 'this browser');
      try { await indexAppEstimate(d, protectedRecord.recordId, 'sent'); } catch (_) { /* archive and protected history remain queryable */ }
      status.textContent = 'Estimate sent through the approved Accounts route, archived, and added to shared estimate history.';
    } catch (error) {
      if (protectedRecord) {
        const archiveFailed = /archiv|sharepoint|shared archive/i.test(error.message || '');
        if (archiveFailed) {
          try { await window.GMTPortalApi.updateRecord(protectedRecord.recordId, { ...protectedRecord, status: 'Archive failed', issue: error.message || 'Estimate archive failed', updatedAt: new Date().toISOString() }); } catch (_) {}
        }
      }
      const uncertain = error.status === 502 || /delivery result|run history|unexpected redirect/i.test(error.message || '');
      status.textContent = uncertain
        ? `${error.message || 'Delivery could not be confirmed.'} Check the Power Automate run before retrying; the estimate is retained in the shared archive.`
        : `${error.message || 'Estimate could not be sent.'} The estimate remains in the shared archive; no email was confirmed.`;
    }
  }

  async function includeSharedEstimateIndex(records) {
    if (!portalApiEnabled() || typeof window.GMTPortalApi.estimateIndexList !== 'function') return records;
    const body = await window.GMTPortalApi.estimateIndexList();
    return mergeSharedEstimateIndex(records, body && body.estimates);
  }

  function renderHistory(records, source) {
    historyRecords = records.map(normaliseHistoryRecord).filter(Boolean);
    if (!historyRecords.length) {
      historyList.innerHTML = '<p class="small-text portal-history-empty">No estimates have been sent from this account.</p>';
      historyPreview.innerHTML = '<p class="small-text">Select an estimate to preview it.</p>';
      selectedHistory = -1;
      return;
    }
    historyList.innerHTML = historyRecords.map((record, index) => `<button type="button" class="estimate-history-item" data-history-index="${index}" aria-current="${index === 0 ? 'true' : 'false'}"><strong>${esc(record.number || 'Estimate')}</strong><span>${esc(record.company || 'Client company')}</span><small>${esc(record.date || 'No date')} · ${esc(record.status || 'Sent')}${record.sourceMailboxes?.length ? ` · Copies: ${esc(record.sourceMailboxes.join(', '))}` : ''}</small></button>`).join('');
    historyList.querySelectorAll('[data-history-index]').forEach((button) => button.addEventListener('click', () => selectHistory(Number(button.dataset.historyIndex))));
    const requestedRecord = new URLSearchParams(window.location.search || '').get('record') || '';
    const requestedIndex = requestedRecord ? historyRecords.findIndex((record) => String(record.recordId) === requestedRecord) : -1;
    selectHistory(requestedIndex >= 0 ? requestedIndex : (selectedHistory >= 0 && selectedHistory < historyRecords.length ? selectedHistory : 0));
    if (historyStatus && source) historyStatus.textContent = `Showing ${historyRecords.length} estimate${historyRecords.length === 1 ? '' : 's'} from ${source}.`;
  }

  function selectHistory(index) {
    if (!historyRecords[index]) return;
    selectedHistory = index;
    historyList.querySelectorAll('[data-history-index]').forEach((button) => { button.setAttribute('aria-current', String(Number(button.dataset.historyIndex) === index)); });
    const record = historyRecords[index];
    const safeLink = (value) => /^https?:\/\//i.test(String(value || '')) ? esc(value) : '';
    const sharepoint = safeLink(record.sharepointUrl || record.attachmentUrl);
    const outlook = safeLink(record.outlookUrl);
    const links = (sharepoint || outlook) ? `<div class="estimate-preview-toolbar"><strong>Archived source</strong><span>${sharepoint ? `<a href="${sharepoint}" target="_blank" rel="noopener">Open shared SharePoint file ↗</a>` : ''}${sharepoint && outlook ? ' · ' : ''}${outlook ? `<a href="${outlook}" target="_blank" rel="noopener">Open email in Outlook ↗</a>` : ''}</span></div>` : '';
    historyPreview.innerHTML = documentHtml(record) + links;
    loadEstimateInvoiceLinks(historyRecords[index]);
  }

  async function loadEstimateInvoiceLinks(record) {
    const panel = $('estimate-invoice-links');
    if (!panel || !record?.recordId || !window.GMTPortalApi?.recordInvoiceLinks) return;
    panel.innerHTML = '<p class="small-text">Loading linked invoices…</p>';
    try {
      const body = await window.GMTPortalApi.recordInvoiceLinks('estimates', record.recordId);
      const invoices = Array.isArray(body?.invoices) ? body.invoices : [];
      const list = invoices.map((invoice) => `<li><strong>${esc(invoice.invoice_number || invoice.invoice_id || 'Invoice')}</strong> · ${esc(invoice.display_status || invoice.status || 'Unknown')} · ${esc(invoice.amount_due == null ? 'Amount due unavailable' : money(invoice.amount_due))}${invoice.url ? ` · <a href="${esc(invoice.url)}" target="_blank" rel="noopener">Open in Xero ↗</a>` : ''}</li>`).join('');
      panel.innerHTML = `<div class="estimate-preview-toolbar"><div><p class="portal-card-kicker">Linked billing</p><h3>Invoices</h3></div><span class="small-text">${invoices.length} linked</span></div>${list ? `<ul class="record-invoice-list">${list}</ul>` : '<p class="small-text">No Xero invoice is linked yet.</p>'}<div class="record-invoice-link-form"><label>Link invoice number<input data-estimate-invoice-number placeholder="e.g. INV-0001"></label><button type="button" class="secondary" data-estimate-invoice-link="${esc(record.recordId)}">Find and link invoice</button><span class="small-text" data-estimate-invoice-feedback></span></div>`;
    } catch (error) {
      panel.innerHTML = `<p class="small-text">Invoice links are unavailable: ${esc(error?.message || 'Please try again.')}</p>`;
    }
  }

  async function loadEstimateHistory() {
    const localRecords = readLocalHistory();
    const endpoint = String(CONFIG.estimateHistoryEndpoint || '').trim();
    if (!endpoint && portalApiEnabled()) {
      historyStatus.textContent = 'Loading protected estimate history…';
      try {
        const body = await window.GMTPortalApi.history('estimates');
        const records = await includeSharedEstimateIndex(body && Array.isArray(body.records) ? body.records : []);
        renderHistory(records, 'shared portal history');
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
      const records = await includeSharedEstimateIndex(body.records);
      renderHistory(records, 'shared protected history');
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

  const archiveList = $('estimate-archive-results');
  const archiveDetail = $('estimate-archive-detail');
  const archiveStatus = $('estimate-archive-status');
  const archiveMore = $('estimate-archive-more');
  let archiveCursor = '';
  let archiveFilters = {};
  let archiveBusy = false;
  function archiveDate(value) {
    if (!value) return 'Date unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-GB');
  }

  function archiveRecordLabel(record) {
    return `${record.estimate_number || record.subject || 'Estimate email'} · ${record.customer || record.customer_email || 'Customer unavailable'} · ${archiveDate(record.sent_at || record.received_at)}`;
  }

  function renderArchiveRecords(records, append) {
    if (!append) archiveList.replaceChildren();
    if (!records.length && !append) {
      archiveList.innerHTML = '<p class="small-text portal-history-empty">No archived email records match this search.</p>';
      return;
    }
    const startIndex = archiveList.querySelectorAll('[data-archive-id]').length;
    archiveList.insertAdjacentHTML('beforeend', records.map((record, index) => `<button type="button" class="estimate-history-item" data-archive-id="${esc(record.id)}" aria-current="false"><strong>${esc(record.estimate_number || record.subject || 'Estimate email')}</strong><span>${esc(record.customer || record.customer_email || 'Customer unavailable')}</span><small>${esc(archiveDate(record.sent_at || record.received_at))} · ${esc(record.mailbox || 'Shared GMT mailbox')} · ${esc(record.classification_state || 'candidate')}</small></button>`).join(''));
    archiveList.querySelectorAll('[data-archive-id]').forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => selectArchiveMessage(button.dataset.archiveId));
    });
    if (startIndex === 0 && records[0]) selectArchiveMessage(records[0].id);
  }

  async function loadArchive(reset) {
    if (!portalApiEnabled() || typeof window.GMTPortalApi.searchEstimateArchive !== 'function') {
      archiveStatus.textContent = 'Shared archive access is not configured for this portal.';
      return;
    }
    if (archiveBusy) return;
    if (reset) { archiveCursor = ''; archiveList.replaceChildren(); archiveDetail.innerHTML = '<p class="small-text">Select a message to view archived files and conversation records.</p>'; }
    archiveBusy = true;
    archiveMore.disabled = true;
    archiveStatus.textContent = reset ? 'Searching the shared archive…' : 'Loading the next page…';
    try {
      const response = await window.GMTPortalApi.searchEstimateArchive({ ...archiveFilters, limit: 50, cursor: archiveCursor });
      const records = Array.isArray(response?.records) ? response.records : [];
      renderArchiveRecords(records, !reset);
      archiveCursor = response?.nextCursor || '';
      archiveMore.hidden = !archiveCursor;
      archiveStatus.textContent = `${archiveList.querySelectorAll('[data-archive-id]').length} archived message${archiveList.querySelectorAll('[data-archive-id]').length === 1 ? '' : 's'} loaded${archiveCursor ? '; more results are available.' : '.'}`;
    } catch (error) {
      archiveStatus.textContent = error?.message || 'The shared archive could not be loaded. Try again.';
      archiveMore.hidden = true;
    } finally {
      archiveBusy = false;
      archiveMore.disabled = false;
    }
  }

  async function selectArchiveMessage(archiveId) {
    archiveList.querySelectorAll('[data-archive-id]').forEach((button) => button.setAttribute('aria-current', String(button.dataset.archiveId === archiveId)));
    archiveDetail.innerHTML = '<p class="small-text">Loading message and conversation details…</p>';
    try {
      const detail = await window.GMTPortalApi.getEstimateArchiveRecord(archiveId);
      const message = detail?.message || {};
      const conversation = Array.isArray(detail?.conversation) ? detail.conversation : [];
      const attachments = Array.isArray(detail?.attachments) ? detail.attachments : [];
      const associations = Array.isArray(detail?.associations) ? detail.associations : [];
      const sourceCopies = Array.isArray(detail?.sourceCopies) ? detail.sourceCopies : [];
      const mailboxLabels = [...new Set([message.mailbox, ...sourceCopies.map((source) => source.mailbox)].filter(Boolean))].join(', ') || 'GMT mailboxes';
      const thread = conversation.length ? conversation.map((item) => `<div class="estimate-archive-thread"><strong>${esc(item.subject || 'Email')}</strong><span>${esc(item.sender_email || '')} · ${esc(archiveDate(item.sent_at || item.received_at))}</span><button type="button" class="secondary" data-archive-download="${esc(item.id)}" data-content-id="eml" data-file-name="message.eml">Download email (.eml)</button>${(item.attachments || []).map((file) => `<div class="estimate-archive-file"><span>${esc(file.file_name || 'Attachment')}</span><button type="button" class="secondary" data-archive-download="${esc(item.id)}" data-content-id="${esc(file.id)}" data-file-name="${esc(file.file_name || 'attachment')}">Download attachment</button></div>`).join('')}</div>`).join('') : '<p class="small-text">No other conversation messages have been archived yet.</p>';
      const files = attachments.length ? attachments.map((item) => `<div class="estimate-archive-file"><span>${esc(item.file_name || 'Attachment')} <small>${esc(item.size_bytes ? `${Math.round(item.size_bytes / 1024)} KB` : '')}</small></span><button type="button" class="secondary" data-archive-download="${esc(archiveId)}" data-content-id="${esc(item.id)}" data-file-name="${esc(item.file_name || 'attachment')}">Download</button></div>`).join('') : '<p class="small-text">No attachments are indexed for this message.</p>';
      const related = associations.length ? associations.map((item) => {
        const targetHref = item.target_kind === 'job-card' && item.target_id ? `../jobs/?record=${encodeURIComponent(item.target_id)}` : item.target_kind === 'estimate' && item.target_id ? `./estimates.html?record=${encodeURIComponent(item.target_id)}` : '';
        const label = `${item.target_kind || 'GMT record'} ${item.target_reference || ''}`.trim();
        return `<li>${targetHref ? `<a href="${esc(targetHref)}">${esc(label)}</a>` : esc(label)} · ${esc(item.relationship || 'related')} · ${esc(item.state || 'candidate')}${item.state !== 'confirmed' ? ' · Review link' : ''}</li>`;
      }).join('') : '<li>No linked job card, estimate, or invoice record yet.</li>';
      const emlButton = message.source_kind === 'email' ? `<button type="button" class="secondary" data-archive-download="${esc(archiveId)}" data-content-id="eml" data-file-name="message.eml">Download email (.eml)</button>` : '';
      archiveDetail.innerHTML = `<header><p class="portal-card-kicker">${esc(message.classification_state || 'Archive record')}</p><h3>${esc(message.estimate_number || message.subject || 'Estimate email')}</h3><p><strong>${esc(message.customer || message.customer_email || 'Customer unavailable')}</strong></p><p>${esc(message.sender_email || '')} · ${esc(archiveDate(message.sent_at || message.received_at))}</p><p class="small-text">Archived mailbox copies: ${esc(mailboxLabels)}</p>${emlButton}</header><section class="estimate-archive-files"><h4>Attachments</h4>${files}</section><section><h4>Email conversation (${conversation.length})</h4><div class="estimate-archive-files">${thread}</div></section><section class="estimate-archive-associations"><h4>Related GMT records</h4><ul>${related}</ul></section>`;
    } catch (error) {
      archiveDetail.innerHTML = `<p class="small-text">Message details could not be loaded: ${esc(error?.message || 'Please try again.')}</p>`;
    }
  }

  $('estimate-archive-range')?.addEventListener('change', (event) => {
    const custom = event.target.value === 'custom';
    $('estimate-archive-from').disabled = !custom;
    $('estimate-archive-to').disabled = !custom;
    if (!custom) { $('estimate-archive-from').value = ''; $('estimate-archive-to').value = ''; }
  });
  $('estimate-archive-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const customRange = $('estimate-archive-range').value === 'custom';
    const from = customRange ? $('estimate-archive-from').value : '';
    const to = customRange ? $('estimate-archive-to').value : '';
    if (from && to && from > to) { archiveStatus.textContent = 'The start date must be on or before the end date.'; $('estimate-archive-from').focus(); return; }
    archiveFilters = { q: $('estimate-archive-query').value.trim(), from, to };
    loadArchive(true);
  });
  archiveMore?.addEventListener('click', () => loadArchive(false));
  archiveDetail?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-archive-download]');
    if (!button || !window.GMTPortalApi?.getEstimateArchiveContent) return;
    button.disabled = true;
    try { await window.GMTPortalApi.getEstimateArchiveContent(button.dataset.archiveDownload, button.dataset.contentId, button.dataset.fileName); }
    catch (error) { archiveStatus.textContent = error?.message || 'The archived file could not be downloaded.'; }
    finally { button.disabled = false; }
  });

  $('estimate-date').value = today.toISOString().slice(0, 10);
  const profile = portalProfile();
  if (profile.name && !$('estimate-prepared-by').value) $('estimate-prepared-by').value = profile.name;
  document.addEventListener('gmtportalprofile', (event) => {
    const remoteProfile = event.detail || {};
    if (remoteProfile.name && !$('estimate-prepared-by').value) $('estimate-prepared-by').value = remoteProfile.name;
  });
  $('add-estimate-line').addEventListener('click', () => addLine());
  $('download-estimate-word').addEventListener('click', wordDownload);
  $('print-estimate').addEventListener('click', () => { render(); window.print(); });
  $('send-estimate').addEventListener('click', sendToClient);
  if (historyRefresh) historyRefresh.addEventListener('click', loadEstimateHistory);
  loadArchive(true);
  $('estimate-invoice-links')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-estimate-invoice-link]');
    if (!button || !window.GMTPortalApi?.xeroLookupInvoice) return;
    const panel = $('estimate-invoice-links');
    const feedback = panel.querySelector('[data-estimate-invoice-feedback]');
    const number = panel.querySelector('[data-estimate-invoice-number]')?.value.trim() || '';
    if (!number) { feedback.textContent = 'Enter an invoice number first.'; return; }
    button.disabled = true; feedback.textContent = 'Finding invoice in Xero…';
    try {
      const found = await window.GMTPortalApi.xeroLookupInvoice(number, '');
      if (!found?.invoice?.invoice_id) throw new Error('No Xero invoice matched that number.');
      await window.GMTPortalApi.xeroLinkInvoice(found.invoice.invoice_id, [button.dataset.estimateInvoiceLink], '');
      await loadEstimateInvoiceLinks(historyRecords[selectedHistory]);
    } catch (error) { feedback.textContent = error.message || 'Invoice could not be linked.'; button.disabled = false; }
  });
  $('clear-estimate').addEventListener('click', () => { if (confirm('Clear this estimate?')) { lines.innerHTML = ''; addLine(); status.textContent = 'Estimate cleared.'; } });
  document.querySelectorAll('#estimate-form input, #estimate-form textarea').forEach((input) => input.addEventListener('input', render));
  addLine({ description:'', quantity:1, unit:0 });
  loadEstimateHistory();
})();
