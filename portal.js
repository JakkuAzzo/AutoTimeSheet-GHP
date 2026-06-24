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

  function logNotification(type, message) {
    const log = store.get(keys.log, []);
    log.unshift({ id: id(), type, message, at: new Date().toISOString() });
    store.set(keys.log, log.slice(0, 60));
    renderNotifications();
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
    const fields = {
      'notify-login': 'login',
      'notify-task': 'task',
      'notify-timesheet': 'timesheet',
      'notify-job-card': 'jobCard',
      'notify-critical': 'critical'
    };
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
      const job = {
        id: id(),
        ref: $('#job-ref').value.trim(),
        client: $('#job-client').value.trim(),
        site: $('#job-site').value.trim(),
        engineer: $('#job-engineer').value.trim(),
        date: $('#job-date').value,
        description: $('#job-description').value.trim(),
        status: 'Pending'
      };
      jobs.unshift(job);
      store.set(keys.jobs, jobs);
      event.target.reset();
      logNotification('Job card', `Job card ${job.ref || job.client || job.id} created for admin review.`);
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
      logNotification('Job card', `Job card ${job?.ref || jobId} updated.`);
      renderJobs();
    });
  }

  function bindTasks() {
    $('#task-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const tasks = store.get(keys.tasks, []);
      const task = {
        id: id(),
        title: $('#task-title').value.trim(),
        jobRef: $('#task-job-ref').value.trim(),
        assignee: $('#task-assignee').value.trim(),
        due: $('#task-due').value,
        priority: $('#task-priority').value,
        status: 'To-Do'
      };
      if (!task.title) return;
      tasks.unshift(task);
      store.set(keys.tasks, tasks);
      event.target.reset();
      logNotification('Task', `Task created: ${task.title}.`);
      renderTasks();
    });
    $('#task-board')?.addEventListener('click', (event) => {
      const move = event.target.closest('[data-task-move]');
      const del = event.target.closest('[data-task-delete]');
      const tasks = store.get(keys.tasks, []);
      if (move) {
        const task = tasks.find((item) => item.id === move.dataset.taskMove);
        if (task) task.status = move.dataset.to;
        store.set(keys.tasks, tasks);
        logNotification('Task', `Task moved to ${move.dataset.to}.`);
      }
      if (del) {
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
      reader.onload = () => {
        const org = store.get(keys.org, {});
        org.logo = reader.result;
        store.set(keys.org, org);
        renderOrg();
      };
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
      const settings = {
        login: $('#notify-login').checked,
        task: $('#notify-task').checked,
        timesheet: $('#notify-timesheet').checked,
        jobCard: $('#notify-job-card').checked,
        critical: $('#notify-critical').checked
      };
      store.set(keys.notifications, settings);
      logNotification('Notifications', 'Notification settings updated.');
      renderNotifications();
    });
  }

  function bindCalendar() {
    $('#calendar-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const events = store.get(keys.calendar, []);
      const type = $('#calendar-type').value;
      const entry = {
        id: id(),
        title: $('#calendar-title').value.trim(),
        date: $('#calendar-date').value,
        type,
        owner: $('#calendar-owner').value.trim(),
        notes: $('#calendar-notes').value.trim(),
        status: ['Sick Day', 'Holiday'].includes(type) ? 'Pending' : 'Approved'
      };
      if (!entry.title || !entry.date) return;
      events.push(entry);
      store.set(keys.calendar, events);
      event.target.reset();
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
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindJobs();
    bindTasks();
    bindOrg();
    bindNotifications();
    bindCalendar();
    renderJobs();
    renderTasks();
    renderOrg();
    renderNotifications();
    renderCalendar();
  });
})();
