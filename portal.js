(() => {
  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  };

  const keys = {
    jobs: 'gmt_portal_job_cards_v1',
    tasks: 'gmt_portal_tasks_v1',
    org: 'gmt_portal_org_v1',
    notifications: 'gmt_portal_notifications_v1',
    calendar: 'gmt_portal_calendar_v1',
    log: 'gmt_portal_notification_log_v1'
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
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
  const calendarIndex = new Map();
  const jobCardIndex = new Map();
  let jobCardRevisionSource = null;

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
    ['#job-engineer', '#task-assignee', '#calendar-owner'].forEach((selector) => {
      const input = $(selector);
      if (input && !input.value.trim()) input.value = name;
    });
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
      ? recipientList(window.GMT_APP_CONFIG?.formSubmitCc, GMT_JOB_CARD_CC)
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

  function renderJobs(remoteJobs = [], meta = {}) {
    const localJobs = store.get(keys.jobs, []);
    const remoteIds = new Set(remoteJobs.map((remote) => String(remote.id || '')).filter(Boolean));
    const jobs = [...remoteJobs, ...localJobs.filter((local) => !remoteIds.has(String(local.id || '')))];
    const list = $('#job-card-list');
    if (!list) return;
    jobCardIndex.clear();
    jobs.forEach((job) => jobCardIndex.set(String(job.id || ''), job));
    if (!jobs.length) {
      list.innerHTML = '<p class="small-text">No job cards created yet.</p>';
      return;
    }
    const canManage = Boolean(meta.is_admin || meta.is_job_card_admin);
    const lifecycleOptions = ['Received', 'Assigned', 'In progress', 'Awaiting parts', 'Completed', 'Cancelled'];
    list.innerHTML = jobs.map((job) => `
      <article class="portal-item">
        <strong>${safe(job.ref || 'Untitled job')}</strong>
        <span class="portal-status ${safe(String(job.jobStatus || job.status || 'Received').toLowerCase().replace(/\s+/g, '-'))}">${safe(job.jobStatus || job.status || 'Received')}</span>
        <p class="portal-item-meta">${safe(job.client)} · ${safe(job.site)}</p>
        <p class="portal-item-meta">${safe(job.cardType || 'EC')} format · Revision ${safe(job.revision || 1)}${job.previousRecordId ? ` · Follows ${safe(job.previousRecordId)}` : ''} · Engineer: ${safe(job.engineer || 'Unassigned')} · Date: ${safe(job.date || 'No date')}</p>
        <p>${safe(job.description || 'No description')}</p>
        <p class="small-text">${job.invoiceNumber ? `Invoice ${safe(job.invoiceNumber)}${job.xeroReference ? ` · Xero ${safe(job.xeroReference)}` : ''}` : 'Invoice number pending Accounts allocation.'}${safeJobEmailUrl(job.emailUrl) ? ` · <a href="${safe(safeJobEmailUrl(job.emailUrl))}" target="_blank" rel="noopener">Job email</a>` : ''}</p>
        <div class="portal-item-actions"><button type="button" class="secondary" data-job-revise="${safe(job.id)}">Create revision</button></div>
        ${canManage && job.remote ? `<div class="job-card-account-fields" data-job-account-fields="${safe(job.id)}">
          <strong>Accounts tracking</strong>
          <label>Invoice number<input data-job-invoice value="${safe(job.invoiceNumber || '')}" placeholder="Assigned by Accounts"></label>
          <label>Xero reference<input data-job-xero value="${safe(job.xeroReference || '')}" placeholder="Xero invoice or tracking reference"></label>
          <label>Job status<select data-job-status>${[...new Set([job.jobStatus || job.status || 'Received', ...lifecycleOptions])].map((status) => `<option value="${safe(status)}" ${status === (job.jobStatus || job.status || 'Received') ? 'selected' : ''}>${safe(status)}</option>`).join('')}</select></label>
          <label>Job email link<input data-job-email-url type="url" value="${safe(safeJobEmailUrl(job.emailUrl))}" placeholder="Outlook message link"></label>
          <button type="button" class="secondary" data-job-account-save="${safe(job.id)}">Save Accounts fields</button>
          <span class="small-text" data-job-account-feedback></span>
        </div>` : '<p class="small-text">Status changes are managed by Accounts in Microsoft 365. Invoice and Xero tracking are managed there too.</p>'}
      </article>`).join('');
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
    const localTasks = store.get(keys.tasks, []);
    const tasks = [...remoteTasks, ...localTasks.filter((local) => !remoteTasks.some((remote) => String(remote.id) === String(local.id)))];
    taskIndex.clear();
    tasks.forEach((task) => taskIndex.set(String(task.id || task.recordId), task));
    const board = $('#task-board');
    if (!board) return;
    const columns = ['Pending approval', 'To-Do', 'In-Progress', 'Completed'];
    board.innerHTML = columns.map((status) => {
      const items = tasks.filter((task) => task.status === status);
      return `<section class="kanban-column"><h3>${status} <span class="portal-status">${items.length}</span></h3>${items.map(renderTask).join('') || '<p class="small-text">No tasks.</p>'}</section>`;
    }).join('');
  }

  function renderTask(task) {
    return `<article class="task-card">
      <h4>${safe(task.title)}</h4>
      <p class="portal-item-meta">${safe(task.jobRef || 'No job ref')} · ${safe(task.assignee || 'Unassigned')}</p>
      <p class="portal-item-meta">Due: ${safe(task.due || 'No due date')} · Priority: <span class="portal-status ${task.priority.toLowerCase()}">${safe(task.priority)}</span></p>
      <p class="small-text">${task.status === 'Pending approval' ? 'Awaiting licensed accounts approval.' : 'Move the task as work progresses.'}</p>
      <div class="task-card-actions">${['To-Do', 'In-Progress', 'Completed'].map((next) => `<button type="button" class="secondary" data-task-status="${safe(next)}" data-task-id="${safe(task.id)}" ${task.status === next ? 'disabled' : ''}>${safe(next)}</button>`).join('')}</div>
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
    } catch (_) {
      // The local draft list remains visible when the protected service is unavailable.
    }
  }

  async function loadProtectedTasks() {
    if (!portalApiEnabled()) return;
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
      // Local requests remain visible if the protected service is unavailable.
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
    ['#job-ref', '#job-client', '#job-site', '#job-engineer', '#job-date', '#job-description'].forEach((selector) => $(selector)?.addEventListener('input', () => renderJobPreview()));
    $('#job-card-type')?.addEventListener('change', (event) => renderJobPreview(event.target.value));
    $$('[data-preview-card-type]').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.previewCardType === 'MTA' ? 'MTA' : 'EC';
      const select = $('#job-card-type');
      if (select) select.value = type;
      renderJobPreview(type);
    }));
    renderJobPreview();
    $('#job-card-list')?.addEventListener('click', async (event) => {
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
        renderJobs([...jobCardIndex.values()].filter((item) => item.remote), { is_job_card_admin: true });
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
    $('#task-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const tasks = store.get(keys.tasks, []);
      const task = { id: id(), title: $('#task-title').value.trim(), jobRef: $('#task-job-ref').value.trim(), assignee: $('#task-assignee').value.trim(), due: $('#task-due').value, priority: $('#task-priority').value, status: 'Pending approval', requestedBy: portalProfileName() };
      if (!task.title) return;
      tasks.unshift(task);
      store.set(keys.tasks, tasks);
      const protectedRecord = {
        recordId: `task-${task.id}`,
        kind: 'tasks',
        action: 'create_request',
        status: task.status,
        submittedAt: new Date().toISOString(),
        employeeName: task.requestedBy,
        employeeEmail: portalProfile().username || '',
        recordDate: task.due,
        payload: { title: task.title, jobReference: task.jobRef, assignee: task.assignee, due: task.due, priority: task.priority }
      };
      try { await saveProtectedRecord(protectedRecord); } catch (error) {
        logNotification('Task', `Task could not be saved to protected history: ${error.message || 'service unavailable'}.`);
        renderTasks();
        return;
      }
      event.target.reset();
      prefillPortalIdentity();
      const sent = sendPortalFormSubmit('Task', {
        task_title: task.title,
        task_id: task.id,
        job_reference: task.jobRef,
        assigned_to: task.assignee,
        due_date: task.due,
        priority: task.priority,
        status: task.status,
        requested_by: task.requestedBy,
        requested_by_upn: portalProfile().username || '',
        submitted_at: new Date().toISOString()
      });
      try { await updateProtectedRecord(protectedRecord, sent ? 'Submitted' : 'Saved'); } catch (_) {}
      logNotification('Task', sent
        ? `Task request submitted for accounts approval: ${task.title}.`
        : `Task request stored locally only. It still needs an approved submission route: ${task.title}.`);
      renderTasks();
    });
    $('#task-board')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-task-status]');
      if (!button) return;
      const task = taskIndex.get(String(button.dataset.taskId));
      if (!task) return;
      const nextStatus = button.dataset.taskStatus;
      const protectedRecord = {
        recordId: task.recordId || task.id,
        kind: 'tasks',
        action: 'update_request',
        employeeName: task.employeeName || portalProfileName(),
        employeeEmail: portalProfile().username || '',
        recordDate: task.due || '',
        payload: { title: task.title, jobReference: task.jobRef, assignee: task.assignee, due: task.due, priority: task.priority }
      };
      button.disabled = true;
      try {
        await updateProtectedRecord(protectedRecord, nextStatus);
        task.status = nextStatus;
        const localTasks = store.get(keys.tasks, []);
        const local = localTasks.find((item) => String(item.id) === String(task.id));
        if (local) { local.status = nextStatus; store.set(keys.tasks, localTasks); }
        renderTasks([...taskIndex.values()]);
        logNotification('Task', 'Task ' + task.title + ' moved to ' + nextStatus + '.');
      } catch (error) {
        button.disabled = false;
        logNotification('Task', 'Task status could not be updated: ' + (error.message || 'service unavailable') + '.');
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

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs(); bindJobs(); bindTasks(); bindOrg(); bindNotifications(); bindCalendar();
    renderJobs(); renderTasks(); renderOrg(); renderNotifications(); renderCalendar();
    prefillPortalIdentity();
    loadProtectedJobs();
  });
  document.addEventListener('gmtportalidentity', prefillPortalIdentity);
})();
