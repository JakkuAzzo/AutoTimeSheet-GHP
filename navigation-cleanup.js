(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const get = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const counts = () => {
    const jobs = get('gmt_portal_job_cards_v1', []);
    const tasks = get('gmt_portal_tasks_v1', []);
    const events = get('gmt_portal_calendar_v1', []);
    return {
      pendingJobs: jobs.filter((j) => j.status === 'Pending').length,
      inProgressTasks: tasks.filter((t) => t.status === 'In-Progress').length,
      overdueTasks: tasks.filter((t) => t.due && t.status !== 'Completed' && new Date(`${t.due}T23:59:59`) < new Date()).length,
      pendingCalendar: events.filter((e) => e.status === 'Pending').length
    };
  };

  function removeMessyDashboard() {
    const dash = $('#ux-dashboard');
    if (dash) {
      dash.classList.add('clean-removed-dashboard');
      dash.remove();
    }
  }

  function hideSecondaryTabs() {
    $('.portal-tabs')?.classList.add('clean-hidden-tabs');
  }

  function ensureDashboardPanel() {
    if ($('[data-panel="dashboard"]')) return;
    const main = $('.portal-main');
    if (!main) return;
    const c = counts();
    const panel = document.createElement('section');
    panel.className = 'portal-panel active';
    panel.dataset.panel = 'dashboard';
    panel.innerHTML = `
      <section class="card intro-card">
        <h2>Dashboard</h2>
        <p>Quick access to the main GMT tools without the extra setup/admin clutter.</p>
        <div class="clean-dashboard-grid">
          <button type="button" class="clean-dashboard-action" data-clean-open="timesheets"><strong>Timesheets</strong><span>Create or analyse timesheets.</span></button>
          <button type="button" class="clean-dashboard-action" data-clean-open="job-cards"><strong>Job Cards</strong><span>Create and review job cards.</span></button>
          <button type="button" class="clean-dashboard-action" data-clean-open="tasks"><strong>Tasks</strong><span>Manage To-Do, In-Progress, and Completed tasks.</span></button>
          <button type="button" class="clean-dashboard-action" data-clean-open="calendar"><strong>Calendar</strong><span>Add events and export calendar files.</span></button>
        </div>
        <div class="clean-dashboard-kpis">
          <div class="clean-dashboard-kpi"><b>${c.pendingJobs}</b><span>Job cards pending</span></div>
          <div class="clean-dashboard-kpi"><b>${c.inProgressTasks}</b><span>Tasks in progress</span></div>
          <div class="clean-dashboard-kpi"><b>${c.overdueTasks}</b><span>Overdue tasks</span></div>
          <div class="clean-dashboard-kpi"><b>${c.pendingCalendar}</b><span>Calendar approvals</span></div>
        </div>
      </section>`;
    main.prepend(panel);
    panel.addEventListener('click', (event) => {
      const target = event.target.closest('[data-clean-open]')?.dataset.cleanOpen;
      if (target) switchPanel(target);
    });
  }

  function installTopNav() {
    const nav = $('.header-actions');
    if (!nav) return;
    nav.className = 'header-actions clean-main-nav';
    nav.innerHTML = `
      <button type="button" class="clean-nav-btn active" data-clean-tab="dashboard">Dashboard</button>
      <button type="button" class="clean-nav-btn" data-clean-tab="timesheets">Timesheets</button>
      <button type="button" class="clean-nav-btn" data-clean-tab="job-cards">Job Cards</button>
      <button type="button" class="clean-nav-btn" data-clean-tab="tasks">Tasks</button>
      <button type="button" class="clean-nav-btn" data-clean-tab="calendar">Calendar</button>`;
    nav.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-clean-tab]')?.dataset.cleanTab;
      if (tab) switchPanel(tab);
    });
  }

  function switchPanel(name) {
    removeMessyDashboard();
    ensureDashboardPanel();
    $$('.portal-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    $$('.clean-nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.cleanTab === name));
    if (name === 'timesheets') {
      $('#timesheet-create')?.classList.remove('active');
      $('#timesheet-home')?.classList.add('active');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function boot() {
    removeMessyDashboard();
    hideSecondaryTabs();
    ensureDashboardPanel();
    installTopNav();
    switchPanel('dashboard');
    const observer = new MutationObserver(() => {
      removeMessyDashboard();
      hideSecondaryTabs();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
