(() => {
  const keys = {
    jobs: 'gmt_portal_job_cards_v1',
    tasks: 'gmt_portal_tasks_v1',
    calendar: 'gmt_portal_calendar_v1',
    log: 'gmt_portal_notification_log_v1'
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const get = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const set = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function endpoint() {
    return String(window.GMT_APP_CONFIG?.formSubmitEndpoint || '').replace('/ajax/', '/');
  }

  function addLog(type, message) {
    const log = get(keys.log, []);
    log.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, message, at: new Date().toISOString() });
    set(keys.log, log.slice(0, 60));
  }

  function ensureFrame() {
    let frame = $('#portal-extension-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'portal-extension-frame';
      frame.name = 'portal-extension-frame';
      frame.hidden = true;
      document.body.appendChild(frame);
    }
  }

  function sendFormSubmit(subject, fields, file) {
    const url = endpoint();
    if (!url) return false;
    ensureFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = 'portal-extension-frame';
    form.enctype = 'multipart/form-data';
    form.hidden = true;
    const add = (name, value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value ?? '');
      form.appendChild(input);
    };
    add('_subject', subject);
    add('_template', 'box');
    add('_captcha', 'false');
    add('submitted_at', new Date().toISOString());
    Object.entries(fields || {}).forEach(([name, value]) => add(name, value));
    if (file) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.name = 'attachment';
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      form.appendChild(fileInput);
    }
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 2000);
    return true;
  }

  function renderJobEditButtons() {
    $$('#job-card-list .portal-item').forEach((item, index) => {
      if (item.querySelector('[data-extension-job-edit]')) return;
      const jobs = get(keys.jobs, []);
      const job = jobs[index];
      if (!job) return;
      const actions = item.querySelector('.portal-item-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.extensionJobEdit = job.id;
      button.textContent = 'Edit';
      actions.prepend(button);
    });
  }

  function renderTaskEditButtons() {
    const tasks = get(keys.tasks, []);
    $$('#task-board .task-card').forEach((item) => {
      if (item.querySelector('[data-extension-task-edit]')) return;
      const title = item.querySelector('h4')?.textContent || '';
      const task = tasks.find((entry) => entry.title === title);
      if (!task) return;
      const actions = item.querySelector('.portal-item-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.extensionTaskEdit = task.id;
      button.textContent = 'Edit';
      actions.prepend(button);
    });
  }

  function refreshEditButtonsSoon() {
    setTimeout(() => {
      renderJobEditButtons();
      renderTaskEditButtons();
    }, 80);
  }

  function editJob(id) {
    const jobs = get(keys.jobs, []);
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    const ref = prompt('Job reference', job.ref || '') ?? job.ref;
    const client = prompt('Customer / client', job.client || '') ?? job.client;
    const site = prompt('Site address', job.site || '') ?? job.site;
    const engineer = prompt('Assigned engineer', job.engineer || '') ?? job.engineer;
    const date = prompt('Planned date YYYY-MM-DD', job.date || '') ?? job.date;
    const description = prompt('Work description', job.description || '') ?? job.description;
    Object.assign(job, { ref, client, site, engineer, date, description, status: job.status || 'Pending' });
    set(keys.jobs, jobs);
    sendFormSubmit('GMT Job Card Update', {
      update_type: 'Edited',
      job_reference: job.ref,
      client: job.client,
      site_address: job.site,
      assigned_engineer: job.engineer,
      planned_date: job.date,
      status: job.status,
      description: job.description
    });
    addLog('Job card', `Job card ${job.ref || job.id} edited and emailed.`);
    location.reload();
  }

  function editTask(id) {
    const tasks = get(keys.tasks, []);
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const title = prompt('Task title', task.title || '') ?? task.title;
    const jobRef = prompt('Job reference', task.jobRef || '') ?? task.jobRef;
    const assignee = prompt('Assigned to', task.assignee || '') ?? task.assignee;
    const due = prompt('Due date YYYY-MM-DD', task.due || '') ?? task.due;
    const priority = prompt('Priority: Low, Normal, High, Urgent', task.priority || 'Normal') ?? task.priority;
    Object.assign(task, { title, jobRef, assignee, due, priority });
    set(keys.tasks, tasks);
    sendFormSubmit('GMT Task Update', {
      update_type: 'Edited',
      task_title: task.title,
      job_reference: task.jobRef,
      assigned_to: task.assignee,
      due_date: task.due,
      priority: task.priority,
      status: task.status
    });
    addLog('Task', `Task ${task.title} edited and emailed.`);
    location.reload();
  }

  function icsText(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function ymd(date) { return String(date || '').replace(/-/g, ''); }
  function nextDay(date) {
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function buildIcsFile() {
    const events = get(keys.calendar, []);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const body = events.map((event) => `BEGIN:VEVENT\r\nUID:${event.id}@gmt-portal\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${ymd(event.date)}\r\nDTEND;VALUE=DATE:${ymd(nextDay(event.date))}\r\nSUMMARY:${icsText(`${event.type}: ${event.title}`)}\r\nLOCATION:${icsText(event.location || '')}\r\nDESCRIPTION:${icsText(`Owner: ${event.owner || 'Unassigned'} | Status: ${event.status} | Notes: ${event.notes || ''}`)}\r\nEND:VEVENT`).join('\r\n');
    const calendar = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GMT Electrical Services//Operations Portal//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:GMT Operations Calendar\r\n${body}\r\nEND:VCALENDAR\r\n`;
    return new File([calendar], 'gmt-operations-calendar.ics', { type: 'text/calendar;charset=utf-8' });
  }

  function downloadIcs() {
    const file = buildIcsFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    addLog('Calendar', 'Calendar .ics downloaded.');
  }

  function emailIcs() {
    const events = get(keys.calendar, []);
    if (!events.length) {
      alert('No calendar events to email yet.');
      return;
    }
    const file = buildIcsFile();
    sendFormSubmit('GMT Calendar ICS Export', {
      calendar_name: 'GMT Operations Calendar',
      event_count: events.length,
      message: 'Calendar .ics file attached. Import into Outlook, Apple Calendar, Google Calendar, or another calendar app.'
    }, file);
    addLog('Calendar', 'Calendar .ics emailed through FormSubmit.');
    alert('Calendar .ics sent through FormSubmit.');
  }

  function wireCalendarButtons() {
    const calendarCard = $('#calendar-list')?.closest('.card');
    if (!calendarCard || $('#email-ics-btn')) return;
    const actionBar = calendarCard.querySelector('.action-bar') || calendarCard;
    const emailButton = document.createElement('button');
    emailButton.type = 'button';
    emailButton.id = 'email-ics-btn';
    emailButton.className = 'secondary';
    emailButton.textContent = 'Email Calendar .ics';
    emailButton.addEventListener('click', emailIcs);
    actionBar.appendChild(emailButton);
    const exportButton = $('#export-ics-btn');
    if (exportButton) {
      exportButton.replaceWith(exportButton.cloneNode(true));
      $('#export-ics-btn')?.addEventListener('click', downloadIcs);
    }
  }

  function wireCalendarSubmitEmail() {
    const form = $('#calendar-form');
    if (!form || form.dataset.extensionCalendarSubmit) return;
    form.dataset.extensionCalendarSubmit = 'true';
    form.addEventListener('submit', () => {
      const title = $('#calendar-title')?.value.trim();
      const date = $('#calendar-date')?.value;
      const type = $('#calendar-type')?.value;
      const owner = $('#calendar-owner')?.value.trim();
      const notes = $('#calendar-notes')?.value.trim();
      if (!title || !date) return;
      setTimeout(() => {
        sendFormSubmit('GMT Calendar Event Submission', {
          event_title: title,
          event_date: date,
          event_type: type,
          owner_or_requester: owner,
          status: ['Sick Day', 'Holiday'].includes(type) ? 'Pending' : 'Approved',
          notes
        });
        addLog('Calendar', `Calendar event ${title} emailed.`);
      }, 0);
    }, true);
  }

  document.addEventListener('click', (event) => {
    const jobEdit = event.target.closest('[data-extension-job-edit]');
    if (jobEdit) editJob(jobEdit.dataset.extensionJobEdit);
    const taskEdit = event.target.closest('[data-extension-task-edit]');
    if (taskEdit) editTask(taskEdit.dataset.extensionTaskEdit);
    refreshEditButtonsSoon();
  });

  document.addEventListener('DOMContentLoaded', () => {
    wireCalendarButtons();
    wireCalendarSubmitEmail();
    refreshEditButtonsSoon();
    const observer = new MutationObserver(refreshEditButtonsSoon);
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
