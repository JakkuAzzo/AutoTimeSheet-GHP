(() => {
  const CONFIG = window.GMT_APP_CONFIG || {};

  function cleanEndpoint(value) {
    return String(value || '').trim().replace('/ajax/', '/');
  }

  function taggedEndpoint(tag) {
    const base = cleanEndpoint(CONFIG.formSubmitEndpoint);
    if (!base) return cleanEndpoint(CONFIG.fallbackFormSubmitEndpoint);
    return base.replace(/([^/?#/@]+)@([^/?#]+)/, (_, local, domain) => `${local.split('+')[0]}+${tag}@${domain}`);
  }

  function timesheetEndpoint() {
    return cleanEndpoint(CONFIG.timesheetFormSubmitEndpoint || CONFIG.formSubmitTimesheetEndpoint)
      || taggedEndpoint('timesheets');
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function localTime(d = new Date()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function actionLabel(value) {
    return value === 'clock_out' ? 'Clock Out' : 'Clock In';
  }

  function ensureSubmitFrame() {
    let frame = document.getElementById('timesheet-clock-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'timesheet-clock-frame';
      frame.name = 'timesheet-clock-frame';
      frame.hidden = true;
      document.body.appendChild(frame);
    }
    return frame;
  }

  function hidden(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value == null ? '' : String(value);
    form.appendChild(input);
  }

  function showStatus(card, type, text) {
    const status = card.querySelector('.clock-status');
    if (!status) return;
    status.className = `small-text clock-status ${type}`;
    status.textContent = text;
  }

  function createEmailForm(payload) {
    const frame = ensureSubmitFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = timesheetEndpoint();
    form.target = frame.name;
    form.hidden = true;
    hidden(form, '_subject', `[GMT][TIMESHEET][CLOCK] ${payload.employeeName} | ${payload.actionLabel} | ${payload.date} ${payload.time}`);
    hidden(form, '_template', 'box');
    hidden(form, '_captcha', 'false');
    hidden(form, 'gmt_type', 'timesheet_clock');
    hidden(form, 'gmt_action', payload.action);
    hidden(form, 'gmt_record_id', `${payload.employeeName} ${payload.date} ${payload.time} ${payload.action}`);
    hidden(form, 'gmt_employee', payload.employeeName);
    hidden(form, 'gmt_clock_date', payload.date);
    hidden(form, 'gmt_clock_time', payload.time);
    hidden(form, 'gmt_submitted_at', payload.submittedAt);
    hidden(form, 'employee_name', payload.employeeName);
    hidden(form, 'clock_action', payload.actionLabel);
    hidden(form, 'clock_date', payload.date);
    hidden(form, 'clock_time', payload.time);
    hidden(form, 'summary', `${payload.employeeName} submitted ${payload.actionLabel} at ${payload.time} on ${payload.date}.`);
    hidden(form, 'message', 'Clock in/out submission from the GMT Timesheets page.');
    document.body.appendChild(form);
    return form;
  }

  function handleSubmit(event) {
    event.preventDefault();
    const card = event.currentTarget;
    const employeeName = card.elements.employee_name.value.trim();
    const action = card.elements.clock_action.value;
    const time = card.elements.clock_time.value || localTime();
    const endpoint = timesheetEndpoint();
    if (!employeeName) {
      showStatus(card, 'error', 'Enter your name first.');
      return;
    }
    if (!endpoint) {
      showStatus(card, 'error', 'Clock submission email is not configured yet.');
      return;
    }
    const payload = {
      employeeName,
      action,
      actionLabel: actionLabel(action),
      date: localDate(),
      time,
      submittedAt: new Date().toISOString()
    };
    try {
      const form = createEmailForm(payload);
      form.submit();
      showStatus(card, 'ok', `${payload.actionLabel} sent for ${payload.time}.`);
      card.elements.clock_time.value = localTime();
      setTimeout(() => form.remove(), 2000);
    } catch (error) {
      showStatus(card, 'error', 'Clock submission could not be sent.');
    }
  }

  function init() {
    document.querySelectorAll('[data-clock-form]').forEach((card) => {
      const action = card.dataset.defaultAction || 'clock_in';
      card.elements.clock_action.value = action;
      card.elements.clock_time.value = localTime();
      card.addEventListener('submit', handleSubmit);
    });
  }

  init();
})();
