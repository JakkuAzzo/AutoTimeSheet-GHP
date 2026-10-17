(() => {
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  };

  const keys = {
    jobs: 'gmt_portal_job_cards_v1',
    org: 'gmt_portal_org_v1',
    notifications: 'gmt_portal_notifications_v1',
    calendar: 'gmt_portal_calendar_v1',
    log: 'gmt_portal_notification_log_v1'
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = (value, currency = 'GBP') => {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Amount unavailable';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(number); } catch (_) { return `${currency} ${number.toFixed(2)}`; }
  };
  const safeJobEmailUrl = (value) => {
    try {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const parsed = new URL(raw, window.location.origin);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
    } catch (_) {
      return '';
    }
  };
  const GMT_JOB_CARD_CC = 'gmtelectricalservices+jobcards@outlook.com';
  const taskIndex = new Map();
  let taskBoardState = { records: [], pending: [], access: { actorUpn: '', canManage: false, staff: [] } };
  let taskFormAttempt = null;
  const calendarIndex = new Map();
  const jobCardIndex = new Map();
  let jobCardRevisionSource = null;
  let jobHistoryMeta = {};
  let xeroStatusSnapshot = null;
  let selectedJobId = '';
  let jobCardArchiveCursor = null;
  let jobCardArchiveFilters = {};
  let selectedJobCardArchiveId = '';
  let selectedJobCardArchiveContentUrl = '';
  let jobCardArchiveRequestId = 0;
  let jobCardArchiveSearchRequestId = 0;

  function portalProfileName() {
    return store.get('gmt.portal.profile.v1', {}).name || '';
  }

  function portalProfile() {
    return store.get('gmt.portal.profile.v1', {});
  }

  function portalApiEnabled() {
    return !!(window.GMTPortalApi && typeof window.GMTPortalApi.enabled === 'function' && window.GMTPortalApi.enabled());
  }

  async function saveProtectedRecord(record) {
    if (!portalApiEnabled()) return false;
    await window.GMTPortalApi.saveRecord(record);
    return true;
  }

  async function updateProtectedRecord(record, status, issue = '') {
    if (!portalApiEnabled()) return false;
    await window.GMTPortalApi.updateRecord(record.recordId, { ...record, status, issue, updatedAt: new Date().toISOString() });
    return true;
  }

  function dateParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})/);
    return match ? { year: match[1], month: match[2] } : { year: '', month: '' };
  }

  function prefillPortalIdentity() {
    const name = portalProfileName();
    if (!name) return;
    ['#job-engineer', '#calendar-owner'].forEach((selector) => {
      const input = $(selector);
      if (input && !input.value.trim()) input.value = name;
    });
  }

  function prefillTaskDate() {
    const input = $('#task-due');
    if (!input || input.value) return;
    const value = new URLSearchParams(window.location.search || '').get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return;
    input.value = value;
  }

  function logNotification(type, message) {
    const log = store.get(keys.log, []);
    log.unshift({ id: id(), type, message, at: new Date().toISOString() });
    store.set(keys.log, log.slice(0, 60));
    renderNotifications();
  }

  function cleanFormSubmitEndpoint(value) {
    return String(value || '').trim().replace('/ajax/', '/');
  }

  function baseFormSubmitEndpoint() {
    return cleanFormSubmitEndpoint(window.GMT_APP_CONFIG?.formSubmitEndpoint);
  }

  function formSubmitEndpoint() {
    return baseFormSubmitEndpoint() || cleanFormSubmitEndpoint(window.GMT_APP_CONFIG?.fallbackFormSubmitEndpoint);
  }

  function taggedFormSubmitEndpoint(tag) {
    const base = baseFormSubmitEndpoint();
    if (!base) return cleanFormSubmitEndpoint(window.GMT_APP_CONFIG?.fallbackFormSubmitEndpoint);
    return base.replace(/([^/?#/@]+)@([^/?#]+)/, (_, local, domain) => `${local.split('+')[0]}+${tag}@${domain}`);
  }

  function jobCardFormSubmitEndpoint() {
    return cleanFormSubmitEndpoint(window.GMT_APP_CONFIG?.jobCardFormSubmitEndpoint) || taggedFormSubmitEndpoint('jobcards');
  }

  function categoryFormSubmitEndpoint(kind) {
    const config = window.GMT_APP_CONFIG || {};
    const approvedFallback = cleanFormSubmitEndpoint(config.fallbackFormSubmitEndpoint);
    if (kind.startsWith('Task')) return cleanFormSubmitEndpoint(config.taskFormSubmitEndpoint) || approvedFallback || formSubmitEndpoint();
    if (kind.startsWith('Calendar')) return cleanFormSubmitEndpoint(config.calendarFormSubmitEndpoint) || approvedFallback || formSubmitEndpoint();
    return formSubmitEndpoint();
  }

  function ensurePortalSubmitFrame() {
    let iframe = document.getElementById('portal-formsubmit-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'portal-formsubmit-frame';
      iframe.name = 'portal-formsubmit-frame';
      iframe.hidden = true;
      document.body.appendChild(iframe);
    }
    return iframe;
  }

  function recipientList(...values) {
    const seen = new Set();
    return values
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter((value) => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()))
      .join(',');
  }

  function setFileInputFiles(input, files) {
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
  }

  function sendPortalFormSubmit(kind, fields, options = {}) {
    const isJobCard = kind.startsWith('Job Card');
    const endpoint = isJobCard ? jobCardFormSubmitEndpoint() : categoryFormSubmitEndpoint(kind);
    if (!endpoint) {
      logNotification(kind, `${kind} stored locally only. FormSubmit is not configured.`);
      return false;
    }
    ensurePortalSubmitFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = endpoint;
    form.target = 'portal-formsubmit-frame';
    form.enctype = 'multipart/form-data';
    form.hidden = true;
    const submittedAt = new Date().toISOString();

    const add = (name, value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value == null ? '' : String(value);
      form.appendChild(input);
    };

    add('_subject', subjectForKind(kind, fields));
    add('_template', 'box');
    add('_captcha', 'false');
    add('_url', window.location.href);
    const cc = isJobCard
      ? GMT_JOB_CARD_CC
      : recipientList(window.GMT_APP_CONFIG?.formSubmitCc);
    if (cc) add('_cc', cc);
    add('submission_type', kind);
    if (isJobCard) {
      const jobRef = fields.job_reference || fields.gmt_job_ref || '';
      const parts = dateParts(fields.planned_date || fields.gmt_planned_date || '');
      add('gmt_type', 'jobcard');
      add('gmt_action', kind === 'Job Card' ? 'new' : 'update');
      // The human job reference groups a chain, while the submission ID keeps
      // each revised card immutable in protected history.
      add('gmt_record_id', jobRef);
      add('gmt_submission_id', fields.record_id || fields.gmt_submission_id || jobRef);
      add('gmt_job_ref', jobRef);
      add('gmt_client', fields.client || fields.gmt_client || '');
      add('gmt_site', fields.site_address || fields.gmt_site || '');
      add('gmt_engineer', fields.assigned_engineer || fields.gmt_engineer || '');
      add('gmt_planned_date', fields.planned_date || fields.gmt_planned_date || '');
      add('gmt_job_status', fields.job_status || 'Received');
      add('gmt_job_revision', fields.job_revision || '1');
      add('gmt_previous_record_id', fields.previous_record_id || '');
      add('gmt_invoice_number', fields.invoice_number || '');
      add('gmt_xero_reference', fields.xero_reference || '');
      add('gmt_job_email_url', fields.job_email_url || '');
      add('gmt_job_email_message_id', fields.job_email_message_id || '');
      add('gmt_portal_record_url', `${window.location.origin}/jobs/?record=${encodeURIComponent(fields.record_id || jobRef)}`);
      add('gmt_schema_version', '1');
      add('gmt_year', parts.year);
      add('gmt_month', parts.month);
      if (options.file) add('gmt_attachment_type', 'image');
      add('gmt_submitted_at', submittedAt);
    }
    if (kind.startsWith('Task')) {
      const due = fields.due_date || '';
      const parts = dateParts(due);
      add('gmt_type', 'task');
      add('gmt_action', kind === 'Task' ? 'create_request' : 'update_request');
      add('gmt_schema_version', '1');
      add('gmt_record_id', fields.task_id || '');
      add('gmt_status', fields.status || 'Pending approval');
      add('gmt_employee', fields.requested_by || '');
      add('gmt_requester_upn', fields.requested_by_upn || '');
      add('gmt_year', parts.year);
      add('gmt_month', parts.month);
      add('gmt_submitted_at', submittedAt);
    }
    if (kind.startsWith('Calendar')) {
      const eventDate = fields.event_date || '';
      const parts = dateParts(eventDate);
      add('gmt_type', 'calendar');
      add('gmt_action', kind === 'Calendar Request' ? 'create_request' : 'update_request');
      add('gmt_schema_version', '1');
      add('gmt_record_id', fields.event_id || '');
      add('gmt_status', fields.status || 'Pending approval');
      add('gmt_employee', fields.requested_by || fields.owner_or_requester || '');
      add('gmt_requester_upn', fields.requested_by_upn || '');
      add('gmt_year', parts.year);
      add('gmt_month', parts.month);
      add('gmt_calendar_name', 'GMT Operational Calendar');
      add('gmt_submitted_at', submittedAt);
    }
    Object.entries(fields).forEach(([name, value]) => add(name, value));
    if (!('submitted_at' in fields) && !('updated_at' in fields)) add('submitted_at', submittedAt);
    if (options.file) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.name = 'attachment';
      setFileInputFiles(fileInput, [options.file]);
      form.appendChild(fileInput);
    }
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 2000);
    return true;
  }

  function subjectForKind(kind, fields = {}) {
    const jobRef = fields.job_reference || fields.gmt_job_ref || 'Unreferenced job';
    const client = fields.client || fields.gmt_client || 'No client';
    if (kind === 'Job Card') return `[GMT][JOBCARD][NEW] ${jobRef} | ${client}`;
    if (kind === 'Job Card Update') return `[GMT][JOBCARD][UPDATE] ${jobRef} | ${client}`;
    if (kind === 'Task') return `[GMT][TASK][REQUEST] ${fields.task_title || 'Untitled task'}`;
    if (kind === 'Task Update') return `[GMT][TASK][UPDATE] ${fields.task_title || 'Untitled task'}`;
    if (kind === 'Calendar Request') return `[GMT][CALENDAR][REQUEST] ${fields.event_date || 'Unscheduled'} | ${fields.event_title || 'Untitled event'}`;
    if (kind === 'Calendar Update') return `[GMT][CALENDAR][UPDATE] ${fields.event_date || 'Unscheduled'} | ${fields.event_title || 'Untitled event'}`;
    return `GMT ${kind} Submission`;
  }

  function setTab(name) {
    $$('.portal-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    $$('.portal-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
  }

  function openTimesheetForm() {
    $('#timesheet-home')?.classList.remove('active');
    $('#timesheet-create')?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToTimesheets() {
    $('#timesheet-create')?.classList.remove('active');
    $('#timesheet-home')?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function jobPreviewDataFromRecord(job) {
    return {
      ref: job.ref || '',
      client: job.client || 'Customer / client',
      site: job.site || 'Job address',
      engineer: job.engineer || 'Engineer',
      date: job.date || 'Date',
      description: job.description || 'Job description / report'
    };
  }

  function renderJobHistoryPreview(job) {
    const preview = $('#job-card-history-preview');
    if (!preview) return;
    if (!job) {
      preview.innerHTML = '<p class="small-text">Select a job card to preview it.</p>';
      return;
    }
    const effectiveMeta = jobHistoryMeta || {};
    const canManage = Boolean(effectiveMeta.is_admin || effectiveMeta.is_job_card_admin);
    const canUseXero = Boolean(effectiveMeta.is_admin);
    const lifecycleOptions = ['Received', 'Assigned', 'In progress', 'Awaiting parts', 'Completed', 'Cancelled'];
    const statusValue = job.jobStatus || job.status || 'Received';
    const statusClass = String(statusValue).toLowerCase().replace(/\s+/g, '-');
    const data = jobPreviewDataFromRecord(job);
    const accountFields = canManage && job.remote ? `<div class="job-card-account-fields" data-job-account-fields="${safe(job.id)}">
      <strong>Accounts tracking</strong>
      <label>Invoice number<input data-job-invoice value="${safe(job.invoiceNumber || '')}" placeholder="Assigned by Accounts"></label>
      <label>Xero reference<input data-job-xero value="${safe(job.xeroReference || '')}" placeholder="Xero invoice or tracking reference"></label>
      <label>Job status<select data-job-status>${[...new Set([statusValue, ...lifecycleOptions])].map((statusOption) => `<option value="${safe(statusOption)}" ${statusOption === statusValue ? 'selected' : ''}>${safe(statusOption)}</option>`).join('')}</select></label>
      <label>Job email link<input data-job-email-url type="url" value="${safe(safeJobEmailUrl(job.emailUrl))}" placeholder="Outlook message link"></label>
      <button type="button" class="secondary" data-job-account-save="${safe(job.id)}">Save Accounts fields</button>
      ${canUseXero ? `<button type="button" class="secondary" data-job-xero-sync="${safe(job.id)}">Find invoice in Xero</button><span class="small-text" data-job-xero-feedback></span>` : ''}
      <span class="small-text" data-job-account-feedback></span>
    </div>` : '<p class="small-text">Status changes are managed by Accounts in Microsoft 365. Invoice and Xero tracking are managed there too.</p>';
    preview.innerHTML = `<div class="job-card-history-preview-toolbar"><div><p class="portal-card-kicker">${safe(job.cardType || 'EC')} card · Revision ${safe(job.revision || 1)}</p><h3>${safe(job.ref || 'Untitled job')}</h3></div><span class="portal-status ${safe(statusClass)}">${safe(statusValue)}</span></div>
      <p class="small-text">${safe(job.client || 'Customer / client')} · ${safe(job.site || 'Job address')} · Engineer: ${safe(job.engineer || 'Unassigned')} · Date: ${safe(job.date || 'No date')}</p>
      ${safeJobEmailUrl(job.emailUrl) ? `<p class="small-text"><a href="${safe(safeJobEmailUrl(job.emailUrl))}" target="_blank" rel="noopener">Open job email</a></p>` : ''}
      <div class="job-card-history-document">${job.cardType === 'MTA' ? renderMtaJobPreview(data) : renderEcJobPreview(data)}</div>
      <p class="small-text">${job.invoiceNumber ? `Invoice ${safe(job.invoiceNumber)}${job.xeroReference ? ` · Xero ${safe(job.xeroReference)}` : ''}` : 'Invoice number pending Accounts allocation.'}${job.xeroInvoiceStatus ? ` · Xero status ${safe(job.xeroInvoiceStatus)}` : ''}${job.xeroLastSyncedAt ? ` · Synced ${safe(job.xeroLastSyncedAt)}` : ''}</p>
      <div class="portal-item-actions"><button type="button" class="secondary" data-job-revise="${safe(job.id)}">Create revision</button></div>
      ${accountFields}`;
    loadRecordInvoiceLinks('job-cards', job.id, $('#job-card-invoice-links'), canUseXero);
  }

  async function loadRecordInvoiceLinks(kind, recordId, container, canManage) {
    if (!container || !window.GMTPortalApi?.recordInvoiceLinks) return;
    container.innerHTML = '<p class="small-text">Loading linked invoices…</p>';
    try {
      const body = await window.GMTPortalApi.recordInvoiceLinks(kind, recordId);
      const invoices = Array.isArray(body?.invoices) ? body.invoices : [];
      const cards = invoices.map((invoice) => `<li><strong>${safe(invoice.invoice_number || invoice.invoice_id || 'Invoice')}</strong> · ${safe(invoice.display_status || invoice.status || 'Unknown')} · ${safe(invoice.amount_due == null ? 'Amount due unavailable' : money(invoice.amount_due, invoice.currency))}${invoice.url ? ` · <a href="${safe(invoice.url)}" target="_blank" rel="noopener">Open in Xero ↗</a>` : ''}</li>`).join('');
      container.innerHTML = `<div class="estimate-preview-toolbar"><div><p class="portal-card-kicker">Linked billing</p><h3>Invoices</h3></div><span class="small-text">${invoices.length} linked</span></div>${cards ? `<ul class="record-invoice-list">${cards}</ul>` : '<p class="small-text">No Xero invoice is linked yet.</p>'}${canManage ? `<div class="record-invoice-link-form"><label>Link invoice number<input data-record-invoice-number placeholder="e.g. INV-0001"></label><button type="button" class="secondary" data-record-invoice-link="${safe(recordId)}">Find and link invoice</button><span class="small-text" data-record-invoice-feedback></span></div>` : ''}`;
    } catch (error) {
      container.innerHTML = `<p class="small-text">Invoice links are unavailable: ${safe(error?.message || 'Please try again.')}</p>`;
    }
  }

  function archiveFieldLabel(field) {
    return ({
      cardNumber: 'Job card number', date: 'Date', customer: 'Customer', orderNumber: 'Order / PO',
      site: 'Site', engineer: 'Engineer', report: 'Work description', amount: 'Amount'
    })[field] || field;
  }

  function archiveDateCandidate(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!match) return '';
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  function renderJobCardArchiveResults(records, append = false) {
    const list = $('#job-card-archive-results');
    if (!list) return;
    const rows = Array.isArray(records) ? records : [];
    if (!append && !rows.length) {
      list.innerHTML = '<p class="small-text portal-history-empty">No scanned job cards match this search.</p>';
      return;
    }
    const markup = rows.map((record) => {
      const candidates = record.candidates || {};
      const confirmed = record.confirmed_fields || {};
      const reference = confirmed.cardNumber || candidates.cardNumber || record.record_id;
      const customer = confirmed.customer || candidates.customer || 'Customer needs review';
      const date = confirmed.date || candidates.date || 'Date needs review';
      const confidence = record.mean_ocr_confidence == null ? 'OCR confidence unavailable' : `OCR confidence ${Math.round(Number(record.mean_ocr_confidence))}%`;
      const isConfirmed = record.review_state === 'confirmed';
      const review = isConfirmed ? 'Accounts confirmed' : 'OCR candidate · Accounts review needed';
      return `<button type="button" class="job-card-archive-result" data-job-archive-select="${safe(record.record_id)}" aria-current="${String(record.record_id === selectedJobCardArchiveId)}"><strong>${safe(reference)}</strong><span>${safe(customer)}</span><small>${safe(record.card_type)} · ${safe(record.source_file)} page ${safe(record.source_page)} · ${safe(date)}</small><small>${safe(review)} · ${safe(confidence)}</small></button>`;
    }).join('');
    if (append) list.insertAdjacentHTML('beforeend', markup);
    else list.innerHTML = markup;
  }

  function renderJobCardArchiveDetail(record) {
    const detail = $('#job-card-archive-detail');
    if (!detail) return;
    const candidates = record.candidates || {};
    const confirmed = record.confirmed_fields || {};
    const fields = ['cardNumber', 'date', 'customer', 'orderNumber', 'site', 'engineer', 'report', 'amount'];
    const values = fields.map((field) => `<div><dt>${safe(archiveFieldLabel(field))}</dt><dd>${safe(confirmed[field] || candidates[field] || 'Not captured')}</dd></div>`).join('');
    const isConfirmed = record.review_state === 'confirmed';
    const canReview = Boolean(jobHistoryMeta.is_admin || jobHistoryMeta.is_job_card_admin);
    const reviewForm = canReview ? `<form class="job-card-archive-review-form" id="job-card-archive-review-form" data-job-card-review="${safe(record.record_id)}">
      <label>Confirmed job card number<input name="cardNumber" value="${safe(confirmed.cardNumber || candidates.cardNumber || '')}" maxlength="240"></label>
      <label>Confirmed date<input name="date" type="date" value="${safe(confirmed.date || archiveDateCandidate(candidates.date))}"></label>
      <label>Confirmed customer<input name="customer" value="${safe(confirmed.customer || candidates.customer || '')}" maxlength="1000"></label>
      <label>Confirmed order / PO<input name="orderNumber" value="${safe(confirmed.orderNumber || candidates.orderNumber || '')}" maxlength="500"></label>
      <label>Confirmed site<input name="site" value="${safe(confirmed.site || candidates.site || '')}" maxlength="2000"></label>
      <label>Confirmed engineer<input name="engineer" value="${safe(confirmed.engineer || candidates.engineer || '')}" maxlength="500"></label>
      <label data-wide>Confirmed work description<textarea name="report" maxlength="6000">${safe(confirmed.report || candidates.report || '')}</textarea></label>
      <label>Confirmed amount<input name="amount" value="${safe(confirmed.amount || candidates.amount || '')}" maxlength="240"></label>
      <label>Review status<select name="state"><option value="confirmed" ${isConfirmed ? 'selected' : ''}>Accounts confirmed</option><option value="needs-review" ${isConfirmed ? '' : 'selected'}>Needs more review</option></select></label>
      <label data-wide>Accounts review note<textarea name="note" maxlength="2000">${safe(record.review_note || '')}</textarea></label>
      <div class="job-card-archive-review-actions"><button type="submit">Save Accounts review</button><span class="small-text" data-job-card-review-status role="status"></span></div>
    </form>` : '';
    const displayName = confirmed.cardNumber || candidates.cardNumber || `${record.card_type || 'Job'} card · ${record.source_file || 'scanned record'} page ${record.source_page || ''}`;
    const displayCustomer = confirmed.customer || candidates.customer || 'Customer needs review';
    const displayDate = confirmed.date || candidates.date || 'Date needs review';
    detail.innerHTML = `<header><p class="portal-card-kicker">${safe(record.review_state === 'confirmed' ? 'Accounts confirmed record' : 'OCR candidate · review required')}</p><h3>${safe(displayName)} · ${safe(displayCustomer)}</h3><p>${safe(record.card_type)} job card · ${safe(displayDate)} · ${safe(record.source_file)} page ${safe(record.source_page)}</p><details><summary>Stable archive ID</summary><code>${safe(record.record_id)}</code></details></header>
      <dl class="job-card-archive-meta">${values}<div><dt>Mean OCR confidence</dt><dd>${safe(record.mean_ocr_confidence == null ? 'Unavailable' : `${Number(record.mean_ocr_confidence).toFixed(1)}%`)}</dd></div></dl>
      <a class="job-card-archive-open-preview" id="job-card-archive-open-preview" href="#" target="_blank" rel="noopener noreferrer" hidden>Open full-page PDF</a>
      <iframe class="job-card-archive-preview" id="job-card-archive-preview" title="Scanned job card page" referrerpolicy="no-referrer"></iframe>
      <details><summary>Raw OCR text (unverified)</summary><pre class="job-card-archive-ocr">${safe(record.ocr_text || 'No OCR text was captured.')}</pre></details>
      ${reviewForm}`;
    const preview = $('#job-card-archive-preview');
    if (preview && selectedJobCardArchiveContentUrl) preview.src = selectedJobCardArchiveContentUrl;
  }

  async function selectJobCardArchive(recordId) {
    const selected = String(recordId || '');
    if (!selected || !window.GMTPortalApi?.getJobCardArchiveRecord) return;
    selectedJobCardArchiveId = selected;
    const requestId = ++jobCardArchiveRequestId;
    $$('#job-card-archive-results [data-job-archive-select]').forEach((button) => button.setAttribute('aria-current', String(button.dataset.jobArchiveSelect === selected)));
    const detail = $('#job-card-archive-detail');
    if (detail) detail.innerHTML = '<p class="small-text">Loading scanned page and record details…</p>';
    const invoicePanel = $('#job-card-archive-invoice-links');
    loadRecordInvoiceLinks('job-cards', selected, invoicePanel, Boolean(jobHistoryMeta.is_admin));
    try {
      const body = await window.GMTPortalApi.getJobCardArchiveRecord(selected);
      if (requestId !== jobCardArchiveRequestId) return;
      if (selectedJobCardArchiveContentUrl) URL.revokeObjectURL(selectedJobCardArchiveContentUrl);
      selectedJobCardArchiveContentUrl = '';
      renderJobCardArchiveDetail(body?.record || {});
      try {
        selectedJobCardArchiveContentUrl = await window.GMTPortalApi.getJobCardArchiveContentUrl(selected);
        if (requestId === jobCardArchiveRequestId) {
          const preview = $('#job-card-archive-preview');
          if (preview) preview.src = selectedJobCardArchiveContentUrl;
          const openPreview = $('#job-card-archive-open-preview');
          if (openPreview) {
            openPreview.href = selectedJobCardArchiveContentUrl;
            openPreview.hidden = false;
          }
        } else {
          URL.revokeObjectURL(selectedJobCardArchiveContentUrl);
          selectedJobCardArchiveContentUrl = '';
        }
      } catch (error) {
        const preview = $('#job-card-archive-preview');
        if (preview) preview.replaceWith(Object.assign(document.createElement('p'), { className: 'small-text', textContent: error.message || 'Scanned page preview is unavailable.' }));
      }
    } catch (error) {
      if (requestId === jobCardArchiveRequestId && detail) detail.innerHTML = `<p class="small-text">Scanned job-card details are unavailable: ${safe(error?.message || 'Please try again.')}</p>`;
    }
  }

  async function loadJobCardArchive(options = {}) {
    const status = $('#job-card-archive-status');
    const more = $('#job-card-archive-more');
    const list = $('#job-card-archive-results');
    if (!list || !window.GMTPortalApi?.jobCardArchiveSearch) return;
    const append = options.append === true;
    const requestId = append ? jobCardArchiveSearchRequestId : ++jobCardArchiveSearchRequestId;
    if (!append) {
      jobCardArchiveFilters = options.filters || {};
      jobCardArchiveCursor = null;
      list.innerHTML = '';
      if (status) status.textContent = 'Searching scanned job cards…';
    } else if (status) status.textContent = 'Loading more scanned job cards…';
    try {
      const result = await window.GMTPortalApi.jobCardArchiveSearch({ ...jobCardArchiveFilters, ...(append && jobCardArchiveCursor ? { cursor: jobCardArchiveCursor } : {}), limit: 50 });
      if (requestId !== jobCardArchiveSearchRequestId) return;
      const rows = Array.isArray(result?.records) ? result.records : [];
      renderJobCardArchiveResults(rows, append);
      jobCardArchiveCursor = result?.nextCursor || null;
      if (more) more.hidden = !jobCardArchiveCursor;
      if (status) status.textContent = `${list.querySelectorAll('[data-job-archive-select]').length} scanned records loaded${jobCardArchiveCursor ? '. More results are available.' : '.'}`;
      if (!append && rows.length) {
        const selected = rows.some((row) => row.record_id === selectedJobCardArchiveId) ? selectedJobCardArchiveId : rows[0].record_id;
        await selectJobCardArchive(selected);
      } else if (!append && !rows.length) {
        selectedJobCardArchiveId = '';
        if (selectedJobCardArchiveContentUrl) URL.revokeObjectURL(selectedJobCardArchiveContentUrl);
        selectedJobCardArchiveContentUrl = '';
        const detail = $('#job-card-archive-detail');
        const invoicePanel = $('#job-card-archive-invoice-links');
        if (detail) detail.innerHTML = '<p class="small-text">No scanned job cards match this search.</p>';
        if (invoicePanel) invoicePanel.innerHTML = '<p class="small-text">Select a scanned job card to view or link invoices.</p>';
      }
    } catch (error) {
      if (requestId !== jobCardArchiveSearchRequestId) return;
      if (status) status.textContent = error?.message || 'The scanned job-card archive could not be searched.';
      if (more) more.hidden = true;
      if (!append && list) list.innerHTML = '<p class="small-text">The scanned job-card archive is unavailable. Check your connection and try again.</p>';
    }
  }

  async function saveJobCardArchiveReview(form) {
    const recordId = form.dataset.jobCardReview;
    const fields = Object.fromEntries(['cardNumber', 'date', 'customer', 'orderNumber', 'site', 'engineer', 'report', 'amount'].map((name) => [name, form.elements[name]?.value.trim() || '']));
    const status = form.elements.state?.value || 'needs-review';
    const note = form.elements.note?.value.trim() || '';
    const feedback = form.querySelector('[data-job-card-review-status]');
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    if (feedback) feedback.textContent = 'Saving Accounts review…';
    try {
      await window.GMTPortalApi.reviewJobCardArchive(recordId, { confirmedFields: fields, state: status, note });
      await loadJobCardArchive({ filters: jobCardArchiveFilters });
      const refreshedFeedback = $('#job-card-archive-review-form [data-job-card-review-status]');
      if (refreshedFeedback) refreshedFeedback.textContent = 'Accounts review saved.';
    } catch (error) {
      if (feedback) feedback.textContent = error?.message || 'Accounts review could not be saved.';
      if (button) button.disabled = false;
    }
  }

  function selectJobHistory(jobId) {
    selectedJobId = String(jobId || '');
    $$('#job-card-list [data-job-select]').forEach((button) => button.setAttribute('aria-current', String(button.dataset.jobSelect === selectedJobId)));
    renderJobHistoryPreview(jobCardIndex.get(selectedJobId));
  }

  function renderJobs(remoteJobs = [], meta = null) {
    if (meta && Object.keys(meta).length) jobHistoryMeta = meta;
    const effectiveMeta = jobHistoryMeta || {};
    const localJobs = store.get(keys.jobs, []);
    const remoteIds = new Set(remoteJobs.map((remote) => String(remote.id || '')).filter(Boolean));
    const jobs = [...remoteJobs, ...localJobs.filter((local) => !remoteIds.has(String(local.id || '')))];
    const list = $('#job-card-list');
    if (!list) return;
    jobCardIndex.clear();
    jobs.forEach((job) => jobCardIndex.set(String(job.id || ''), job));
    if (!jobs.length) {
      list.innerHTML = '<p class="small-text portal-history-empty">No job cards created yet.</p>';
      renderJobHistoryPreview(null);
      const historyStatus = $('#job-card-history-status');
      if (historyStatus) historyStatus.textContent = 'No submitted job cards are available for this account.';
      return;
    }
    list.innerHTML = jobs.map((job) => {
      const statusValue = job.jobStatus || job.status || 'Received';
      const notice = job.remote && (effectiveMeta.is_admin || effectiveMeta.is_job_card_admin) ? '' : '<small>Status changes are managed by Accounts in Microsoft 365.</small>';
      return `<button type="button" class="estimate-history-item" data-job-select="${safe(job.id)}" aria-current="${String(String(job.id) === selectedJobId)}"><strong>${safe(job.ref || 'Untitled job')}</strong><span>${safe(job.client || 'Customer / client')}</span><small>${safe(job.cardType || 'EC')} card · ${safe(job.date || 'No date')} · ${safe(statusValue)}</small>${notice}</button>`;
    }).join('');
    const historyStatus = $('#job-card-history-status');
    if (historyStatus) historyStatus.textContent = `Showing ${jobs.length} job card${jobs.length === 1 ? '' : 's'} in protected history.`;
    list.querySelectorAll('[data-job-select]').forEach((button) => button.addEventListener('click', () => selectJobHistory(button.dataset.jobSelect)));
    const requestedRecord = new URLSearchParams(window.location.search || '').get('record') || '';
    if (requestedRecord && jobCardIndex.has(requestedRecord)) selectedJobId = requestedRecord;
    if (!jobCardIndex.has(selectedJobId)) selectedJobId = String(jobs[0].id || '');
    selectJobHistory(selectedJobId);
  }

  function jobPreviewData() {
    return {
      ref: $('#job-ref')?.value.trim() || '',
      client: $('#job-client')?.value.trim() || 'Customer / client',
      site: $('#job-site')?.value.trim() || 'Job address',
      engineer: $('#job-engineer')?.value.trim() || 'Engineer',
      date: $('#job-date')?.value || 'Date',
      description: $('#job-description')?.value.trim() || 'Job description / report'
    };
  }

  function renderEcJobPreview(data) {
    return `<article class="job-card-sheet job-card-sheet-ec" aria-label="EC job card preview">
        <div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand">GMT Electrical Services</span></div><div class="job-sheet-number"><span>E.C.No</span><strong>${safe(data.ref || 'EC 00000')}</strong></div></div>
      <div class="job-sheet-meta-grid job-sheet-meta-ec">
        <div class="job-sheet-field"><span>Date:</span><strong>${safe(data.date)}</strong></div>
        <div class="job-sheet-field job-sheet-address"><span>Job Address:</span><strong>${safe(data.site)}</strong></div>
        <div class="job-sheet-field"><span>Customer:</span><strong>${safe(data.client)}</strong></div>
        <div class="job-sheet-field"><span>Contact:</span><strong>________________</strong></div>
        <div class="job-sheet-field"><span>Order No:</span><strong>${safe(data.ref || 'EC 00000')}</strong></div>
        <div class="job-sheet-field"><span>Tel:</span><strong>________________</strong></div>
      </div>
      <div class="job-sheet-rule"></div>
      <div class="job-sheet-section-title">Job description / Report</div>
      <div class="job-sheet-lined job-sheet-report">${safe(data.description)}</div>
      <div class="job-sheet-footer-grid">
        <div class="job-sheet-field"><span>Engineer:</span><strong>${safe(data.engineer)}</strong></div>
        <div class="job-sheet-field"><span>Date Started:</span><strong>${safe(data.date)}</strong></div>
        <div class="job-sheet-field"><span>Date Completed:</span><strong>________________</strong></div>
      </div>
    </article>`;
  }

  function renderMtaJobPreview(data) {
    return `<article class="job-card-sheet job-card-sheet-mta" aria-label="MTA job card preview">
      <div class="job-sheet-topline"><div class="job-sheet-branding"><img class="job-sheet-logo" src="../assets/brand/gmt-icon.png" alt="GMT Electrical Services Ltd logo"><span class="job-sheet-brand job-sheet-brand-wide">GMT Electrical Services Ltd.</span></div><div class="job-sheet-number"><span>MTA No.</span><strong>${safe(data.ref || 'MTA 00000')}</strong></div></div>
      <div class="job-sheet-mta-meta"><div class="job-sheet-field"><span>Date:</span><strong>${safe(data.date)}</strong></div><div class="job-sheet-field"><span>Job authorised by:</span><strong>________________</strong></div><div class="job-sheet-field"><span>Tally:</span><strong>________________</strong></div></div>
      <div class="job-sheet-mta-parties"><div class="job-sheet-box"><span>Invoiced to</span><strong>${safe(data.client)}</strong></div><div class="job-sheet-box"><span>Dispatched to</span><strong>${safe(data.site)}</strong><div class="job-sheet-signature"><small>Signature: __________________</small><small>Date: __________</small></div><small>Print name: ______________________________</small></div></div>
      <div class="job-sheet-equipment"><div>MAKE</div><div>HP / KW</div><div>VOLTS</div><div>RPM</div><div>SERIAL No.</div><strong>${safe(data.client)}</strong><span>________</span><span>________</span><span>________</span><span>________________</span></div>
      <div class="job-sheet-section-title">Report</div>
      <div class="job-sheet-mta-report"><div class="job-sheet-lined job-sheet-report">${safe(data.description)}</div><div class="job-sheet-checklist"><span>SLOTS __________________</span><span>COILS __________________</span><span>GROUPS ________________</span><span>SPAN __________________</span><span>CONNECTION ____________</span><span>EXTRA __________________</span><span>WINDER _________________</span></div></div>
      <div class="job-sheet-mta-footer"><div class="job-sheet-box"><span>Material / time / operative / price</span><strong>Engineer: ${safe(data.engineer)}</strong></div><div class="job-sheet-box"><span>Test report</span><small>2500 volts __________________</small><small>Megger _____________________</small><small>Tested by __________________</small><small>Authorised by ______________</small><small>Date ______________________</small></div></div>
    </article>`;
  }

  function updateJobPreviewToggle(type) {
    const selected = type === 'MTA' ? 'MTA' : 'EC';
    $$('[data-preview-card-type]').forEach((button) => {
      const isSelected = button.dataset.previewCardType === selected;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
    $('#job-card-preview')?.setAttribute('data-card-type', selected);
  }

  function renderJobPreview(type) {
    const preview = $('#job-card-preview');
    if (!preview) return;
    const selectedType = type === 'MTA' ? 'MTA' : (type === 'EC' ? 'EC' : ($('#job-card-type')?.value || 'EC'));
    const data = jobPreviewData();
    preview.innerHTML = selectedType === 'MTA' ? renderMtaJobPreview(data) : renderEcJobPreview(data);
    updateJobPreviewToggle(selectedType);
  }

  function renderTasks(state) {
    if (state && typeof state === 'object') taskBoardState = {
      records: Array.isArray(state.records) ? state.records : [],
      pending: Array.isArray(state.pending) ? state.pending : [],
      access: state.access && typeof state.access === 'object' ? state.access : { actorUpn: '', canManage: false, staff: [] }
    };
    const records = taskBoardState.records.map((task) => ({ ...task, pendingActions: [] }));
    const byId = new Map(records.map((task) => [String(task.taskId), task]));
    taskBoardState.pending.forEach((operation) => {
      let task = byId.get(String(operation.taskId));
      if (!task && operation.task) {
        task = { ...operation.task, taskId: operation.taskId, pendingActions: [] };
        byId.set(String(operation.taskId), task);
        records.push(task);
      }
      if (task) task.pendingActions.push(operation);
    });
    taskIndex.clear();
    records.forEach((task) => taskIndex.set(String(task.taskId), task));
    const board = $('#task-board');
    const columns = ['Pending approval', 'To-Do', 'In-Progress', 'Completed', 'Cancelled'];
    if (board) board.innerHTML = columns.map((status) => {
      const items = records.filter((task) => task.status === status);
      return `<section class="kanban-column"><h3>${status} <span class="portal-status">${items.length}</span></h3>${items.map(renderTask).join('') || '<p class="small-text">No tasks.</p>'}</section>`;
    }).join('');
  }

  function renderTaskStaffOptions(task) {
    const staff = Array.isArray(taskBoardState.access.staff) ? taskBoardState.access.staff : [];
    return `<option value="">Unassigned</option>${staff.map((person) => `<option value="${safe(person.upn)}" ${String(person.upn).toLowerCase() === String(task.assigneeUpn || task.requestedAssigneeUpn || '').toLowerCase() ? 'selected' : ''}>${safe(person.name || person.upn)} · ${safe(person.upn)}</option>`).join('')}`;
  }

  function taskManagerFields(task) {
    const staff = Array.isArray(taskBoardState.access.staff) ? taskBoardState.access.staff : [];
    if (!staff.length) return '<p class="task-workflow-note">No approved staff directory is available for assignment.</p>';
    return `<div class="task-manager-fields"><label>Assigned to<select data-task-assignee>${renderTaskStaffOptions(task)}</select></label><label>Due date<input type="date" data-task-due value="${safe(task.dueDate || '')}"></label><label>Priority<select data-task-priority>${['Low', 'Normal', 'High', 'Urgent'].map((priority) => `<option ${task.priority === priority ? 'selected' : ''}>${priority}</option>`).join('')}</select></label></div>`;
  }

  function renderTask(task) {
    const actor = String(taskBoardState.access.actorUpn || '').toLowerCase();
    const requester = actor && actor === String(task.requesterUpn || '').toLowerCase();
    const assigned = actor && actor === String(task.assigneeUpn || '').toLowerCase();
    const manager = taskBoardState.access.canManage === true;
    const pending = task.status === 'Pending approval';
    const active = ['To-Do', 'In-Progress'].includes(task.status);
    const taskId = safe(task.taskId);
    const managerFields = taskManagerFields(task);
    const controls = [];
    if (manager && pending) {
      controls.push(`<div class="task-workflow-controls">${managerFields}<label class="task-action-reason">Decision note (optional)<input data-task-reason="decision" maxlength="1000"></label><div class="task-card-actions"><button type="button" data-task-action="approve">Approve request</button><button type="button" class="secondary" data-task-action="reject">Reject request</button></div></div>`);
    } else if (manager && active) {
      controls.push(`<div class="task-workflow-controls">${managerFields}<div class="task-card-actions"><button type="button" class="secondary" data-task-action="assign">Save assignment</button><button type="button" class="secondary" data-task-action="schedule">Save schedule</button></div></div>`);
    }
    if (pending && (requester || manager)) controls.push('<label class="task-action-reason">Cancellation note (optional)<input data-task-reason="cancel" maxlength="1000"></label><button type="button" class="secondary" data-task-action="cancel">Cancel pending request</button>');
    if (task.status === 'To-Do' && (assigned || manager)) controls.push('<button type="button" data-task-action="transition" data-task-next="In-Progress">Start work</button>');
    if (task.status === 'In-Progress' && (assigned || manager)) controls.push('<button type="button" data-task-action="transition" data-task-next="Completed">Mark completed</button>');
    if (active && manager) controls.push('<label class="task-action-reason">Cancellation note (optional)<input data-task-reason="cancel" maxlength="1000"></label><button type="button" class="secondary" data-task-action="cancel">Cancel task</button>');
    const failures = (task.pendingActions || []).map((operation) => `<div class="task-sync-error"><p>${safe(operation.error || 'The update has not been confirmed by Microsoft 365.')}</p><button type="button" class="secondary" data-task-retry="${safe(operation.actionId)}">Retry same update</button><small>Attempt ${safe(operation.attempts || 0)} · action ${safe(operation.actionId)}</small></div>`).join('');
    const calendar = ['failed', 'pending'].includes(String(task.calendarSyncStatus || '').toLowerCase())
      ? `<p class="task-workflow-note">Calendar sync: ${safe(task.calendarSyncStatus)}${task.calendarSyncError ? ` · ${safe(task.calendarSyncError)}` : ''}</p>` : '';
    return `<article class="task-card" data-task-card="${taskId}">
      <h4>${safe(task.title || 'Untitled task')}</h4>
      <p class="portal-item-meta">${safe(task.jobReference || 'No job ref')} · ${safe(task.assignee || task.assigneeUpn || 'Unassigned')}</p>
      <p class="portal-item-meta">Requested by ${safe(task.requesterName || task.requesterUpn || 'Unknown')} · Due: ${safe(task.dueDate || 'No due date')} · Priority: <span class="portal-status">${safe(task.priority || 'Normal')}</span></p>
      <p class="task-workflow-note">${pending ? 'Awaiting Accounts or Operations approval.' : `SharePoint item ${safe(task.sharePointItemId || 'pending sync')} · ${safe(task.status)}`}</p>
      ${calendar}${failures}
      <div class="task-card-actions">${controls.join('')}</div>
      <button type="button" class="secondary task-history-toggle" data-task-history="${taskId}" aria-expanded="false">View history</button>
      <div class="task-history-content" data-task-history-content hidden></div>
    </article>`;
  }

  function updateTaskConsentButton(error) {
    const button = $('#task-connect-button');
    if (!button) return;
    const scopes = window.GMT_APP_CONFIG?.taskWorkflowScopes;
    button.hidden = !(error?.status === 401 && Array.isArray(scopes) && scopes.some(Boolean)
      && typeof window.GMTPortalApi?.connectTaskWorkflow === 'function');
  }

  function renderOrg() {
    const org = store.get(keys.org, {});
    const preview = $('#org-preview');
    if (!preview) return;
    preview.innerHTML = `
      ${org.logo ? `<img src="${org.logo}" alt="Company logo preview">` : '<p class="small-text">No logo uploaded yet.</p>'}
      <p><strong>Current name:</strong> ${safe(org.currentName || 'GMT Electrical Services')}</p>
      <p><strong>Requested name:</strong> ${safe(org.requestedName || 'No pending request')}</p>
      <p><strong>Admin email:</strong> ${safe(org.adminEmail || 'Not set')}</p>
      <p class="small-text">Company name changes are stored as requests in this static preview. Final approval needs backend/admin identity.</p>`;
    $('#org-current-name') && ($('#org-current-name').value = org.currentName || 'GMT Electrical Services');
    $('#org-request-name') && ($('#org-request-name').value = org.requestedName || '');
    $('#org-admin-email') && ($('#org-admin-email').value = org.adminEmail || '');
  }

  function renderNotifications() {
    const settings = store.get(keys.notifications, {});
    const fields = { 'notify-login': 'login', 'notify-task': 'task', 'notify-timesheet': 'timesheet', 'notify-job-card': 'jobCard', 'notify-critical': 'critical' };
    Object.entries(fields).forEach(([fieldId, key]) => {
      const input = document.getElementById(fieldId);
      if (input) input.checked = !!settings[key];
    });
    const log = store.get(keys.log, []);
    const target = $('#notification-log');
    if (!target) return;
    target.innerHTML = log.length ? log.map((item) => `
      <article class="portal-item">
        <strong>${safe(item.type)}</strong>
        <p>${safe(item.message)}</p>
        <p class="portal-item-meta">${new Date(item.at).toLocaleString()}</p>
      </article>`).join('') : '<p class="small-text">No notification log entries yet.</p>';
  }

  function renderCalendar() {
    const events = store.get(keys.calendar, []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const list = $('#calendar-list');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<p class="small-text">No calendar events yet.</p>';
      return;
    }
    calendarIndex.clear();
    events.forEach((event) => calendarIndex.set(String(event.id || event.recordId), event));
    list.innerHTML = events.map((event) => `
      <article class="portal-item calendar-date-group">
        <strong>${safe(event.date)} · ${safe(event.title)}</strong>
        <span class="portal-status ${event.status.toLowerCase()}">${safe(event.status)}</span>
        <p class="portal-item-meta">${safe(event.type)} · ${safe(event.owner || 'No owner')}</p>
        <p>${safe(event.notes || 'No notes')}</p>
        <div class="portal-item-actions">
          <span class="small-text">${event.status === 'Pending approval' ? 'Awaiting licensed accounts approval.' : 'Published from the approved calendar feed.'}</span>
          ${event.status !== 'Cancelled' ? `<button type="button" class="secondary" data-calendar-edit="${event.id}">Edit</button>` : ''}
          ${event.status === 'Pending approval' ? `<button type="button" class="secondary danger" data-calendar-delete="${event.id}">Cancel request</button>` : ''}
        </div>
      </article>`).join('');
  }

  function bindTabs() {
    $$('.portal-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('[data-open-timesheet-form]')?.addEventListener('click', openTimesheetForm);
    $('[data-back-to-timesheets]')?.addEventListener('click', backToTimesheets);
  }

  async function loadProtectedJobs() {
    if (!portalApiEnabled()) return;
    try {
      const body = await window.GMTPortalApi.history('job-cards');
      const remoteJobs = (body && Array.isArray(body.records) ? body.records : []).map((record) => ({
        id: record.source_record_id,
        ref: record.job_ref || record.source_record_id,
        client: record.client || '',
        site: record.site || '',
        engineer: record.engineer || record.employee_name || '',
        date: record.planned_date || record.record_date || '',
        description: record.description || '',
        cardType: record.card_type || 'EC',
        status: record.status || 'Submitted',
        jobStatus: record.job_status || record.status || 'Received',
        invoiceNumber: record.invoice_number || '',
        xeroReference: record.xero_reference || '',
        xeroInvoiceId: record.xero_invoice_id || '',
        xeroInvoiceStatus: record.xero_invoice_status || '',
        xeroInvoiceUrl: record.xero_invoice_url || '',
        xeroInvoiceTotal: record.xero_invoice_total,
        xeroInvoiceAmountDue: record.xero_invoice_amount_due,
        xeroInvoiceCurrency: record.xero_invoice_currency || '',
        xeroLastSyncedAt: record.xero_last_synced_at || '',
        emailUrl: record.job_email_url || '',
        emailMessageId: record.job_email_message_id || '',
        revision: record.job_revision || 1,
        previousRecordId: record.previous_record_id || '',
        updateReason: record.update_reason || '',
        accountNotes: record.account_notes || '',
        action: record.action || 'create_request',
        employeeName: record.employee_name || '',
        employeeEmail: record.employee_upn || '',
        recordDate: record.record_date || record.planned_date || '',
        submittedAt: record.submitted_at || '',
        remote: true
      }));
      renderJobs(remoteJobs, body?.meta || {});
      const importLink = $('#job-card-import-link');
      if (importLink) importLink.hidden = !(body?.meta?.is_admin || body?.meta?.is_job_card_admin);
      loadProtectedXero(body?.meta || {});
    } catch (_) {
      // The local draft list remains visible when the protected service is unavailable.
    }
  }

  function renderXeroPanel(body = {}) {
    const panel = $('#xero-account-panel');
    if (!panel) return;
    if (!jobHistoryMeta.is_admin) {
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      return;
    }
    xeroStatusSnapshot = body;
    panel.hidden = false;
    panel.removeAttribute('aria-hidden');
    const status = $('#xero-account-status');
    const feedback = $('#xero-account-feedback');
    const connect = $('#xero-connect-button');
    const tenantLabel = $('#xero-tenant-label');
    const tenantSelect = $('#xero-tenant-select');
    const connections = Array.isArray(body.connections) ? body.connections : [];
    if (!body.configured) {
      if (status) status.textContent = 'Xero is not configured on the protected Worker yet. Accounts must add the Xero app credentials and encryption key before connecting.';
      if (connect) connect.disabled = true;
      if (tenantLabel) tenantLabel.hidden = true;
      return;
    }
    if (connect) connect.disabled = false;
    if (connections.length) {
      if (status) status.textContent = `Connected to ${connections.map((connection) => connection.tenant_name).join(', ')}. Invoice lookup is read-only and does not create or edit Xero transactions.`;
      if (tenantLabel && tenantSelect) {
        tenantLabel.hidden = connections.length < 2;
        tenantSelect.innerHTML = connections.map((connection) => `<option value="${safe(connection.tenant_id)}">${safe(connection.tenant_name)}</option>`).join('');
      }
      if (connect) connect.textContent = 'Reconnect GMT Xero';
    } else {
      if (status) status.textContent = 'Xero app is configured. Connect GMT’s Xero organisation to enable invoice lookup.';
      if (tenantLabel) tenantLabel.hidden = true;
      if (connect) connect.textContent = 'Connect GMT Xero';
    }
    if (feedback && new URLSearchParams(window.location.search).get('xero') === 'connected') {
      feedback.textContent = 'Xero connected. The Accounts invoice controls are ready.';
      const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, '', cleanUrl);
    }
  }

  async function loadProtectedXero(meta = {}) {
    const panel = $('#xero-account-panel');
    if (!portalApiEnabled() || !meta.is_admin) {
      if (panel) {
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    if (panel) panel.hidden = false;
    try {
      renderXeroPanel(await window.GMTPortalApi.xeroStatus());
    } catch (error) {
      const status = $('#xero-account-status');
      if (status) status.textContent = error.message || 'The protected Xero status could not be read.';
    }
  }

  async function loadProtectedTasks() {
    const board = $('#task-board');
    if (!board) return;
    const status = $('#task-board-status');
    if (!portalApiEnabled() || typeof window.GMTPortalApi.tasks !== 'function') {
      renderTasks({ records: [], pending: [], access: {} });
      updateTaskConsentButton(null);
      if (status) status.textContent = 'Protected Microsoft 365 task access is not configured.';
      return;
    }
    if (status) status.textContent = 'Loading authorised tasks from Microsoft 365…';
    try {
      const body = await window.GMTPortalApi.tasks();
      renderTasks(body);
      updateTaskConsentButton(null);
      if (status) status.textContent = `${body.records?.length || 0} authorised task${body.records?.length === 1 ? '' : 's'} loaded from Microsoft 365.`;
    } catch (error) {
      renderTasks({ records: [], pending: [], access: {} });
      updateTaskConsentButton(error);
      if (status) status.textContent = error.message || 'Microsoft 365 task workflow is unavailable.';
    }
  }

  async function loadProtectedCalendar() {
    if (!portalApiEnabled()) return;
    try {
      const body = await window.GMTPortalApi.history('calendar');
      const remoteEvents = (body && Array.isArray(body.records) ? body.records : []).map((record) => ({
        id: record.source_record_id,
        title: record.event_title || 'Untitled event',
        date: record.event_date || record.record_date || '',
        type: record.event_type || 'General',
        owner: record.owner || record.employee_name || '',
        notes: record.notes || '',
        status: record.status || 'Pending approval',
        requestedBy: record.employee_name || '',
        recordId: record.source_record_id
      }));
      const localEvents = store.get(keys.calendar, []);
      store.set(keys.calendar, [...remoteEvents, ...localEvents.filter((local) => !remoteEvents.some((remote) => String(remote.id) === String(local.id)))]);
      renderCalendar();
    } catch (_) {
      // Local calendar requests remain visible if the protected service is unavailable.
    }
  }

  function bindJobs() {
    const xeroPanel = $('#xero-account-panel');
    if (xeroPanel) xeroPanel.setAttribute('aria-hidden', 'true');
    ['#job-ref', '#job-client', '#job-site', '#job-engineer', '#job-date', '#job-description'].forEach((selector) => $(selector)?.addEventListener('input', () => renderJobPreview()));
    $('#job-card-type')?.addEventListener('change', (event) => renderJobPreview(event.target.value));
    $$('[data-preview-card-type]').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.previewCardType === 'MTA' ? 'MTA' : 'EC';
      const select = $('#job-card-type');
      if (select) select.value = type;
      renderJobPreview(type);
    }));
    renderJobPreview();
    $('#xero-connect-button')?.addEventListener('click', async () => {
      const button = $('#xero-connect-button');
      const feedback = $('#xero-account-feedback');
      if (button) button.disabled = true;
      if (feedback) feedback.textContent = 'Opening Xero authorisation…';
      try {
        const result = await window.GMTPortalApi.xeroConnect();
        if (!result?.authorization_url) throw new Error('Xero authorisation URL was not returned.');
        window.location.assign(result.authorization_url);
      } catch (error) {
        if (button) button.disabled = false;
        if (feedback) feedback.textContent = error.message || 'Xero could not be started.';
      }
    });
    $('#job-card-history-refresh')?.addEventListener('click', loadProtectedJobs);
    $('#job-card-archive-search')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = $('#job-card-archive-query')?.value.trim() || '';
      const from = $('#job-card-archive-from')?.value || '';
      const to = $('#job-card-archive-to')?.value || '';
      if (query && Array.from(query).length < 3) {
        const status = $('#job-card-archive-status');
        if (status) status.textContent = 'Enter at least three characters to search scanned text.';
        $('#job-card-archive-query')?.focus();
        return;
      }
      if (from && to && from > to) {
        const status = $('#job-card-archive-status');
        if (status) status.textContent = 'The confirmed date start must be on or before the end date.';
        $('#job-card-archive-from')?.focus();
        return;
      }
      loadJobCardArchive({ filters: { q: query, cardType: $('#job-card-archive-type')?.value || '', from, to } });
    });
    $('#job-card-archive-more')?.addEventListener('click', () => loadJobCardArchive({ append: true }));
    $('#job-card-scanned-archive')?.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-job-card-review]');
      if (!form) return;
      event.preventDefault();
      saveJobCardArchiveReview(form);
    });
    $('#job-card-history')?.addEventListener('click', async (event) => {
      const archiveSelect = event.target.closest('[data-job-archive-select]');
      if (archiveSelect) {
        await selectJobCardArchive(archiveSelect.dataset.jobArchiveSelect);
        return;
      }
      const selectButton = event.target.closest('[data-job-select]');
      if (selectButton) {
        selectJobHistory(selectButton.dataset.jobSelect);
        return;
      }
      const reviseButton = event.target.closest('[data-job-revise]');
      if (reviseButton) {
        const source = jobCardIndex.get(String(reviseButton.dataset.jobRevise || ''));
        if (!source) return;
        jobCardRevisionSource = source;
        const values = {
          '#job-card-type': source.cardType || 'EC',
          '#job-ref': source.ref || '',
          '#job-client': source.client || '',
          '#job-site': source.site || '',
          '#job-engineer': source.engineer || '',
          '#job-date': source.date || '',
          '#job-description': source.description || '',
          '#job-email-link': source.emailUrl || '',
          '#job-email-message-id': source.emailMessageId || ''
        };
        Object.entries(values).forEach(([selector, value]) => { const input = $(selector); if (input) input.value = value; });
        const notice = $('#job-revision-notice');
        if (notice) notice.textContent = `Creating revision ${Number(source.revision || 1) + 1} of ${source.ref || 'this job'}. Submit to create a new card and invoice trail.`;
        renderJobPreview(source.cardType || 'EC');
        $('#job-card-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const xeroButton = event.target.closest('[data-job-xero-sync]');
      if (xeroButton && portalApiEnabled()) {
        const job = jobCardIndex.get(String(xeroButton.dataset.jobXeroSync || ''));
        const card = xeroButton.closest('[data-job-account-fields]');
        const feedback = card?.querySelector('[data-job-xero-feedback]');
        const invoiceNumber = card?.querySelector('[data-job-invoice]')?.value.trim() || job?.invoiceNumber || '';
        const tenantId = $('#xero-tenant-select')?.value || '';
        if (!job?.remote) return;
        if (!invoiceNumber) {
          if (feedback) feedback.textContent = 'Enter the Xero invoice number first.';
          return;
        }
        xeroButton.disabled = true;
        if (feedback) feedback.textContent = 'Looking up invoice…';
        try {
          const result = await window.GMTPortalApi.xeroSyncJobCard(job.id, invoiceNumber, tenantId);
          const invoice = result?.invoice || {};
          job.invoiceNumber = invoice.invoice_number || invoiceNumber;
          job.xeroReference = invoice.invoice_number || invoice.invoice_id || job.xeroReference || '';
          job.xeroInvoiceId = invoice.invoice_id || '';
          job.xeroInvoiceStatus = invoice.status || '';
          job.xeroInvoiceUrl = invoice.url || '';
          job.xeroInvoiceTotal = invoice.total;
          job.xeroInvoiceAmountDue = invoice.amount_due;
          job.xeroInvoiceCurrency = invoice.currency || '';
          job.xeroLastSyncedAt = result?.record?.xero_last_synced_at || new Date().toISOString();
          if (feedback) feedback.textContent = `Linked ${job.xeroReference || invoiceNumber}${invoice.status ? ` (${invoice.status})` : ''}.`;
          logNotification('Xero', `${job.ref || job.id} linked to Xero invoice ${job.xeroReference || invoiceNumber}.`);
          renderJobs([...jobCardIndex.values()].filter((item) => item.remote), jobHistoryMeta);
        } catch (error) {
          if (feedback) feedback.textContent = error.message || 'Xero invoice lookup failed.';
          xeroButton.disabled = false;
        }
        return;
      }
      const linkButton = event.target.closest('[data-record-invoice-link]');
      if (linkButton && portalApiEnabled()) {
        const card = linkButton.closest('.record-invoice-links');
        const feedback = card?.querySelector('[data-record-invoice-feedback]');
        const invoiceNumber = card?.querySelector('[data-record-invoice-number]')?.value.trim() || '';
        if (!invoiceNumber) { if (feedback) feedback.textContent = 'Enter an invoice number first.'; return; }
        linkButton.disabled = true;
        if (feedback) feedback.textContent = 'Finding invoice in Xero…';
        try {
          const found = await window.GMTPortalApi.xeroLookupInvoice(invoiceNumber, $('#xero-tenant-select')?.value || '');
          if (!found?.invoice?.invoice_id) throw new Error('No Xero invoice matched that number.');
          await window.GMTPortalApi.xeroLinkInvoice(found.invoice.invoice_id, [linkButton.dataset.recordInvoiceLink], $('#xero-tenant-select')?.value || '');
          if (feedback) feedback.textContent = 'Invoice linked.';
          await loadRecordInvoiceLinks('job-cards', linkButton.dataset.recordInvoiceLink, card, true);
        } catch (error) { if (feedback) feedback.textContent = error.message || 'Invoice could not be linked.'; linkButton.disabled = false; }
        return;
      }
      const button = event.target.closest('[data-job-account-save]');
      if (!button || !portalApiEnabled()) return;
      const card = button.closest('[data-job-account-fields]');
      const job = jobCardIndex.get(String(button.dataset.jobAccountSave || ''));
      if (!card || !job || !job.remote) return;
      const feedback = card.querySelector('[data-job-account-feedback]');
      const invoiceNumber = card.querySelector('[data-job-invoice]')?.value.trim() || '';
      const xeroReference = card.querySelector('[data-job-xero]')?.value.trim() || '';
      const jobStatus = card.querySelector('[data-job-status]')?.value || job.jobStatus || 'Received';
      const emailUrl = card.querySelector('[data-job-email-url]')?.value.trim() || '';
      const payload = {
        jobReference: job.ref,
        client: job.client,
        site: job.site,
        engineer: job.engineer,
        plannedDate: job.date,
        cardType: job.cardType,
        description: job.description,
        jobStatus,
        jobRevision: Number(job.revision || 1),
        previousRecordId: job.previousRecordId || '',
        invoiceNumber,
        xeroReference,
        xeroInvoiceId: job.xeroInvoiceId || '',
        xeroInvoiceStatus: job.xeroInvoiceStatus || '',
        xeroInvoiceUrl: job.xeroInvoiceUrl || '',
        xeroInvoiceTotal: job.xeroInvoiceTotal,
        xeroInvoiceAmountDue: job.xeroInvoiceAmountDue,
        xeroInvoiceCurrency: job.xeroInvoiceCurrency || '',
        xeroLastSyncedAt: job.xeroLastSyncedAt || '',
        jobEmailUrl: emailUrl,
        jobEmailMessageId: job.emailMessageId || '',
        updateReason: job.updateReason || '',
        accountNotes: job.accountNotes || ''
      };
      button.disabled = true;
      if (feedback) feedback.textContent = 'Saving…';
      try {
        await updateProtectedRecord({
          recordId: job.id,
          kind: 'job-cards',
          action: job.action || 'create_request',
          submittedAt: job.submittedAt || new Date().toISOString(),
          employeeName: job.employeeName || '',
          employeeEmail: job.employeeEmail || '',
          recordDate: job.recordDate || job.date,
          payload
        }, jobStatus);
        job.invoiceNumber = invoiceNumber;
        job.xeroReference = xeroReference;
        job.jobStatus = jobStatus;
        job.emailUrl = emailUrl;
        if (feedback) feedback.textContent = 'Saved to protected job history.';
        logNotification('Job card', `${job.ref || job.id} Accounts fields updated.`);
        renderJobs([...jobCardIndex.values()].filter((item) => item.remote), jobHistoryMeta);
      } catch (error) {
        if (feedback) feedback.textContent = error.message || 'Could not save Accounts fields.';
        button.disabled = false;
      }
    });
    $('#job-card-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const jobs = store.get(keys.jobs, []);
      const imageFile = $('#job-image')?.files?.[0] || null;
      const revisionSource = jobCardRevisionSource;
      const job = {
        id: id(), ref: $('#job-ref').value.trim(), client: $('#job-client').value.trim(), site: $('#job-site').value.trim(), engineer: $('#job-engineer').value.trim(), date: $('#job-date').value, description: $('#job-description').value.trim(), cardType: $('#job-card-type').value, status: 'Received', jobStatus: 'Received', revision: revisionSource ? Number(revisionSource.revision || 1) + 1 : 1, previousRecordId: revisionSource?.id || '',
        emailUrl: $('#job-email-link')?.value.trim() || '', emailMessageId: $('#job-email-message-id')?.value.trim() || ''
      };
      jobs.unshift(job);
      store.set(keys.jobs, jobs);
      // Every submitted revision gets a new protected record. The job reference
      // still groups the chain, while this ID prevents an update from replacing
      // the earlier card or its invoice trail.
      const recordId = `job-${job.ref || 'unreferenced'}-${job.id}`;
      const protectedRecord = {
        recordId,
        kind: 'job-cards',
        action: 'create_request',
        status: job.jobStatus,
        submittedAt: new Date().toISOString(),
        employeeName: portalProfileName(),
        employeeEmail: portalProfile().username || '',
        recordDate: job.date,
        payload: {
          jobReference: job.ref,
          client: job.client,
          site: job.site,
          engineer: job.engineer,
          plannedDate: job.date,
          cardType: job.cardType,
          description: job.description,
          jobStatus: job.jobStatus,
          jobRevision: job.revision,
          previousRecordId: job.previousRecordId,
          invoiceNumber: '',
          xeroReference: '',
          jobEmailUrl: job.emailUrl,
          jobEmailMessageId: job.emailMessageId,
          updateReason: ''
        }
      };
      try {
        await saveProtectedRecord(protectedRecord);
      } catch (error) {
        logNotification('Job card', `Job card could not be saved to protected history: ${error.message || 'service unavailable'}.`);
        renderJobs();
        return;
      }
      const sent = sendPortalFormSubmit('Job Card', {
        job_reference: job.ref,
        client: job.client,
        site_address: job.site,
        assigned_engineer: job.engineer,
        planned_date: job.date,
        card_type: job.cardType,
        status: job.jobStatus,
        description: job.description,
        record_id: recordId,
        job_status: job.jobStatus,
        job_revision: job.revision,
        previous_record_id: job.previousRecordId,
        job_email_url: job.emailUrl,
        job_email_message_id: job.emailMessageId,
        submitted_at: new Date().toISOString()
      }, { file: imageFile });
      try { await updateProtectedRecord(protectedRecord, sent ? 'Submitted' : 'Saved'); } catch (_) {}
      event.target.reset();
      jobCardRevisionSource = null;
      const revisionNotice = $('#job-revision-notice');
      if (revisionNotice) revisionNotice.textContent = '';
      prefillPortalIdentity();
      renderJobPreview();
      logNotification('Job card', sent
        ? `Job card ${job.ref || job.client || job.id} submitted for admin review.`
        : `Job card ${job.ref || job.client || job.id} stored locally only. It still needs an approved submission route.`);
      renderJobs();
      loadProtectedJobs();
    });
  }

  function bindTasks() {
    prefillTaskDate();
    $('#task-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = $('#task-form-status');
      if (!portalApiEnabled() || typeof window.GMTPortalApi.createTask !== 'function') {
        if (status) status.textContent = 'Task requests require the protected Microsoft 365 workflow, which is not configured.';
        return;
      }
      const payload = {
        title: $('#task-title').value.trim(),
        jobReference: $('#task-job-ref').value.trim(),
        requestedAssigneeUpn: $('#task-assignee').value.trim(),
        dueDate: $('#task-due').value,
        priority: $('#task-priority').value
      };
      if (!payload.title) {
        $('#task-title')?.focus();
        if (status) status.textContent = 'Enter a task title.';
        return;
      }
      if (!taskFormAttempt || JSON.stringify(taskFormAttempt.payload) !== JSON.stringify(payload)) {
        taskFormAttempt = { taskId: `task-${id()}`, actionId: `action-${id()}`, payload };
      }
      const button = event.submitter || event.target.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (status) status.textContent = 'Submitting this request to Microsoft 365…';
      try {
        await window.GMTPortalApi.createTask({ ...taskFormAttempt.payload, taskId: taskFormAttempt.taskId, actionId: taskFormAttempt.actionId });
        taskFormAttempt = null;
        event.target.reset();
        prefillPortalIdentity();
        if (status) status.textContent = 'Task request saved in Microsoft 365 as Pending approval.';
        logNotification('Task', `Task request submitted for Accounts approval: ${payload.title}.`);
        await loadProtectedTasks();
      } catch (error) {
        updateTaskConsentButton(error);
        if (status) status.textContent = `${error.message || 'The request could not be confirmed.'} Keep this form unchanged and submit again to retry the same action safely.`;
        await loadProtectedTasks();
      } finally {
        if (button) button.disabled = false;
      }
    });
    $('#task-board')?.addEventListener('click', async (event) => {
      const retry = event.target.closest('[data-task-retry]');
      const historyButton = event.target.closest('[data-task-history]');
      const button = event.target.closest('[data-task-action]');
      const card = event.target.closest('[data-task-card]');
      const task = card && taskIndex.get(String(card.dataset.taskCard));
      const status = $('#task-board-status');
      if (historyButton && task) {
        const content = card.querySelector('[data-task-history-content]');
        const expanded = historyButton.getAttribute('aria-expanded') === 'true';
        historyButton.setAttribute('aria-expanded', String(!expanded));
        if (!content) return;
        content.hidden = expanded;
        if (expanded) return;
        content.innerHTML = '<p class="small-text">Loading Microsoft 365 task history…</p>';
        try {
          const history = await window.GMTPortalApi.taskHistory(task.taskId);
          const events = Array.isArray(history?.events) ? history.events : [];
          content.innerHTML = events.length ? `<ol>${events.map((item) => `<li><strong>${safe(item.action)}</strong> · ${safe(item.actorName || item.actorUpn)} · ${safe(item.createdAt || '')}${item.reason ? `<p>${safe(item.reason)}</p>` : ''}</li>`).join('')}</ol>` : '<p class="small-text">No workflow actions are recorded.</p>';
        } catch (error) {
          content.textContent = error.message || 'Task history is unavailable.';
        }
        return;
      }
      if (!task || (!retry && !button)) return;
      if (!portalApiEnabled() || typeof window.GMTPortalApi.actOnTask !== 'function') {
        if (status) status.textContent = 'The protected Microsoft 365 task workflow is not configured.';
        return;
      }
      const actionId = retry ? retry.dataset.taskRetry : `action-${id()}`;
      let actionBody;
      if (retry) {
        actionBody = { actionId, action: 'retry' };
      } else {
        const action = button.dataset.taskAction;
        actionBody = { actionId, action };
        if (action === 'transition') actionBody.status = button.dataset.taskNext;
        if (['approve', 'assign', 'schedule'].includes(action)) {
          const assignee = card.querySelector('[data-task-assignee]');
          const dueDate = card.querySelector('[data-task-due]');
          const priority = card.querySelector('[data-task-priority]');
          if (assignee) actionBody.assigneeUpn = assignee.value;
          if (dueDate) actionBody.dueDate = dueDate.value;
          if (priority) actionBody.priority = priority.value;
        }
        const reasonKind = action === 'cancel' ? 'cancel' : (action === 'approve' || action === 'reject' ? 'decision' : '');
        const reason = reasonKind ? card.querySelector(`[data-task-reason="${reasonKind}"]`) : null;
        if (reason) actionBody.reason = reason.value.trim();
      }
      const actionButton = retry || button;
      actionButton.disabled = true;
      if (status) status.textContent = retry ? 'Retrying the same Microsoft 365 update…' : 'Saving task action in Microsoft 365…';
      try {
        await window.GMTPortalApi.actOnTask(task.taskId, actionBody);
        if (retry && taskFormAttempt && taskFormAttempt.taskId === task.taskId) {
          taskFormAttempt = null;
          $('#task-form')?.reset();
          prefillPortalIdentity();
        }
        logNotification('Task', `Task ${task.title} updated: ${actionBody.action}.`);
        await loadProtectedTasks();
        if (status) status.textContent = 'Task update confirmed by Microsoft 365.';
      } catch (error) {
        updateTaskConsentButton(error);
        if (status) status.textContent = `${error.message || 'Task update could not be confirmed.'}${error.operationId ? ` Retry action ${error.operationId} from the task card.` : ''}`;
        await loadProtectedTasks();
      }
    });
    $('#task-connect-button')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = $('#task-board-status');
      button.disabled = true;
      if (status) status.textContent = 'Connecting to Microsoft 365 task access…';
      try {
        await window.GMTPortalApi.connectTaskWorkflow();
        await loadProtectedTasks();
      } catch (error) {
        if (status) status.textContent = error.message || 'Microsoft 365 task access could not be connected.';
        updateTaskConsentButton({ status: 401 });
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindOrg() {
    $('#org-logo')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { const org = store.get(keys.org, {}); org.logo = reader.result; store.set(keys.org, org); renderOrg(); };
      reader.readAsDataURL(file);
    });
    $('#org-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const org = store.get(keys.org, {});
      org.currentName = $('#org-current-name').value.trim();
      org.requestedName = $('#org-request-name').value.trim();
      org.adminEmail = $('#org-admin-email').value.trim();
      store.set(keys.org, org);
      logNotification('Organization', 'Organization settings updated.');
      renderOrg();
    });
  }

  function bindNotifications() {
    $('#notification-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const settings = { login: $('#notify-login').checked, task: $('#notify-task').checked, timesheet: $('#notify-timesheet').checked, jobCard: $('#notify-job-card').checked, critical: $('#notify-critical').checked };
      store.set(keys.notifications, settings);
      logNotification('Notifications', 'Notification settings updated.');
      renderNotifications();
    });
  }

  function icsText(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function ymd(date) {
    return String(date || '').replace(/-/g, '');
  }

  function nextDay(date) {
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function exportCalendarIcs() {
    logNotification('Calendar', 'Calendar export is unavailable until the protected Microsoft 365 calendar feed is connected.');
  }

  function bindCalendar() {
    $('#calendar-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const events = store.get(keys.calendar, []);
      const type = $('#calendar-type').value;
      const editingId = $('#calendar-edit-id')?.value.trim() || '';
      const previous = editingId ? events.find((item) => String(item.id || item.recordId) === editingId) : null;
      const entryId = editingId || id();
      const entry = { id: entryId, title: $('#calendar-title').value.trim(), date: $('#calendar-date').value, type, owner: $('#calendar-owner').value.trim(), notes: $('#calendar-notes').value.trim(), status: 'Pending approval', requestedBy: previous?.requestedBy || portalProfileName(), recordId: previous?.recordId || `calendar-${entryId}` };
      if (!entry.title || !entry.date) return;
      const existingIndex = events.findIndex((item) => String(item.id || item.recordId) === String(entry.id));
      if (existingIndex >= 0) events[existingIndex] = entry;
      else events.push(entry);
      store.set(keys.calendar, events);
      const protectedRecord = {
        recordId: entry.recordId,
        kind: 'calendar',
        action: previous ? 'update_request' : 'create_request',
        status: entry.status,
        submittedAt: new Date().toISOString(),
        employeeName: entry.requestedBy,
        employeeEmail: portalProfile().username || '',
        recordDate: entry.date,
        payload: { title: entry.title, date: entry.date, type: entry.type, owner: entry.owner, notes: entry.notes }
      };
      try { await saveProtectedRecord(protectedRecord); } catch (error) {
        logNotification('Calendar', `Calendar request could not be saved to protected history: ${error.message || 'service unavailable'}.`);
        renderCalendar();
        return;
      }
      event.target.reset();
      prefillPortalIdentity();
      const sent = sendPortalFormSubmit(previous ? 'Calendar Update' : 'Calendar Request', {
        event_id: entry.id,
        event_title: entry.title,
        event_date: entry.date,
        event_type: entry.type,
        owner_or_requester: entry.owner,
        requested_by: entry.requestedBy,
        requested_by_upn: portalProfile().username || '',
        status: entry.status,
        notes: entry.notes,
        submitted_at: new Date().toISOString()
      });
      try { await updateProtectedRecord(protectedRecord, sent ? 'Submitted' : 'Saved'); } catch (_) {}
      logNotification('Calendar', sent
        ? `${previous ? 'Calendar update' : 'Calendar request'} submitted for accounts approval: ${entry.title}.`
        : `${previous ? 'Calendar update' : 'Calendar request'} stored locally only. It still needs an approved submission route: ${entry.title}.`);
      renderCalendar();
      $('#calendar-edit-id').value = '';
      $('#calendar-submit-button').textContent = 'Submit calendar request';
      $('#calendar-cancel-edit').hidden = true;
    });
    $('#calendar-list')?.addEventListener('click', async (event) => {
      const edit = event.target.closest('[data-calendar-edit]');
      const del = event.target.closest('[data-calendar-delete]');
      const events = store.get(keys.calendar, []);
      if (edit) {
        const item = calendarIndex.get(String(edit.dataset.calendarEdit));
        if (item) {
          $('#calendar-edit-id').value = String(item.id || item.recordId);
          $('#calendar-title').value = item.title || '';
          $('#calendar-date').value = item.date || '';
          $('#calendar-type').value = item.type || 'General';
          $('#calendar-owner').value = item.owner || '';
          $('#calendar-notes').value = item.notes || '';
          $('#calendar-submit-button').textContent = 'Save calendar update';
          $('#calendar-cancel-edit').hidden = false;
          $('#calendar-title').focus();
        }
        return;
      }
      if (del) {
        const item = calendarIndex.get(String(del.dataset.calendarDelete)) || events.find((entry) => String(entry.id || entry.recordId) === String(del.dataset.calendarDelete));
        if (item) {
          sendPortalFormSubmit('Calendar Update', { event_id: item.id, event_title: item.title, event_date: item.date, event_type: item.type, owner_or_requester: item.owner, requested_by: item.requestedBy || portalProfileName(), requested_by_upn: portalProfile().username || '', status: 'Cancelled', notes: item.notes, updated_at: new Date().toISOString() });
          try {
            await updateProtectedRecord({
              recordId: item.recordId || `calendar-${item.id}`,
              kind: 'calendar',
              action: 'update_request',
              employeeName: item.requestedBy || portalProfileName(),
              employeeEmail: portalProfile().username || '',
              recordDate: item.date,
              payload: { title: item.title, date: item.date, type: item.type, owner: item.owner, notes: item.notes }
            }, 'Cancelled');
          } catch (_) {}
        }
        store.set(keys.calendar, events.filter((entry) => entry.id !== del.dataset.calendarDelete));
        logNotification('Calendar', 'Calendar request cancelled.');
      }
      renderCalendar();
    });
    $('#calendar-cancel-edit')?.addEventListener('click', () => {
      $('#calendar-form').reset();
      $('#calendar-edit-id').value = '';
      $('#calendar-submit-button').textContent = 'Submit calendar request';
      $('#calendar-cancel-edit').hidden = true;
      prefillPortalIdentity();
    });
    $('#export-ics-btn')?.addEventListener('click', exportCalendarIcs);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.GMTPayPeriods && window.GMTPayPeriods.ready) await window.GMTPayPeriods.ready;
    bindTabs(); bindJobs(); bindTasks(); bindOrg(); bindNotifications(); bindCalendar();
    renderJobs(); renderTasks(); renderOrg(); renderNotifications(); renderCalendar();
    prefillPortalIdentity();
    loadProtectedJobs().finally(() => loadJobCardArchive());
    loadProtectedTasks();
  });
  window.addEventListener('beforeunload', () => {
    if (selectedJobCardArchiveContentUrl) URL.revokeObjectURL(selectedJobCardArchiveContentUrl);
  });
  document.addEventListener('gmtportalidentity', prefillPortalIdentity);
  document.addEventListener('gmtportalprofile', prefillPortalIdentity);
})();
