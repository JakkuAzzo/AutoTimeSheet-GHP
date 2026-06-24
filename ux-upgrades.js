(() => {
  const keys = {
    role: 'gmt_portal_role_v1',
    jobs: 'gmt_portal_job_cards_v1',
    tasks: 'gmt_portal_tasks_v1',
    calendar: 'gmt_portal_calendar_v1',
    org: 'gmt_portal_org_v1',
    notifications: 'gmt_portal_notifications_v1',
    log: 'gmt_portal_notification_log_v1'
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const get = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const set = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const roleTabs = {
    Employee: ['timesheets', 'job-cards', 'tasks', 'calendar'],
    Manager: ['timesheets', 'job-cards', 'tasks', 'notifications', 'calendar'],
    Admin: ['timesheets', 'job-cards', 'tasks', 'organization', 'notifications', 'calendar']
  };

  function switchTab(tab) {
    document.querySelector(`[data-tab="${tab}"]`)?.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTimesheet() {
    switchTab('timesheets');
    setTimeout(() => $('[data-open-timesheet-form]')?.click(), 60);
  }

  function installDashboard() {
    if ($('#ux-dashboard')) return;
    const jobs = get(keys.jobs, []);
    const tasks = get(keys.tasks, []);
    const events = get(keys.calendar, []);
    const pendingJobs = jobs.filter((j) => j.status === 'Pending').length;
    const inProgress = tasks.filter((t) => t.status === 'In-Progress').length;
    const pendingCalendar = events.filter((e) => e.status === 'Pending').length;
    const overdue = tasks.filter((t) => t.due && t.status !== 'Completed' && new Date(`${t.due}T23:59:59`) < new Date()).length;
    const role = get(keys.role, 'Admin');
    const dash = document.createElement('section');
    dash.id = 'ux-dashboard';
    dash.className = 'ux-dashboard';
    dash.innerHTML = `
      <div class="ux-dashboard-card">
        <div class="ux-dashboard-head">
          <div>
            <h2>GMT Dashboard</h2>
            <p class="small-text">Fast actions, pending work, and role-based view controls.</p>
          </div>
          <div class="ux-role-switcher" aria-label="Role mode">
            ${['Employee','Manager','Admin'].map((r) => `<button type="button" data-role-mode="${r}" class="${role === r ? 'active' : ''}">${r}</button>`).join('')}
          </div>
        </div>
        <div class="ux-quick-grid">
          <button type="button" class="ux-quick-action" data-ux-action="timesheet"><strong>Create Timesheet</strong><span>Start a weekly timesheet</span></button>
          <button type="button" class="ux-quick-action" data-ux-action="analyse"><strong>Analyse Timesheets</strong><span>Open audit/checking tool</span></button>
          <button type="button" class="ux-quick-action" data-ux-action="job"><strong>Create Job Card</strong><span>Open job card form</span></button>
          <button type="button" class="ux-quick-action" data-ux-action="task"><strong>Create Task</strong><span>Open task board</span></button>
          <button type="button" class="ux-quick-action" data-ux-action="calendar"><strong>Add Calendar Event</strong><span>Open calendar tools</span></button>
        </div>
        <div class="ux-alert-grid">
          <div class="ux-alert-card"><b>${pendingJobs}</b><strong>Job cards pending</strong></div>
          <div class="ux-alert-card"><b>${inProgress}</b><strong>Tasks in progress</strong></div>
          <div class="ux-alert-card"><b>${overdue}</b><strong>Overdue tasks</strong></div>
          <div class="ux-alert-card"><b>${pendingCalendar}</b><strong>Calendar approvals</strong></div>
        </div>
      </div>`;
    document.querySelector('.portal-tabs')?.before(dash);
    dash.addEventListener('click', (event) => {
      const roleBtn = event.target.closest('[data-role-mode]');
      if (roleBtn) {
        set(keys.role, roleBtn.dataset.roleMode);
        applyRoleMode();
        $$('#ux-dashboard [data-role-mode]').forEach((b) => b.classList.toggle('active', b === roleBtn));
        return;
      }
      const action = event.target.closest('[data-ux-action]')?.dataset.uxAction;
      if (action === 'timesheet') openTimesheet();
      if (action === 'analyse') location.href = 'audit/index.html';
      if (action === 'job') switchTab('job-cards');
      if (action === 'task') switchTab('tasks');
      if (action === 'calendar') switchTab('calendar');
    });
  }

  function applyRoleMode() {
    const role = get(keys.role, 'Admin');
    const allowed = roleTabs[role] || roleTabs.Admin;
    $$('.portal-tab').forEach((tab) => {
      const hidden = !allowed.includes(tab.dataset.tab);
      tab.classList.toggle('ux-hidden-by-role', hidden);
    });
    const active = $('.portal-tab.active');
    if (active && !allowed.includes(active.dataset.tab)) switchTab(allowed[0]);
  }

  function timesheetReviewWarnings() {
    const payloadRaw = $('#timesheet-payload')?.value;
    const summary = $('#calculated-summary')?.value || '';
    let payload = null;
    try { payload = JSON.parse(payloadRaw || '{}'); } catch {}
    const warnings = [];
    if (payload?.totals?.sick) warnings.push(`${payload.totals.sick} sick day(s) recorded. Sick entitlement still needs payroll/admin review.`);
    if (payload?.totals?.holiday) warnings.push(`${payload.totals.holiday} holiday day(s) included as paid basic.`);
    if (payload?.totals?.ot20) warnings.push(`OT x2.0 detected: ${Math.round(payload.totals.ot20 / 60 * 100) / 100} hours.`);
    if (payload?.rows?.some((r) => r.dayName === 'Sunday' && (r.total || 0) > 0)) warnings.push('Sunday work detected. Check the Sunday OT x2.0 calculation before sending.');
    if (payload?.rows?.some((r) => r.location === '' && r.absenceStatus === 'NA')) warnings.push('Some worked days have no location/site entered.');
    if (!warnings.length) warnings.push('No obvious warnings found. Review the summary before sending.');
    return { summary, warnings };
  }

  function installTimesheetReview() {
    const form = $('#timesheet-form');
    if (!form || form.dataset.uxReviewInstalled) return;
    form.dataset.uxReviewInstalled = 'true';
    form.addEventListener('submit', (event) => {
      if (form.dataset.uxConfirmed === 'true') {
        form.dataset.uxConfirmed = 'false';
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const { summary, warnings } = timesheetReviewWarnings();
      const modal = document.createElement('div');
      modal.className = 'ux-review-backdrop';
      modal.innerHTML = `
        <div class="ux-review-modal" role="dialog" aria-modal="true" aria-labelledby="ux-review-title">
          <h2 id="ux-review-title">Check before sending</h2>
          <p><strong>Summary:</strong> ${safe(summary || 'No summary available yet.')}</p>
          <ul class="ux-review-list">${warnings.map((w) => `<li>${safe(w)}</li>`).join('')}</ul>
          <div class="ux-review-actions">
            <button type="button" class="secondary" data-ux-cancel>Go back and edit</button>
            <button type="button" data-ux-confirm>Submit anyway</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('[data-ux-cancel]').addEventListener('click', () => modal.remove());
      modal.querySelector('[data-ux-confirm]').addEventListener('click', () => {
        modal.remove();
        form.dataset.uxConfirmed = 'true';
        form.requestSubmit();
      });
    }, true);
  }

  function installBackupPanel() {
    const orgPanel = $('[data-panel="organization"]');
    if (!orgPanel || $('#ux-backup-panel')) return;
    const panel = document.createElement('section');
    panel.id = 'ux-backup-panel';
    panel.className = 'card';
    panel.innerHTML = `
      <h3>Local portal backup</h3>
      <p class="small-text">Because this version has no server/database, export a JSON backup before changing device or browser.</p>
      <div class="ux-backup-actions">
        <button type="button" id="ux-export-backup" class="secondary">Export backup</button>
        <label class="secondary" style="border-radius:999px;padding:.55rem .8rem;display:inline-flex;align-items:center;gap:.5rem;">Import backup <input id="ux-import-backup" type="file" accept="application/json,.json" style="display:none"></label>
      </div>`;
    orgPanel.appendChild(panel);
    $('#ux-export-backup').addEventListener('click', exportBackup);
    $('#ux-import-backup').addEventListener('change', importBackup);
  }

  function exportBackup() {
    const data = {
      exportedAt: new Date().toISOString(),
      jobs: get(keys.jobs, []),
      tasks: get(keys.tasks, []),
      calendar: get(keys.calendar, []),
      org: get(keys.org, {}),
      notifications: get(keys.notifications, {}),
      log: get(keys.log, [])
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gmt-portal-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.jobs)) set(keys.jobs, data.jobs);
        if (Array.isArray(data.tasks)) set(keys.tasks, data.tasks);
        if (Array.isArray(data.calendar)) set(keys.calendar, data.calendar);
        if (data.org) set(keys.org, data.org);
        if (data.notifications) set(keys.notifications, data.notifications);
        if (Array.isArray(data.log)) set(keys.log, data.log);
        alert('Backup imported. The page will reload.');
        location.reload();
      } catch {
        alert('That backup file could not be imported.');
      }
    };
    reader.readAsText(file);
  }

  function installTaskFilters() {
    const board = $('#task-board');
    const form = $('#task-form');
    if (!board || !form || $('#ux-task-filters')) return;
    const filters = document.createElement('div');
    filters.id = 'ux-task-filters';
    filters.className = 'card ux-filter-bar';
    filters.innerHTML = `
      <label>Search tasks<input id="ux-task-search" type="search" placeholder="Search title, job, assignee"></label>
      <label>Priority<select id="ux-task-priority"><option value="">All</option><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
      <label>Quick view<select id="ux-task-quick"><option value="">All</option><option value="overdue">Overdue</option><option value="mine">Assigned to me</option></select></label>`;
    form.after(filters);
    filters.addEventListener('input', renderTaskFilterNotice);
    filters.addEventListener('change', renderTaskFilterNotice);
    renderTaskFilterNotice();
  }

  function renderTaskFilterNotice() {
    const search = ($('#ux-task-search')?.value || '').toLowerCase();
    const priority = $('#ux-task-priority')?.value || '';
    const quick = $('#ux-task-quick')?.value || '';
    const tasks = get(keys.tasks, []);
    const filtered = tasks.filter((task) => {
      const hay = `${task.title} ${task.jobRef} ${task.assignee}`.toLowerCase();
      const overdue = task.due && task.status !== 'Completed' && new Date(`${task.due}T23:59:59`) < new Date();
      if (search && !hay.includes(search)) return false;
      if (priority && task.priority !== priority) return false;
      if (quick === 'overdue' && !overdue) return false;
      if (quick === 'mine') return true;
      return true;
    });
    let box = $('#ux-task-filter-result');
    if (!box) {
      box = document.createElement('p');
      box.id = 'ux-task-filter-result';
      box.className = 'small-text';
      $('#ux-task-filters')?.appendChild(box);
    }
    box.textContent = `${filtered.length} matching task(s). Use the board buttons to update them.`;
  }

  function installCalendarMonth() {
    const list = $('#calendar-list');
    if (!list || $('#ux-month-calendar')) return;
    const holder = document.createElement('div');
    holder.id = 'ux-month-calendar';
    holder.className = 'ux-month-calendar';
    list.before(holder);
    renderCalendarMonth();
  }

  function renderCalendarMonth() {
    const holder = $('#ux-month-calendar');
    if (!holder) return;
    const events = get(keys.calendar, []);
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cells = [];
    for (let d = 1; d <= last.getDate(); d++) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEvents = events.filter((e) => e.date === date);
      cells.push(`<div class="ux-month-cell"><strong>${d}</strong>${dayEvents.map((e) => `<span class="ux-month-event">${safe(e.type)}: ${safe(e.title)}</span>`).join('')}</div>`);
    }
    holder.innerHTML = cells.join('');
  }

  function installJobPhotoField() {
    const form = $('#job-card-form');
    if (!form || $('#ux-job-photos')) return;
    const label = document.createElement('label');
    label.innerHTML = 'Job photos / evidence<input id="ux-job-photos" type="file" accept="image/*" multiple><span class="small-text">Photos are listed locally now. True shared photo storage needs backend storage later.</span>';
    form.querySelector('button[type="submit"]')?.before(label);
  }

  function boot() {
    installDashboard();
    applyRoleMode();
    installTimesheetReview();
    installBackupPanel();
    installTaskFilters();
    installCalendarMonth();
    installJobPhotoField();
    const observer = new MutationObserver(() => {
      installTaskFilters();
      installCalendarMonth();
      renderCalendarMonth();
      installJobPhotoField();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
