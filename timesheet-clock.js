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
    if (value === 'clock_out') return 'Clock Out';
    if (value === 'lunch_start') return 'Lunch Start';
    if (value === 'lunch_end') return 'Lunch End';
    return 'Clock In';
  }

  function safeFilePart(value) {
    return String(value || 'Clock')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'Clock';
  }

  function weekdayName(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  }

  function actionText(value) {
    const label = actionLabel(value);
    const descriptions = {
      clock_in: 'Record an arrival time and send it to accounts.',
      lunch_start: 'Record when lunch starts and send it to accounts.',
      lunch_end: 'Record when lunch ends and send it to accounts.',
      clock_out: 'Record a finish time and send it to accounts.'
    };
    return {
      title: label,
      description: descriptions[value] || descriptions.clock_in,
      submit: `Submit ${label.toLowerCase()}`
    };
  }

  function updateClockCard(card) {
    const text = actionText(card.elements.clock_action.value);
    const title = card.querySelector('[data-clock-title]');
    const description = card.querySelector('[data-clock-description]');
    const submit = card.querySelector('[data-clock-submit]');
    if (title) title.textContent = text.title;
    if (description) description.textContent = text.description;
    if (submit) submit.textContent = text.submit;
    card.dataset.currentAction = card.elements.clock_action.value;
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

  function setFileInputFiles(input, files) {
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
  }

  function addFileInput(form, name, file) {
    const input = document.createElement('input');
    input.type = 'file';
    input.name = name;
    input.hidden = true;
    form.appendChild(input);
    setFileInputFiles(input, [file]);
  }

  function showStatus(card, type, text) {
    const status = card.querySelector('.clock-status');
    if (!status) return;
    status.className = `small-text clock-status ${type}`;
    status.textContent = text;
  }

  function buildClockWorkbookFile(payload) {
    if (!window.XLSX) throw new Error('Excel generator is still loading. Please try again.');
    const isStartEvent = payload.action === 'clock_in' || payload.action === 'lunch_start';
    const allRows = [{
      Status: 'Recorded',
      Category: payload.actionLabel,
      'Week start': payload.date,
      'Week end': payload.date,
      Day: payload.actionLabel,
      Date: payload.date,
      Weekday: weekdayName(payload.date),
      Start: isStartEvent ? payload.time : '',
      Finish: isStartEvent ? '' : payload.time,
      Break: 'No break',
      'Absence reason': 'NA',
      'Worked hours': 0,
      'Basic hours': 0,
      'OT x1.5 hours': 0,
      'OT x2.0 hours': 0,
      'Weighted hours': 0,
      Note: `${payload.actionLabel} timestamp only`
    }];
    const totalsRows = [
      ['GMT Clock Event'],
      [],
      ['Employee', payload.employeeName],
      ['Date', payload.date],
      ['Action', payload.actionLabel],
      ['Time', payload.time],
      ['Submitted at', payload.submittedAt],
      [],
      ['Metric', 'Hours / Count'],
      ['Worked hours', 0],
      ['Basic hours', 0],
      ['OT x1.5 hours', 0],
      ['OT x2.0 hours', 0],
      ['Clock events', 1]
    ];
    const notesRows = [
      ['GMT Clock Event Notes'],
      [],
      ['This workbook uses the same sheet names and main row columns as the weekly timesheet export.'],
      ['It records the selected clock date and time only; worked hours remain zero until a weekly timesheet is completed.'],
      [],
      ['Day', 'Date', 'Weekday', 'Category', 'Absence reason', 'Break', 'Note', 'Issue'],
      [payload.actionLabel, payload.date, weekdayName(payload.date), payload.actionLabel, 'NA', 'No break', `${payload.actionLabel} submitted from Timesheets page`, '']
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(allRows), 'All');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(totalsRows), 'Totals');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notesRows), 'Notes');
    const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    return new File(
      [array],
      `GMT Clock - ${safeFilePart(payload.employeeName)} - ${payload.date} - ${safeFilePart(payload.actionLabel)}.xlsx`,
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    );
  }

  function createEmailForm(payload, workbookFile) {
    const frame = ensureSubmitFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = timesheetEndpoint();
    form.enctype = 'multipart/form-data';
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
    hidden(form, 'gmt_attachment_type', 'xlsx');
    hidden(form, 'gmt_submitted_at', payload.submittedAt);
    hidden(form, 'employee_name', payload.employeeName);
    hidden(form, 'clock_action', payload.actionLabel);
    hidden(form, 'clock_date', payload.date);
    hidden(form, 'clock_time', payload.time);
    hidden(form, 'summary', `${payload.employeeName} submitted ${payload.actionLabel} at ${payload.time} on ${payload.date}.`);
    hidden(form, 'message', 'Clock in/out submission from the GMT Timesheets page. XLSX clock event workbook is attached.');
    addFileInput(form, 'attachment', workbookFile);
    document.body.appendChild(form);
    return form;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const card = event.currentTarget;
    const employeeName = card.elements.employee_name.value.trim();
    const action = card.elements.clock_action.value;
    const date = card.elements.clock_date.value || localDate();
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
      date,
      time,
      submittedAt: new Date().toISOString()
    };
    try {
      showStatus(card, 'ok', 'Preparing clock workbook...');
      if (typeof window.ensureXlsxLoaded !== 'function') throw new Error('Excel generator is not available.');
      await window.ensureXlsxLoaded();
      const workbookFile = buildClockWorkbookFile(payload);
      const form = createEmailForm(payload, workbookFile);
      form.submit();
      showStatus(card, 'ok', `${payload.actionLabel} sent for ${payload.time}.`);
      card.elements.clock_date.value = localDate();
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
      card.elements.clock_date.value = localDate();
      card.elements.clock_time.value = localTime();
      updateClockCard(card);
      card.elements.clock_action.addEventListener('change', () => {
        updateClockCard(card);
        showStatus(card, '', '');
      });
      card.addEventListener('submit', handleSubmit);
    });
  }

  init();
})();
