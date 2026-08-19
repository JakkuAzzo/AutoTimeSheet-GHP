(() => {
  const CONFIG = window.GMT_APP_CONFIG || {};
  const EVENT_ACTIONS = ['clock_in', 'lunch_start', 'lunch_end', 'clock_out'];

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

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localTime(date = new Date()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function actionLabel(value) {
    const labels = {
      clock_in: 'Clock In',
      lunch_start: 'Lunch Start',
      lunch_end: 'Lunch End',
      clock_out: 'Clock Out',
      absent: 'Absent',
      full_day: 'Full Day'
    };
    return labels[value] || labels.clock_in;
  }

  function actionText(value) {
    const text = {
      clock_in: ['Clock In', 'Record an arrival time and send it to accounts.', 'Submit clock in'],
      lunch_start: ['Lunch Start', 'Record when lunch starts and send it to accounts.', 'Submit lunch start'],
      lunch_end: ['Lunch End', 'Record when lunch ends and send it to accounts.', 'Submit lunch end'],
      clock_out: ['Clock Out', 'Record a finish time and send it to accounts.', 'Submit clock out'],
      absent: ['Record Absence', 'Mark the whole selected day as absent and send it to accounts.', 'Submit absence'],
      full_day: ['Record Full Day', 'Record start, lunch and finish times for one day.', 'Submit full day']
    };
    const [title, description, submit] = text[value] || text.clock_in;
    return { title, description, submit };
  }

  function safeFilePart(value) {
    return String(value || 'Clock')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'Clock';
  }

  function safeKeyPart(value) {
    return String(value || 'clock')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'clock';
  }

  function weekdayName(dateValue) {
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
  }

  function formatHours(minutes) {
    return Number((Math.max(0, minutes) / 60).toFixed(2));
  }

  function portalProfile() {
    try {
      return JSON.parse(localStorage.getItem('gmt.portal.profile.v1') || '{}');
    } catch (_) {
      return {};
    }
  }

  function prefillClockIdentity(card, profile = portalProfile(), force = false) {
    const name = String(profile && profile.name || '').trim();
    if (name && (force || !card.elements.employee_name.value.trim())) card.elements.employee_name.value = name;
  }

  function setDisabled(element, disabled) {
    if (!element) return;
    element.disabled = disabled;
    element.required = !disabled && (element.name === 'day_start' || element.name === 'day_finish');
  }

  function updateClockCard(card) {
    const action = card.elements.clock_action.value;
    const text = actionText(action);
    const isAbsent = action === 'absent';
    const isFullDay = action === 'full_day';
    const title = card.querySelector('[data-clock-title]');
    const description = card.querySelector('[data-clock-description]');
    const submit = card.querySelector('[data-clock-submit]');
    const timeField = card.querySelector('[data-clock-time-field]');
    const absenceField = card.querySelector('[data-absence-field]');
    const fullDay = card.querySelector('[data-full-day-fields]');

    if (title) title.textContent = text.title;
    if (description) description.textContent = text.description;
    if (submit) submit.textContent = text.submit;
    if (timeField) timeField.hidden = isAbsent || isFullDay;
    if (absenceField) absenceField.hidden = !isAbsent;
    if (fullDay) fullDay.hidden = !isFullDay;

    card.elements.clock_time.disabled = isAbsent || isFullDay;
    card.elements.clock_time.required = !isAbsent && !isFullDay;
    setDisabled(card.elements.absence_reason, !isAbsent);
    ['day_start', 'day_lunch_start', 'day_lunch_end', 'day_finish'].forEach((name) => {
      setDisabled(card.elements[name], !isFullDay);
    });
    card.querySelectorAll('[data-clock-action]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.clockAction === action));
    });
    card.dataset.currentAction = action;
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

  function validateFullDay(payload) {
    if (payload.action !== 'full_day') return '';
    const start = timeToMinutes(payload.dayStart);
    const finish = timeToMinutes(payload.dayFinish);
    const lunchStart = timeToMinutes(payload.lunchStart);
    const lunchEnd = timeToMinutes(payload.lunchEnd);
    if (start === null || finish === null) return 'Enter both start and finish times for the full day.';
    if ((lunchStart === null) !== (lunchEnd === null)) return 'Enter both lunch start and lunch end, or leave both blank.';
    let finishMinutes = finish;
    if (finishMinutes <= start) finishMinutes += 24 * 60;
    if (lunchStart !== null && lunchEnd <= lunchStart) return 'Lunch end must be later than lunch start.';
    if (lunchStart !== null && (lunchStart < start || lunchEnd > finishMinutes)) return 'Lunch must fall within the recorded working day.';
    return '';
  }

  function payloadHours(payload) {
    if (payload.action !== 'full_day') return { worked: 0, breakMinutes: 0 };
    const start = timeToMinutes(payload.dayStart);
    let finish = timeToMinutes(payload.dayFinish);
    if (start === null || finish === null) return { worked: 0, breakMinutes: 0 };
    if (finish <= start) finish += 24 * 60;
    const lunchStart = timeToMinutes(payload.lunchStart);
    const lunchEnd = timeToMinutes(payload.lunchEnd);
    const breakMinutes = lunchStart === null || lunchEnd === null ? 0 : lunchEnd - lunchStart;
    return { worked: Math.max(0, finish - start - breakMinutes), breakMinutes };
  }

  function payloadRow(payload) {
    const hours = payloadHours(payload);
    const startEvent = payload.action === 'clock_in' || payload.action === 'lunch_start';
    const finishEvent = payload.action === 'clock_out' || payload.action === 'lunch_end';
    const absent = payload.action === 'absent';
    const fullDay = payload.action === 'full_day';
    const breakLabel = hours.breakMinutes ? `${Math.floor(hours.breakMinutes / 60)}h ${pad(hours.breakMinutes % 60)}m` : 'No break';
    return {
      Employee: payload.employeeName,
      'Employee email': payload.employeeEmail,
      Status: absent ? 'Absent' : 'Recorded',
      Category: payload.actionLabel,
      'Week start': payload.date,
      'Week end': payload.date,
      Day: payload.actionLabel,
      Date: payload.date,
      Weekday: weekdayName(payload.date),
      Start: fullDay ? payload.dayStart : (startEvent ? payload.time : ''),
      Finish: fullDay ? payload.dayFinish : (finishEvent ? payload.time : ''),
      'Lunch start': fullDay ? payload.lunchStart : (payload.action === 'lunch_start' ? payload.time : ''),
      'Lunch end': fullDay ? payload.lunchEnd : (payload.action === 'lunch_end' ? payload.time : ''),
      Break: fullDay ? breakLabel : 'No break',
      'Absence reason': absent ? payload.absenceReason : 'NA',
      'Worked hours': formatHours(hours.worked),
      'Basic hours': formatHours(hours.worked),
      'OT x1.5 hours': 0,
      'OT x2.0 hours': 0,
      'Weighted hours': formatHours(hours.worked),
      Note: payload.note || (absent ? `${payload.absenceReason} recorded for the full day.` : `${payload.actionLabel} timestamp only`)
    };
  }

  function buildClockFiles(payload) {
    if (!window.XLSX) throw new Error('Excel generator is still loading. Please try again.');
    const row = payloadRow(payload);
    const hours = payloadHours(payload);
    const notesRows = [
      ['GMT Clock Event Notes'],
      [],
      ['This workbook uses the same All, Totals and Notes sheet structure as the weekly timesheet export.'],
      ['Clock and lunch events are timestamps. A full-day entry records its entered daily hours; payroll overtime remains calculated on the weekly timesheet.'],
      [],
      ['Action', 'Date', 'Weekday', 'Absence reason', 'Note'],
      [payload.actionLabel, payload.date, weekdayName(payload.date), row['Absence reason'], row.Note]
    ];
    const totalsRows = [
      ['GMT Clock Event'],
      [],
      ['Employee', payload.employeeName],
      ['Employee email', payload.employeeEmail],
      ['Date', payload.date],
      ['Action', payload.actionLabel],
      ['Time', payload.time],
      ['Submitted at', payload.submittedAt],
      [],
      ['Metric', 'Hours / Count'],
      ['Worked hours', row['Worked hours']],
      ['Basic hours', row['Basic hours']],
      ['OT x1.5 hours', 0],
      ['OT x2.0 hours', 0],
      ['Clock events', 1]
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'All');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(totalsRows), 'Totals');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notesRows), 'Notes');
    const xlsxArray = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const fileBase = `GMT Clock - ${safeFilePart(payload.employeeName)} - ${payload.date} - ${safeFilePart(payload.actionLabel)}`;
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet([row]));
    return {
      workbook: new File([xlsxArray], `${fileBase}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      csv: new File([csv], `${fileBase}.csv`, { type: 'text/csv;charset=utf-8' }),
      row,
      hours
    };
  }

  function createEmailForm(payload, files) {
    const frame = ensureSubmitFrame();
    const form = document.createElement('form');
    const subjectType = payload.action === 'full_day' || payload.action === 'absent' ? 'DAY' : 'CLOCK';
    form.method = 'POST';
    form.action = timesheetEndpoint();
    form.enctype = 'multipart/form-data';
    form.target = frame.name;
    form.hidden = true;
    hidden(form, '_subject', `[GMT][TIMESHEET][${subjectType}] ${payload.employeeName} | ${payload.actionLabel} | ${payload.date}${payload.time ? ` ${payload.time}` : ''}`);
    hidden(form, '_template', 'box');
    hidden(form, '_captcha', 'false');
    hidden(form, '_cc', payload.notificationEmail);
    hidden(form, 'gmt_schema_version', '2');
    hidden(form, 'gmt_type', 'timesheet_clock');
    hidden(form, 'gmt_action', payload.action);
    const recordIdentity = payload.employeeEmail || payload.employeeName;
    const recordId = `${recordIdentity}|${payload.date}|${payload.action}|${payload.time || payload.dayStart || 'absence'}`;
    const workbookKey = `clock-${safeKeyPart(recordIdentity)}-${payload.date.slice(0, 7)}`;
    hidden(form, 'gmt_record_id', recordId);
    hidden(form, 'gmt_workbook_key', workbookKey);
    hidden(form, 'gmt_filing_mode', 'monthly-upsert');
    hidden(form, 'gmt_employee', payload.employeeName);
    hidden(form, 'gmt_employee_email', payload.employeeEmail);
    hidden(form, 'gmt_clock_date', payload.date);
    hidden(form, 'gmt_clock_time', payload.time);
    hidden(form, 'gmt_absence_reason', payload.absenceReason);
    hidden(form, 'gmt_note', payload.note);
    hidden(form, 'gmt_day_start', payload.dayStart);
    hidden(form, 'gmt_lunch_start', payload.lunchStart);
    hidden(form, 'gmt_lunch_end', payload.lunchEnd);
    hidden(form, 'gmt_day_finish', payload.dayFinish);
    hidden(form, 'gmt_year', payload.date.slice(0, 4));
    hidden(form, 'gmt_month', payload.date.slice(0, 7));
    hidden(form, 'gmt_worked_hours', files.row['Worked hours']);
    hidden(form, 'gmt_basic_hours', files.row['Basic hours']);
    hidden(form, 'gmt_ot15_hours', 0);
    hidden(form, 'gmt_ot20_hours', 0);
    hidden(form, 'gmt_attachment_type', 'xlsx,csv');
    hidden(form, 'gmt_attachment_manifest', 'xlsx,csv');
    hidden(form, 'gmt_submitted_at', payload.submittedAt);
    hidden(form, 'employee_name', payload.employeeName);
    hidden(form, 'clock_action', payload.actionLabel);
    hidden(form, 'clock_date', payload.date);
    hidden(form, 'clock_time', payload.time);
    hidden(form, 'absence_reason', payload.absenceReason);
    hidden(form, 'note', payload.note);
    hidden(form, 'summary', `${payload.employeeName} submitted ${payload.actionLabel.toLowerCase()} for ${payload.date}${payload.time ? ` at ${payload.time}` : ''}.`);
    hidden(form, 'message', 'GMT timesheet quick-record submission. XLSX and CSV attachments are included for accounts and Power Automate filing.');
    // FormSubmit preserves one file per multipart field reliably. Keeping
    // distinct names prevents the CSV from replacing the XLSX attachment.
    addFileInput(form, 'attachment', files.workbook);
    addFileInput(form, 'attachment_csv', files.csv);
    document.body.appendChild(form);
    return form;
  }

  function buildPayload(card) {
    const profile = portalProfile();
    const action = card.elements.clock_action.value;
    return {
      employeeName: card.elements.employee_name.value.trim(),
      employeeEmail: String(profile.username || '').trim(),
      notificationEmail: String(profile.notificationEmail || '').trim(),
      action,
      actionLabel: actionLabel(action),
      date: card.elements.clock_date.value || localDate(),
      time: EVENT_ACTIONS.includes(action) ? (card.elements.clock_time.value || localTime()) : '',
      absenceReason: action === 'absent' ? (card.elements.absence_reason.value || '') : '',
      note: card.elements.clock_note.value.trim(),
      dayStart: card.elements.day_start.value || '',
      lunchStart: card.elements.day_lunch_start.value || '',
      lunchEnd: card.elements.day_lunch_end.value || '',
      dayFinish: card.elements.day_finish.value || '',
      submittedAt: new Date().toISOString()
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const card = event.currentTarget;
    const payload = buildPayload(card);
    const endpoint = timesheetEndpoint();
    if (!payload.employeeName) {
      showStatus(card, 'error', 'Enter your name first.');
      return;
    }
    if (!endpoint) {
      showStatus(card, 'error', 'Clock submission email is not configured yet.');
      return;
    }
    const fullDayError = validateFullDay(payload);
    if (fullDayError) {
      showStatus(card, 'error', fullDayError);
      return;
    }
    try {
      showStatus(card, 'ok', 'Preparing timesheet files...');
      if (typeof window.ensureXlsxLoaded !== 'function') throw new Error('Excel generator is not available.');
      await window.ensureXlsxLoaded();
      const files = buildClockFiles(payload);
      const form = createEmailForm(payload, files);
      form.submit();
      showStatus(card, 'ok', `${payload.actionLabel} sent for ${payload.date}${payload.time && payload.action !== 'full_day' && payload.action !== 'absent' ? ` at ${payload.time}` : ''}.`);
      card.elements.clock_date.value = localDate();
      card.elements.clock_time.value = localTime();
      card.elements.clock_note.value = '';
      setTimeout(() => form.remove(), 2000);
    } catch (_) {
      showStatus(card, 'error', 'Clock submission could not be sent.');
    }
  }

  function init() {
    document.querySelectorAll('[data-clock-form]').forEach((card) => {
      const action = card.dataset.defaultAction || 'clock_in';
      card.elements.clock_action.value = action;
      card.elements.clock_date.value = localDate();
      card.elements.clock_time.value = localTime();
      prefillClockIdentity(card);
      updateClockCard(card);
      card.querySelectorAll('[data-clock-action]').forEach((button) => {
        button.addEventListener('click', () => {
          card.elements.clock_action.value = button.dataset.clockAction;
          updateClockCard(card);
          showStatus(card, '', '');
        });
      });
      card.addEventListener('submit', handleSubmit);
    });
  }

  init();
  document.addEventListener('gmtportalidentity', (event) => {
    document.querySelectorAll('[data-clock-form]').forEach((card) => prefillClockIdentity(card, event.detail, true));
  });
})();
