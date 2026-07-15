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
  const GMT_JOB_CARD_CC = 'gmtelectricalservices+jobcards@outlook.com';

  function portalProfileName() {
    return store.get('gmt.portal.profile.v1', {}).name || '';
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
    const endpoint = isJobCard ? jobCardFormSubmitEndpoint() : formSubmitEndpoint();
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
    const cc = isJobCard
      ? recipientList(window.GMT_APP_CONFIG?.formSubmitCc, GMT_JOB_CARD_CC)
      : recipientList(window.GMT_APP_CONFIG?.formSubmitCc);
    if (cc) add('_cc', cc);
    add('submission_type', kind);
    if (isJobCard) {
      const jobRef = fields.job_reference || fields.gmt_job_ref || '';
      add('gmt_type', 'jobcard');
      add('gmt_action', kind === 'Job Card' ? 'new' : 'update');
      add('gmt_record_id', jobRef);
      add('gmt_job_ref', jobRef);
      add('gmt_client', fields.client || fields.gmt_client || '');
      add('gmt_site', fields.site_address || fields.gmt_site || '');
      add('gmt_engineer', fields.assigned_engineer || fields.gmt_engineer || '');
      add('gmt_planned_date', fields.planned_date || fields.gmt_planned_date || '');
      if (options.file) add('gmt_attachment_type', 'image');
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

  function renderJobs() {
    const jobs = store.get(keys.jobs, []);
    const list = $('#job-card-list');
    if (!list) return;
    if (!jobs.length) {
      list.innerHTML = '<p class="small-text">No job cards created yet.</p>';
      return;
    }
    list.innerHTML = jobs.map((job) => `
      <article class="portal-item">
        <strong>${safe(job.ref || 'Untitled job')}</strong>
        <span class="portal-status ${job.status.toLowerCase().replace(/\s+/g, '-')}">${safe(job.status)}</span>
        <p class="portal-item-meta">${safe(job.client)} · ${safe(job.site)}</p>
        <p class="portal-item-meta">Engineer: ${safe(job.engineer || 'Unassigned')} · Date: ${safe(job.date || 'No date')}</p>
        <p>${safe(job.description || 'No description')}</p>
        <div class="portal-item-actions">
          <button type="button" data-job-approve="${job.id}">Approve</button>
          <button type="button" class="secondary" data-job-pending="${job.id}">Mark pending</button>
          <button type="button" class="secondary danger" data-job-reject="${job.id}">Reject</button>
          <button type="button" class="secondary danger" data-job-delete="${job.id}">Delete</button>
        </div>
      </article>`).join('');
  }

  function renderTasks() {
    const tasks = store.get(keys.tasks, []);
    const board = $('#task-board');
    if (!board) return;
    const columns = ['To-Do', 'In-Progress', 'Completed'];
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
      <div class="portal-item-actions">
        <button type="button" class="secondary" data-task-move="${task.id}" data-to="To-Do">To-Do</button>
        <button type="button" class="secondary" data-task-move="${task.id}" data-to="In-Progress">In-Progress</button>
        <button type="button" data-task-move="${task.id}" data-to="Completed">Completed</button>
        <button type="button" class="secondary danger" data-task-delete="${task.id}">Delete</button>
      </div>
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
    list.innerHTML = events.map((event) => `
      <article class="portal-item calendar-date-group">
        <strong>${safe(event.date)} · ${safe(event.title)}</strong>
        <span class="portal-status ${event.status.toLowerCase()}">${safe(event.status)}</span>
        <p class="portal-item-meta">${safe(event.type)} · ${safe(event.owner || 'No owner')}</p>
        <p>${safe(event.notes || 'No notes')}</p>
        <div class="portal-item-actions">
          <button type="button" data-calendar-approve="${event.id}">Approve</button>
          <button type="button" class="secondary danger" data-calendar-delete="${event.id}">Delete</button>
        </div>
      </article>`).join('');
  }

  function bindTabs() {
    $$('.portal-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('[data-open-timesheet-form]')?.addEventListener('click', openTimesheetForm);
    $('[data-back-to-timesheets]')?.addEventListener('click', backToTimesheets);
  }

  function bindJobs() {
    $('#job-card-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const jobs = store.get(keys.jobs, []);
      const imageFile = $('#job-image')?.files?.[0] || null;
      const job = {
        id: id(), ref: $('#job-ref').value.trim(), client: $('#job-client').value.trim(), site: $('#job-site').value.trim(), engineer: $('#job-engineer').value.trim(), date: $('#job-date').value, description: $('#job-description').value.trim(), status: 'Pending'
      };
      jobs.unshift(job);
      store.set(keys.jobs, jobs);
      sendPortalFormSubmit('Job Card', {
        job_reference: job.ref,
        client: job.client,
        site_address: job.site,
        assigned_engineer: job.engineer,
        planned_date: job.date,
        status: job.status,
        description: job.description,
        submitted_at: new Date().toISOString()
      }, { file: imageFile });
      event.target.reset();
      prefillPortalIdentity();
      logNotification('Job card', `Job card ${job.ref || job.client || job.id} created and emailed for admin review.`);
      renderJobs();
    });
    $('#job-card-list')?.addEventListener('click', (event) => {
      const jobs = store.get(keys.jobs, []);
      const action = event.target.dataset;
      const jobId = action.jobApprove || action.jobPending || action.jobReject || action.jobDelete;
      if (!jobId) return;
      const job = jobs.find((item) => item.id === jobId);
      if (action.jobDelete) store.set(keys.jobs, jobs.filter((item) => item.id !== jobId));
      if (job && action.jobApprove) job.status = 'Approved';
      if (job && action.jobPending) job.status = 'Pending';
      if (job && action.jobReject) job.status = 'Rejected';
      if (!action.jobDelete) store.set(keys.jobs, jobs);
      if (job) sendPortalFormSubmit('Job Card Update', { job_reference: job.ref, client: job.client, status: action.jobDelete ? 'Deleted' : job.status, updated_at: new Date().toISOString() });
      logNotification('Job card', `Job card ${job?.ref || jobId} updated.`);
      renderJobs();
    });
  }

  function bindTasks() {
    $('#task-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const tasks = store.get(keys.tasks, []);
      const task = { id: id(), title: $('#task-title').value.trim(), jobRef: $('#task-job-ref').value.trim(), assignee: $('#task-assignee').value.trim(), due: $('#task-due').value, priority: $('#task-priority').value, status: 'To-Do' };
      if (!task.title) return;
      tasks.unshift(task);
      store.set(keys.tasks, tasks);
      event.target.reset();
      prefillPortalIdentity();
      sendPortalFormSubmit('Task', {
        task_title: task.title,
        job_reference: task.jobRef,
        assigned_to: task.assignee,
        due_date: task.due,
        priority: task.priority,
        status: task.status,
        submitted_at: new Date().toISOString()
      });
      logNotification('Task', `Task created and emailed: ${task.title}.`);
      renderTasks();
    });
    $('#task-board')?.addEventListener('click', (event) => {
      const move = event.target.closest('[data-task-move]');
      const del = event.target.closest('[data-task-delete]');
      const tasks = store.get(keys.tasks, []);
      if (move) {
        const task = tasks.find((item) => item.id === move.dataset.taskMove);
        if (task) {
          task.status = move.dataset.to;
          sendPortalFormSubmit('Task Update', { task_title: task.title, job_reference: task.jobRef, assigned_to: task.assignee, status: task.status, updated_at: new Date().toISOString() });
        }
        store.set(keys.tasks, tasks);
        logNotification('Task', `Task moved to ${move.dataset.to}.`);
      }
      if (del) {
        const task = tasks.find((item) => item.id === del.dataset.taskDelete);
        if (task) sendPortalFormSubmit('Task Update', { task_title: task.title, status: 'Deleted', updated_at: new Date().toISOString() });
        store.set(keys.tasks, tasks.filter((item) => item.id !== del.dataset.taskDelete));
        logNotification('Task', 'Task deleted.');
      }
      renderTasks();
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
    const events = store.get(keys.calendar, []);
    if (!events.length) {
      logNotification('Calendar', 'No calendar events to export.');
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const body = events.map((event) => `BEGIN:VEVENT\r\nUID:${event.id}@gmt-portal\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${ymd(event.date)}\r\nDTEND;VALUE=DATE:${ymd(nextDay(event.date))}\r\nSUMMARY:${icsText(`${event.type}: ${event.title}`)}\r\nLOCATION:${icsText(event.location || '')}\r\nDESCRIPTION:${icsText(`Owner: ${event.owner || 'Unassigned'} | Status: ${event.status} | Notes: ${event.notes || ''}`)}\r\nEND:VEVENT`).join('\r\n');
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GMT Electrical Services//Operations Portal//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:GMT Operations Calendar\r\n${body}\r\nEND:VCALENDAR\r\n`;
    const blob = new Blob([calendar], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gmt-operations-calendar.ics';
    a.click();
    URL.revokeObjectURL(url);
    logNotification('Calendar', 'Calendar .ics exported. Import it into Outlook, Apple Calendar, or Google Calendar.');
  }

  function bindCalendar() {
    $('#calendar-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const events = store.get(keys.calendar, []);
      const type = $('#calendar-type').value;
      const entry = { id: id(), title: $('#calendar-title').value.trim(), date: $('#calendar-date').value, type, owner: $('#calendar-owner').value.trim(), notes: $('#calendar-notes').value.trim(), status: ['Sick Day', 'Holiday'].includes(type) ? 'Pending' : 'Approved' };
      if (!entry.title || !entry.date) return;
      events.push(entry);
      store.set(keys.calendar, events);
      event.target.reset();
      prefillPortalIdentity();
      logNotification('Calendar', `Calendar event added: ${entry.title}.`);
      renderCalendar();
    });
    $('#calendar-list')?.addEventListener('click', (event) => {
      const approve = event.target.closest('[data-calendar-approve]');
      const del = event.target.closest('[data-calendar-delete]');
      const events = store.get(keys.calendar, []);
      if (approve) {
        const item = events.find((entry) => entry.id === approve.dataset.calendarApprove);
        if (item) item.status = 'Approved';
        store.set(keys.calendar, events);
        logNotification('Calendar', 'Calendar event approved.');
      }
      if (del) {
        store.set(keys.calendar, events.filter((entry) => entry.id !== del.dataset.calendarDelete));
        logNotification('Calendar', 'Calendar event deleted.');
      }
      renderCalendar();
    });
    $('#export-ics-btn')?.addEventListener('click', exportCalendarIcs);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs(); bindJobs(); bindTasks(); bindOrg(); bindNotifications(); bindCalendar();
    renderJobs(); renderTasks(); renderOrg(); renderNotifications(); renderCalendar();
    prefillPortalIdentity();
  });
  document.addEventListener('gmtportalidentity', prefillPortalIdentity);
})();
