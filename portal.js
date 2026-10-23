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
  let pendingJobCardSubmission = null;
  let jobCardAttachmentRequestId = 0;
  const jobCardAttachmentObjectUrls = new Set();
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

  async function updateProtectedRecord(record, status, issue = '', updatedAt = new Date().toISOString()) {
    if (!portalApiEnabled()) return false;
    await window.GMTPortalApi.updateRecord(record.recordId, { ...record, status, issue, updatedAt });
    return true;
  }

  function dateParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})/);
    return match ? { year: match[1], month: match[2] } : { year: '', month: '' };
  }

  function prefillPortalIdentity() {
    const name = portalProfileName();
    if (!name) return;
    ['#job-engineer', '#task-assignee', '#calendar-owner'].forEach((selector) => {
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
      logNotification(kind, `${kind} was not submitted because FormSubmit is not configured.`);
      return false;
    }
    ensurePortalSubmitFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = endpoint;
    form.target = 'portal-formsubmit-frame';
    form.enctype = 'multipart/form-data';
    form.hidden = true;
    const submittedAt = fields.submitted_at || fields.updated_at || new Date().toISOString();

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
      if (fields.updated_at) add('gmt_updated_at', fields.updated_at);
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

  function releaseJobCardAttachmentUrls() {
    jobCardAttachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    jobCardAttachmentObjectUrls.clear();
  }

  function formatJobCardAttachmentSize(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function loadJobCardAttachments(job) {
    const requestId = ++jobCardAttachmentRequestId;
    const host = document.querySelector('[data-job-card-attachments]');
    if (!host || !job?.remote || !window.GMTPortalApi?.jobCardRecordAttachments) return;
    host.innerHTML = '<p class="small-text">Loading protected attachments…</p>';
    try {
      const result = await window.GMTPortalApi.jobCardRecordAttachments(job.id);
      if (requestId !== jobCardAttachmentRequestId || selectedJobId !== String(job.id || '')) return;
      const attachments = Array.isArray(result?.attachments) ? result.attachments : [];
      if (!attachments.length) {
        host.innerHTML = '<p class="small-text">No attachments are saved with this job-card revision.</p>';
        return;
      }
      host.innerHTML = `<h4>Protected attachments (${attachments.length})</h4><ul class="job-card-attachment-list">${attachments.map((attachment) => `<li class="job-card-attachment-row" data-job-attachment-row>
        <div><strong>${safe(attachment.file_name || 'Attachment')}</strong><small>${safe(attachment.content_type || 'File')} · ${formatJobCardAttachmentSize(attachment.size_bytes)} · ${safe(attachment.uploaded_at || '')}</small></div>
        <button type="button" class="secondary" data-job-attachment-open="${safe(attachment.attachment_id)}" data-job-attachment-record="${safe(job.id)}" data-job-attachment-name="${safe(attachment.file_name || 'attachment')}" data-job-attachment-type="${safe(attachment.content_type || '')}">Load file</button>
        <span class="small-text" data-job-attachment-feedback role="status"></span><div data-job-attachment-preview></div>
      </li>`).join('')}</ul>`;
    } catch (error) {
      if (requestId !== jobCardAttachmentRequestId || selectedJobId !== String(job.id || '')) return;
      host.innerHTML = `<p class="small-text">Protected attachments could not be loaded: ${safe(error?.message || 'Please try again.')}</p>`;
    }
  }

  function renderJobHistoryPreview(job) {
    const preview = $('#job-card-history-preview');
    if (!preview) return;
    jobCardAttachmentRequestId += 1;
    releaseJobCardAttachmentUrls();
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
      ${job.remote ? `<section class="job-card-attachments" data-job-card-attachments aria-label="Attachments for ${safe(job.ref || 'job card')}"><p class="small-text">Loading protected attachments…</p></section>` : ''}
      <div class="portal-item-actions"><button type="button" class="secondary" data-job-revise="${safe(job.id)}">Create revision</button></div>
      ${accountFields}`;
    if (job.remote) loadJobCardAttachments(job);
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

  function renderTasks(remoteTasks = []) {
    const tasks = Array.isArray(remoteTasks) ? remoteTasks : [];
    const board = $('#task-board');
    if (!board) return;
    board.innerHTML = tasks.length ? tasks.map(renderTask).join('') : '<p class="small-text">No task requests are available.</p>';
  }

  function renderTask(task) {
    return `<article class="task-card">
      <h4>${safe(task.title)}</h4>
      <p class="portal-item-meta">${safe(task.jobRef || 'No job ref')} · ${safe(task.assignee || 'Unassigned')}</p>
      <p class="portal-item-meta">Due: ${safe(task.due || 'No due date')} · Priority: <span class="portal-status ${task.priority.toLowerCase()}">${safe(task.priority)}</span></p>
      <p class="portal-item-meta"><strong>Status:</strong> ${safe(task.status || 'Pending approval')}</p>
      <p class="small-text">Approval and task status are managed in Microsoft 365.</p>
    </article>`;
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

  function calendarRequestStatus(status) {
    const value = String(status || 'Pending approval').trim();
    return ['submitted', 'saved'].includes(value.toLowerCase()) ? 'Pending approval' : value;
  }

  function calendarStatusMessage(status) {
    const value = calendarRequestStatus(status);
    switch (value.toLowerCase()) {
      case 'pending approval': return 'Awaiting licensed accounts approval.';
      case 'cancelled': return 'Cancellation recorded in portal history; Microsoft 365 processing is not confirmed.';
      case 'approved': return 'Approved in portal history; shared-calendar publication is shown in the published feed.';
      case 'rejected': return 'Request marked rejected in portal history.';
      default: return `Status is recorded as ${value}; publication is not confirmed.`;
    }
  }

  function renderCalendar() {
    const uniqueEvents = new Map();
    store.get(keys.calendar, []).forEach((event) => {
      const key = String(event.recordId || event.id || '');
      const current = uniqueEvents.get(key);
      if (!current) uniqueEvents.set(key, event);
      else if (calendarRequestStatus(current.status).toLowerCase() === 'pending approval'
        && calendarRequestStatus(event.status).toLowerCase() === 'cancelled') uniqueEvents.set(key, event);
    });
    const events = [...uniqueEvents.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const list = $('#calendar-list');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<p class="small-text">No calendar events yet.</p>';
      return;
    }
    calendarIndex.clear();
    events.forEach((event) => {
      event.status = calendarRequestStatus(event.status);
      calendarIndex.set(String(event.id || event.recordId), event);
    });
    store.set(keys.calendar, events);
    list.innerHTML = events.map((event) => `
      <article class="portal-item calendar-date-group">
        <strong>${safe(event.date)} · ${safe(event.title)}</strong>
        <span class="portal-status ${event.status.toLowerCase()}">${safe(event.status)}</span>
        <p class="portal-item-meta">${safe(event.type)} · ${safe(event.owner || 'No owner')}</p>
        <p>${safe(event.notes || 'No notes')}</p>
        <div class="portal-item-actions">
          <span class="small-text">${safe(calendarStatusMessage(event.status))}</span>
          ${event.status === 'Pending approval' ? `<button type="button" class="secondary" data-calendar-edit="${event.id}">Edit</button>` : ''}
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
    if (!portalApiEnabled()) {
      board.innerHTML = '<p class="small-text" role="status">Protected task history is unavailable in this session.</p>';
      return;
    }
    board.innerHTML = '<p class="small-text" role="status">Loading protected task requests…</p>';
    try {
      const body = await window.GMTPortalApi.history('tasks');
      const remoteTasks = (body && Array.isArray(body.records) ? body.records : []).map((record) => ({
        id: record.source_record_id,
        title: record.task_title || 'Untitled task',
        jobRef: record.job_reference || '',
        assignee: record.assignee || '',
        due: record.due_date || record.record_date || '',
        priority: record.priority || 'Normal',
        status: ['Submitted', 'Saved'].includes(record.status) ? 'Pending approval' : (record.status || 'Pending approval'),
        recordId: record.source_record_id,
        employeeName: record.employee_name || ''
      }));
      renderTasks(remoteTasks);
    } catch (_) {
      const board = $('#task-board');
      if (board) board.innerHTML = '<p class="small-text" role="status">Task requests are unavailable because protected history could not be loaded.</p>';
    }
  }

  async function loadProtectedCalendar() {
    if (!$('#calendar-form') || !portalApiEnabled()) return;
    try {
      const body = await window.GMTPortalApi.history('calendar');
      const remoteEvents = (body && Array.isArray(body.records) ? body.records : []).map((record) => ({
        id: record.source_record_id,
        title: record.event_title || 'Untitled event',
        date: record.event_date || record.record_date || '',
        type: record.event_type || 'General',
        owner: record.owner || record.employee_name || '',
        notes: record.notes || '',
        status: calendarRequestStatus(record.status),
        requestedBy: record.employee_name || '',
        recordId: record.source_record_id,
        submittedAt: record.submitted_at || '',
        updatedAt: record.updated_at || ''
      }));
      const localEvents = store.get(keys.calendar, []);
      const remoteRecordIds = new Set(remoteEvents.map((remote) => String(remote.recordId || remote.id)));
      store.set(keys.calendar, [...remoteEvents, ...localEvents.filter((local) => !remoteRecordIds.has(String(local.recordId || local.id)))]);
      renderCalendar();
    } catch (_) {
      // Local calendar requests remain visible if the protected service is unavailable.
    }
  }

  const JOB_CARD_ATTACHMENT_MIME_TYPES = {
    pdf: 'application/pdf', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
    jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
  };

  function jobCardAttachmentFilenameError(fileName) {
    const name = String(fileName || '');
    if (!name || name !== name.trim() || /["*:<>?\/\\|\u0000-\u001f\u007f]/.test(name)) {
      return `${name || 'This file'} has a filename SharePoint cannot store. Remove characters such as ", *, :, <, >, ?, /, \\, or |, and remove leading or trailing spaces.`;
    }
    return '';
  }

  function jobCardQuickXorHash(bytes) {
    const block = new Uint8Array(20);
    let bitOffset = 0;
    for (let offset = 0; offset < bytes.length; offset += 1) {
      const value = bytes[offset];
      const byteIndex = Math.floor(bitOffset / 8);
      const shift = bitOffset % 8;
      block[byteIndex] ^= (value << shift) & 0xff;
      if (shift > 0) block[(byteIndex + 1) % block.length] ^= value >>> (8 - shift);
      bitOffset = (bitOffset + 11) % 160;
    }
    let length = BigInt(bytes.length);
    for (let index = 0; index < 8; index += 1) {
      block[12 + index] ^= Number(length & 0xffn);
      length >>= 8n;
    }
    return btoa(Array.from(block, (byte) => String.fromCharCode(byte)).join(''));
  }

  async function jobCardAttachmentMetadata(file) {
    const filenameError = jobCardAttachmentFilenameError(file?.name);
    if (filenameError) throw new Error(filenameError);
    const extension = String(file?.name || '').split('.').pop().toLowerCase();
    const contentType = JOB_CARD_ATTACHMENT_MIME_TYPES[extension] || '';
    const browserType = String(file?.type || '').toLowerCase();
    if (!contentType || (browserType && browserType !== 'application/octet-stream' && browserType !== contentType)) throw new Error(`${file?.name || 'This file'} must be a supported image or PDF with a matching file type.`);
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(`${file.name} must be 20 MiB or smaller.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { fileName: file.name, contentType, sizeBytes: file.size, sha256, quickXorHash: jobCardQuickXorHash(bytes) };
  }

  async function uploadPendingJobCardAttachments(pending, status) {
    if (!pending.files.length) return;
    if (!portalApiEnabled() || !window.GMTPortalApi?.startJobCardRecordAttachment || !window.GMTPortalApi?.uploadJobCardRecordAttachment) {
      throw new Error('Protected attachment upload is unavailable. Keep this form open and try again when the portal connection is restored.');
    }
    while (pending.nextAttachmentIndex < pending.files.length) {
      const index = pending.nextAttachmentIndex;
      const file = pending.files[index];
      if (status) status.textContent = `Preparing ${file.name} (${index + 1} of ${pending.files.length})…`;
      const metadata = pending.metadata[index] || await jobCardAttachmentMetadata(file);
      pending.metadata[index] = metadata;
      let session = pending.sessions[index];
      if (!session || !session.attachmentId || Date.parse(session.expirationDateTime) <= Date.now() + 5000) {
        session = await window.GMTPortalApi.startJobCardRecordAttachment(pending.recordId, metadata);
        if (session?.attachment?.attachment_id) {
          pending.nextAttachmentIndex += 1;
          continue;
        }
        if (!session?.attachmentId) throw new Error('The protected attachment upload reservation was not returned.');
        pending.sessions[index] = session;
      }
      if (status) status.textContent = `Uploading ${file.name} (${index + 1} of ${pending.files.length})…`;
      await window.GMTPortalApi.uploadJobCardRecordAttachment(pending.recordId, session.attachmentId, file, metadata.contentType);
      pending.sessions[index] = null;
      pending.nextAttachmentIndex += 1;
    }
  }

  async function continueJobCardSubmission(pending, form, button, status) {
    button.disabled = true;
    if (pending.files.length && !portalApiEnabled()) throw new Error('Sign in to the protected portal before adding job-card attachments.');
    if (status) status.textContent = pending.saved ? 'Resuming the saved job card…' : 'Saving job card to protected history…';
    if (!pending.saved) pending.saved = await saveProtectedRecord(pending.protectedRecord);
    await uploadPendingJobCardAttachments(pending, status);
    const job = pending.job;
    const sent = sendPortalFormSubmit('Job Card', {
      job_reference: job.ref,
      client: job.client,
      site_address: job.site,
      assigned_engineer: job.engineer,
      planned_date: job.date,
      card_type: job.cardType,
      status: job.jobStatus,
      description: job.description,
      record_id: pending.recordId,
      job_status: job.jobStatus,
      job_revision: job.revision,
      previous_record_id: job.previousRecordId,
      job_email_url: job.emailUrl,
      job_email_message_id: job.emailMessageId,
      submitted_at: new Date().toISOString()
    }, { file: pending.files[0] || null });
    if (pending.saved) {
      try { await updateProtectedRecord(pending.protectedRecord, sent ? 'Submitted' : 'Saved'); } catch (_) {}
    }
    const jobs = store.get(keys.jobs, []);
    jobs.unshift(job);
    store.set(keys.jobs, jobs);
    form.reset();
    pendingJobCardSubmission = null;
    jobCardRevisionSource = null;
    if (status) status.textContent = '';
    button.textContent = 'Create job card';
    button.disabled = false;
    const revisionNotice = $('#job-revision-notice');
    if (revisionNotice) revisionNotice.textContent = '';
    prefillPortalIdentity();
    renderJobPreview();
    logNotification('Job card', sent
      ? `Job card ${job.ref || job.client || job.id} submitted for admin review.`
      : `Job card ${job.ref || job.client || job.id} stored locally only. It still needs an approved submission route.`);
    renderJobs();
    loadProtectedJobs();
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
      const attachmentButton = event.target.closest('[data-job-attachment-open]');
      if (attachmentButton && window.GMTPortalApi?.fetchJobCardRecordAttachment) {
        const row = attachmentButton.closest('[data-job-attachment-row]');
        const feedback = row?.querySelector('[data-job-attachment-feedback]');
        const preview = row?.querySelector('[data-job-attachment-preview]');
        const recordId = attachmentButton.dataset.jobAttachmentRecord || '';
        const attachmentId = attachmentButton.dataset.jobAttachmentOpen || '';
        const fileName = attachmentButton.dataset.jobAttachmentName || 'job-card-attachment';
        const contentType = attachmentButton.dataset.jobAttachmentType || '';
        if (!row || !preview || !recordId || !attachmentId || recordId !== selectedJobId) return;
        attachmentButton.disabled = true;
        if (feedback) feedback.textContent = 'Loading protected file…';
        try {
          const blob = await window.GMTPortalApi.fetchJobCardRecordAttachment(recordId, attachmentId);
          if (recordId !== selectedJobId || !row.isConnected) return;
          const objectUrl = URL.createObjectURL(blob);
          jobCardAttachmentObjectUrls.add(objectUrl);
          const downloadLink = `<a href="${safe(objectUrl)}" download="${safe(fileName)}">Download ${safe(fileName)}</a>`;
          preview.innerHTML = `${contentType.startsWith('image/') ? `<img class="job-card-attachment-image" src="${safe(objectUrl)}" alt="${safe(fileName)}">` : ''}<p>${contentType === 'application/pdf' ? `<a href="${safe(objectUrl)}" target="_blank" rel="noopener">Open PDF: ${safe(fileName)}</a>` : downloadLink}</p>`;
          if (feedback) feedback.textContent = 'Protected file loaded.';
          attachmentButton.textContent = 'Loaded';
        } catch (error) {
          if (feedback) feedback.textContent = error.message || 'Protected file could not be opened.';
          attachmentButton.disabled = false;
        }
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
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const status = $('#job-attachment-status');
      if (pendingJobCardSubmission) {
        try {
          await continueJobCardSubmission(pendingJobCardSubmission, form, button, status);
          form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = false; });
        } catch (error) {
          if (status) status.textContent = `The saved job card is waiting for completion: ${error.message || 'Please retry.'} The same record will be used when you retry.`;
          if (button) { button.disabled = false; button.textContent = 'Retry saved job card'; }
          form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = true; });
        }
        return;
      }

      const files = Array.from($('#job-image')?.files || []);
      const totalBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      if (files.length > 10 || files.some((file) => !file.size || file.size > 20 * 1024 * 1024) || totalBytes > 100 * 1024 * 1024) {
        if (status) status.textContent = 'Choose at most 10 files, 20 MiB each and 100 MiB total per job-card revision.';
        return;
      }
      const invalidFilename = files.find((file) => jobCardAttachmentFilenameError(file.name));
      if (invalidFilename) {
        if (status) status.textContent = jobCardAttachmentFilenameError(invalidFilename.name);
        return;
      }
      const unsupported = files.find((file) => {
        const extension = String(file.name || '').split('.').pop().toLowerCase();
        const expected = JOB_CARD_ATTACHMENT_MIME_TYPES[extension] || '';
        const browserType = String(file.type || '').toLowerCase();
        return !expected || (browserType && browserType !== 'application/octet-stream' && browserType !== expected);
      });
      if (unsupported) {
        if (status) status.textContent = `${unsupported.name} is not a supported image or PDF with a matching file type.`;
        return;
      }
      if (files.length && !portalApiEnabled()) {
        if (status) status.textContent = 'Sign in to the protected portal before adding job-card attachments.';
        return;
      }

      const revisionSource = jobCardRevisionSource;
      const job = {
        id: id(), ref: $('#job-ref').value.trim(), client: $('#job-client').value.trim(), site: $('#job-site').value.trim(), engineer: $('#job-engineer').value.trim(), date: $('#job-date').value, description: $('#job-description').value.trim(), cardType: $('#job-card-type').value, status: 'Received', jobStatus: 'Received', revision: revisionSource ? Number(revisionSource.revision || 1) + 1 : 1, previousRecordId: revisionSource?.id || '',
        emailUrl: $('#job-email-link')?.value.trim() || '', emailMessageId: $('#job-email-message-id')?.value.trim() || ''
      };
      // Every submitted revision gets a new protected record. The job reference
      // groups the chain, while this ID keeps each revision's attachments separate.
      const recordId = `job-${job.ref || 'unreferenced'}-${job.id}`;
      job.id = recordId;
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
      pendingJobCardSubmission = { job, protectedRecord, recordId, files, metadata: [], sessions: [], nextAttachmentIndex: 0, saved: false };
      form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = true; });
      try {
        await continueJobCardSubmission(pendingJobCardSubmission, form, button, status);
        form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = false; });
      } catch (error) {
        if (status) status.textContent = `The job card is waiting for completion: ${error.message || 'Please retry.'} The same record will be used when you retry.`;
        if (button) { button.disabled = false; button.textContent = 'Retry saved job card'; }
        form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = true; });
      }
    });
  }

  function bindTasks() {
    prefillTaskDate();
    $('#task-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const taskId = `task-${id()}`;
      const submittedAt = new Date().toISOString();
      const task = { id: taskId, recordId: taskId, title: $('#task-title').value.trim(), jobRef: $('#task-job-ref').value.trim(), assignee: $('#task-assignee').value.trim(), due: $('#task-due').value, priority: $('#task-priority').value, status: 'Pending approval', requestedBy: portalProfileName() };
      if (!task.title) return;
      const protectedRecord = {
        recordId: task.recordId,
        kind: 'tasks',
        action: 'create_request',
        status: task.status,
        submittedAt,
        employeeName: task.requestedBy,
        employeeEmail: portalProfile().username || '',
        recordDate: task.due,
        payload: { title: task.title, jobReference: task.jobRef, assignee: task.assignee, due: task.due, priority: task.priority }
      };
      let protectedSaved = false;
      try { protectedSaved = await saveProtectedRecord(protectedRecord); } catch (error) {
        logNotification('Task', `Task could not be saved to protected history: ${error.message || 'service unavailable'}.`);
        renderTasks();
        return;
      }
      event.target.reset();
      prefillPortalIdentity();
      const sent = sendPortalFormSubmit('Task', {
        task_title: task.title,
        task_id: task.recordId,
        job_reference: task.jobRef,
        assigned_to: task.assignee,
        due_date: task.due,
        priority: task.priority,
        status: task.status,
        requested_by: task.requestedBy,
        requested_by_upn: portalProfile().username || '',
        submitted_at: submittedAt
      });
      logNotification('Task', protectedSaved
        ? (sent
          ? `Task request saved for Accounts review. Email submission attempted; delivery is not confirmed: ${task.title}.`
          : `Task request saved for Accounts review. No email route is configured: ${task.title}.`)
        : (sent
          ? `Task email submission attempted, but protected history was unavailable. Delivery is not confirmed: ${task.title}.`
          : `Task request was not saved or emailed because no protected service or email route is configured: ${task.title}.`));
      loadProtectedTasks();
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
      const submittedAt = previous?.submittedAt || new Date().toISOString();
      const updatedAt = previous ? new Date().toISOString() : '';
      const entry = { id: entryId, title: $('#calendar-title').value.trim(), date: $('#calendar-date').value, type, owner: $('#calendar-owner').value.trim(), notes: $('#calendar-notes').value.trim(), status: 'Pending approval', requestedBy: previous?.requestedBy || portalProfileName(), recordId: previous?.recordId || `calendar-${entryId}`, submittedAt, ...(previous ? { updatedAt } : {}) };
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
        submittedAt,
        ...(previous ? { updatedAt } : {}),
        employeeName: entry.requestedBy,
        employeeEmail: portalProfile().username || '',
        recordDate: entry.date,
        payload: { title: entry.title, date: entry.date, type: entry.type, owner: entry.owner, notes: entry.notes }
      };
      let protectedSaved = false;
      try { protectedSaved = await saveProtectedRecord(protectedRecord); } catch (error) {
        logNotification('Calendar', `Calendar request could not be saved to protected history: ${error.message || 'service unavailable'}.`);
        renderCalendar();
        return;
      }
      event.target.reset();
      prefillPortalIdentity();
      const sent = sendPortalFormSubmit(previous ? 'Calendar Update' : 'Calendar Request', {
        event_id: entry.recordId,
        event_title: entry.title,
        event_date: entry.date,
        event_type: entry.type,
        owner_or_requester: entry.owner,
        requested_by: entry.requestedBy,
        requested_by_upn: portalProfile().username || '',
        status: entry.status,
        notes: entry.notes,
        submitted_at: submittedAt,
        ...(previous ? { updated_at: updatedAt } : {})
      });
      const requestLabel = previous ? 'Calendar update' : 'Calendar request';
      logNotification('Calendar', protectedSaved
        ? (sent
          ? `${requestLabel} saved for Accounts review. Email submission attempted; delivery is not confirmed: ${entry.title}.`
          : `${requestLabel} saved for Accounts review. No email route is configured: ${entry.title}.`)
        : (sent
          ? `${requestLabel} email submission attempted, but protected history was unavailable. Delivery is not confirmed: ${entry.title}.`
          : `${requestLabel} was not saved or emailed because no protected service or email route is configured: ${entry.title}.`));
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
        const item = events.find((entry) => [entry.id, entry.recordId].some((value) => String(value || '') === String(del.dataset.calendarDelete))) || calendarIndex.get(String(del.dataset.calendarDelete));
        if (!item || item.status !== 'Pending approval') {
          logNotification('Calendar', 'Only a pending calendar request can be cancelled.');
          return;
        }
        const recordId = item.recordId || `calendar-${item.id}`;
        try {
          let submittedAt = item.submittedAt || item.submitted_at || '';
          if (!submittedAt && portalApiEnabled() && typeof window.GMTPortalApi.getRecord === 'function') {
            const response = await window.GMTPortalApi.getRecord(recordId);
            submittedAt = response?.record?.submitted_at || response?.record?.submittedAt || '';
          }
          if (!submittedAt) throw new Error('Original submission time is unavailable. Refresh the calendar requests and try again.');
          const updatedAt = new Date().toISOString();
          const saved = await updateProtectedRecord({
            recordId,
            kind: 'calendar',
            action: 'update_request',
            employeeName: item.requestedBy || portalProfileName(),
            employeeEmail: portalProfile().username || '',
            recordDate: item.date,
            payload: { title: item.title, date: item.date, type: item.type, owner: item.owner, notes: item.notes }
          }, 'Cancelled', '', updatedAt);
          if (!saved) throw new Error('Protected request service is unavailable.');
          const cancellationIds = new Set([del.dataset.calendarDelete, item.id, item.recordId].filter(Boolean).map(String));
          const updatedEvents = events.map((entry) => ([entry.id, entry.recordId].some((value) => cancellationIds.has(String(value || '')))
            ? { ...entry, status: 'Cancelled', updatedAt }
            : entry));
          if (!updatedEvents.some((entry) => [entry.id, entry.recordId].some((value) => cancellationIds.has(String(value || ''))))) {
            updatedEvents.push({ ...item, status: 'Cancelled', updatedAt });
          }
          store.set(keys.calendar, updatedEvents);
          const sent = sendPortalFormSubmit('Calendar Update', { event_id: recordId, event_title: item.title, event_date: item.date, event_type: item.type, owner_or_requester: item.owner, requested_by: item.requestedBy || portalProfileName(), requested_by_upn: portalProfile().username || '', status: 'Cancelled', notes: item.notes, submitted_at: submittedAt, updated_at: updatedAt });
          logNotification('Calendar', sent
            ? 'Cancellation saved for Accounts review. Email submission attempted; delivery is not confirmed.'
            : 'Cancellation saved in protected history, but no email route is configured. Accounts may still see the request as pending.');
        } catch (error) {
          logNotification('Calendar', 'Cancellation could not be saved; the request remains unchanged. ' + (error.message || 'Protected request service unavailable.'));
        }
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
    loadProtectedCalendar();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.GMTPayPeriods && window.GMTPayPeriods.ready) await window.GMTPayPeriods.ready;
    bindTabs(); bindJobs(); bindTasks(); bindOrg(); bindNotifications(); bindCalendar();
    renderJobs(); renderTasks(); renderOrg(); renderNotifications(); renderCalendar();
    prefillPortalIdentity();
    loadProtectedTasks();
    loadProtectedJobs().finally(() => loadJobCardArchive());
  });
  window.addEventListener('beforeunload', () => {
    if (selectedJobCardArchiveContentUrl) URL.revokeObjectURL(selectedJobCardArchiveContentUrl);
  });
  document.addEventListener('gmtportalidentity', () => { prefillPortalIdentity(); loadProtectedCalendar(); });
  document.addEventListener('gmtportalprofile', prefillPortalIdentity);
})();
