(() => {
  const endpoints = {
    jobs: 'data/job-cards/job-cards.json',
    tasks: 'data/tasks/tasks.json',
    events: 'data/calendar/events.json',
    ics: 'data/calendar/gmt-calendar.ics'
  };
  const localKeys = {
    jobs: 'gmt_portal_job_cards_v1',
    tasks: 'gmt_portal_tasks_v1',
    events: 'gmt_portal_calendar_v1'
  };
  const $ = (selector) => document.querySelector(selector);
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const getLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

  async function getJson(url) {
    try {
      const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function addSharedTab() {
    const tabs = document.querySelector('.portal-tabs');
    if (!tabs || document.querySelector('[data-tab="shared-data"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-tab';
    button.dataset.tab = 'shared-data';
    button.textContent = 'Shared Data';
    tabs.appendChild(button);
    button.addEventListener('click', () => {
      document.querySelectorAll('.portal-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.portal-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === 'shared-data'));
      renderSharedData();
    });
  }

  function addSharedPanel() {
    const main = document.querySelector('.portal-main');
    if (!main || document.querySelector('[data-panel="shared-data"]')) return;
    const panel = document.createElement('section');
    panel.className = 'portal-panel';
    panel.dataset.panel = 'shared-data';
    panel.innerHTML = `
      <div class="card intro-card">
        <h2>Shared Data</h2>
        <p>Approved records published from the repository <code>/data</code> folder. The public site reads these files without needing a server or database.</p>
      </div>
      <section class="card">
        <h3>Admin publish package</h3>
        <p class="small-text">Download local job cards, tasks, and calendar events as JSON files. Admin can paste the JSON into the manual GitHub Action to publish approved records into <code>/data</code>.</p>
        <div class="action-bar" style="justify-content:flex-start;">
          <button type="button" id="download-jobs-json" class="secondary">Download local job cards JSON</button>
          <button type="button" id="download-tasks-json" class="secondary">Download local tasks JSON</button>
          <button type="button" id="download-events-json" class="secondary">Download local calendar events JSON</button>
          <a class="button-link" href="https://github.com/JakkuAzzo/AutoTimeSheet-GHP/actions/workflows/publish-portal-data.yml" target="_blank" rel="noopener">Open publish workflow</a>
        </div>
      </section>
      <section class="card">
        <h3>Published records</h3>
        <div id="shared-data-summary" class="grid"></div>
        <div class="tabs">
          <button class="tab active" type="button" data-shared-view="jobs">Job cards</button>
          <button class="tab" type="button" data-shared-view="tasks">Tasks</button>
          <button class="tab" type="button" data-shared-view="events">Calendar events</button>
        </div>
        <div id="shared-data-output" class="portal-list"></div>
      </section>`;
    main.appendChild(panel);
    panel.addEventListener('click', (event) => {
      const view = event.target.closest('[data-shared-view]');
      if (view) {
        panel.querySelectorAll('[data-shared-view]').forEach((button) => button.classList.toggle('active', button === view));
        renderSharedList(view.dataset.sharedView);
      }
      if (event.target.id === 'download-jobs-json') downloadLocalJson('job-cards', localKeys.jobs);
      if (event.target.id === 'download-tasks-json') downloadLocalJson('tasks', localKeys.tasks);
      if (event.target.id === 'download-events-json') downloadLocalJson('calendar-events', localKeys.events);
    });
  }

  function downloadLocalJson(kind, key) {
    const rows = getLocal(key, []).map((row) => ({ ...row, updatedAt: row.updatedAt || new Date().toISOString() }));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-publish-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  let shared = { jobs: [], tasks: [], events: [] };

  async function renderSharedData() {
    shared.jobs = await getJson(endpoints.jobs);
    shared.tasks = await getJson(endpoints.tasks);
    shared.events = await getJson(endpoints.events);
    const summary = $('#shared-data-summary');
    if (summary) {
      summary.innerHTML = `
        <div class="kpi"><b>${shared.jobs.length}</b><span>Published job cards</span></div>
        <div class="kpi"><b>${shared.tasks.length}</b><span>Published tasks</span></div>
        <div class="kpi"><b>${shared.events.length}</b><span>Published calendar events</span></div>
        <div class="kpi"><b>/data</b><span>Static shared source</span></div>`;
    }
    renderSharedList('jobs');
  }

  function renderSharedList(view) {
    const out = $('#shared-data-output');
    if (!out) return;
    const rows = shared[view] || [];
    if (!rows.length) {
      out.innerHTML = '<p class="small-text">No published records yet. Publish approved records into /data using the workflow.</p>';
      return;
    }
    out.innerHTML = rows.map((row) => {
      if (view === 'jobs') return `<article class="portal-item"><strong>${safe(row.ref || 'Job card')}</strong><p class="portal-item-meta">${safe(row.client)} · ${safe(row.site)}</p><p class="portal-item-meta">Engineer: ${safe(row.engineer)} · Date: ${safe(row.date)} · Status: ${safe(row.status)}</p><p>${safe(row.description || '')}</p></article>`;
      if (view === 'tasks') return `<article class="portal-item"><strong>${safe(row.title || 'Task')}</strong><p class="portal-item-meta">${safe(row.jobRef)} · ${safe(row.assignee)} · Due: ${safe(row.due)}</p><p class="portal-item-meta">Priority: ${safe(row.priority)} · Status: ${safe(row.status)}</p></article>`;
      return `<article class="portal-item"><strong>${safe(row.date)} · ${safe(row.title || 'Calendar event')}</strong><p class="portal-item-meta">${safe(row.type)} · ${safe(row.owner)} · Status: ${safe(row.status)}</p><p>${safe(row.notes || '')}</p></article>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    addSharedTab();
    addSharedPanel();
  });
})();
