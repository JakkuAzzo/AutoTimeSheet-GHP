const CONFIG = window.GMT_APP_CONFIG || {};
const STORAGE_KEY = 'gmt_guest_timesheet_manual_draft_v1';
const HOLIDAY_PAID_MINUTES = 8 * 60;
const BASIC_DAY_MINUTES = 8 * 60;
const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

const form = document.getElementById('timesheet-form');
const daysContainer = document.getElementById('days-container');
const summaryOutput = document.getElementById('summary-output');
const formError = document.getElementById('form-error');
const addDayBtn = document.getElementById('add-day-btn');
const generateDaysBtn = document.getElementById('generate-days-btn');
const addAbsenceBtn = document.getElementById('add-absence-btn');
const absenceRangesEl = document.getElementById('absence-ranges');
const employeeName = document.getElementById('employee-name');
const employeeEmail = document.getElementById('employee-email');
const weekStart = document.getElementById('week-start');
const weekEnd = document.getElementById('week-end');
const absenceStart = document.getElementById('absence-start');
const absenceEnd = document.getElementById('absence-end');
const absenceReason = document.getElementById('absence-reason');
const saveDraftBtn = document.getElementById('save-draft-btn');
const clearDraftBtn = document.getElementById('clear-draft-btn');
const payloadInput = document.getElementById('timesheet-payload');
const calculatedSummaryInput = document.getElementById('calculated-summary');

let dayCount = 0;
let absenceRanges = [];
let recalculateTimer = null;
let xlsxPromise = null;

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateObj(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function dayName(value) {
  const date = dateObj(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

function parseTimeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function normaliseBreakMinutes(value) {
  const minutes = Number(value || 0);
  return [0, 30, 60].includes(minutes) ? minutes : 0;
}

function fmtMinutes(minutes) {
  const value = Math.round(Number(minutes || 0));
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 60)}h ${pad(abs % 60)}m`;
}

function hours(minutes) {
  return Number((Number(minutes || 0) / 60).toFixed(2));
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function isFullDayAbsence(row) {
  return row.absenceStatus === 'Sick' || row.absenceStatus === 'Holiday';
}

function breakLabel(minutes) {
  const value = normaliseBreakMinutes(minutes);
  if (value === 30) return '30 minutes deducted';
  if (value === 60) return '60 minutes deducted';
  return 'No break';
}

function dateInRange(date, start, end) {
  return !!date && !!start && !!end && date >= start && date <= end;
}

function absenceForDate(date) {
  return absenceRanges.find((range) => dateInRange(date, range.start, range.end))?.reason || 'NA';
}

function clearMessage() {
  formError.textContent = '';
  formError.classList.add('hidden');
  formError.classList.remove('success');
  formError.classList.add('banner');
}

function showError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden', 'success');
  formError.classList.add('banner');
}

function showSuccess(message) {
  formError.textContent = message;
  formError.classList.remove('hidden', 'banner');
  formError.classList.add('success');
}

function defaultDateForNextDay() {
  const start = dateObj(weekStart.value);
  if (!start) return '';
  start.setDate(start.getDate() + dayCount);
  return isoDate(start);
}

function renderAbsenceRanges() {
  if (!absenceRanges.length) {
    absenceRangesEl.innerHTML = '<p class="small-text">No absence periods marked.</p>';
    return;
  }
  absenceRangesEl.innerHTML = absenceRanges.map((range, index) => `
    <div class="absence-chip absence-chip-${range.reason.toLowerCase().replace(/\s+/g, '-')}">
      <span>${escapeHtml(range.reason)}: ${escapeHtml(range.start)} to ${escapeHtml(range.end)}</span>
      <button type="button" data-remove-absence="${index}" aria-label="Remove absence period">Remove</button>
    </div>
  `).join('');
}

function renderRows(rows) {
  daysContainer.innerHTML = '';
  dayCount = 0;
  rows.forEach(addDay);
  recalculate();
}

function addDay(data = {}) {
  dayCount += 1;
  const index = dayCount;
  const dateValue = data.date || defaultDateForNextDay();
  const absenceStatus = data.absenceStatus || 'NA';
  const startValue = data.start ?? '08:00';
  const finishValue = data.finish ?? '17:00';
  const breakMinutes = normaliseBreakMinutes(data.lunchMinutes);
  const card = document.createElement('article');
  card.className = data.collapsed ? 'day-card is-collapsed' : 'day-card';
  card.dataset.dayIndex = String(index);
  card.innerHTML = `
    <div class="day-card-header">
      <button type="button" class="collapse-day" aria-expanded="${data.collapsed ? 'false' : 'true'}" aria-controls="day_body_${index}">
        <span class="collapse-icon" aria-hidden="true">${data.collapsed ? '+' : '^'}</span>
        <span class="sr-only">Toggle day ${index}</span>
      </button>
      <div class="day-title-block">
        <h3>Day ${index}</h3>
        <p class="day-mini-summary">Not filled in yet</p>
      </div>
      <button type="button" class="icon-btn remove-day" aria-label="Remove day ${index}">Remove</button>
    </div>
    <div class="day-card-body" id="day_body_${index}">
      <div class="form-grid day-grid compact-grid core-fields">
        <label>Date
          <input type="date" name="day_${index}_date" data-field="date" value="${escapeHtml(dateValue)}">
        </label>
        <label>Start
          <input type="time" name="day_${index}_start" data-field="start" value="${escapeHtml(startValue)}">
        </label>
        <label>Finish
          <input type="time" name="day_${index}_finish" data-field="finish" value="${escapeHtml(finishValue)}">
        </label>
        <label>Break
          <select name="day_${index}_break" data-field="lunchHad">
            <option value="0" ${breakMinutes === 0 ? 'selected' : ''}>No break</option>
            <option value="30" ${breakMinutes === 30 ? 'selected' : ''}>30 minute break</option>
            <option value="60" ${breakMinutes === 60 ? 'selected' : ''}>1 hour break</option>
          </select>
        </label>
        <label>Absence reason
          <select name="day_${index}_absence_status" data-field="absenceStatus">
            <option value="NA" ${absenceStatus === 'NA' ? 'selected' : ''}>NA</option>
            <option value="Sick" ${absenceStatus === 'Sick' ? 'selected' : ''}>Sick</option>
            <option value="Holiday" ${absenceStatus === 'Holiday' ? 'selected' : ''}>Holiday</option>
            <option value="Time Off" ${absenceStatus === 'Time Off' ? 'selected' : ''}>Time Off</option>
          </select>
        </label>
      </div>
      <details class="additional-fields">
        <summary>Additional fields <span>optional</span></summary>
        <div class="additional-fields-body">
          <p class="small-text absence-help">Holiday pays 8h basic. Sick is recorded for payroll/admin. Time Off can only be used when worked time is less than 8h.</p>
          <label>Notes
            <textarea data-field="description" name="day_${index}_description" rows="3" placeholder="Optional notes">${escapeHtml(data.description || '')}</textarea>
          </label>
        </div>
      </details>
    </div>
    <div class="day-result" aria-live="polite"></div>
  `;
  daysContainer.appendChild(card);
  applyAbsenceState(card);
  syncCardCollapse(card);
}

function syncCardCollapse(card) {
  const collapsed = card.classList.contains('is-collapsed');
  const body = card.querySelector('.day-card-body');
  const result = card.querySelector('.day-result');
  const button = card.querySelector('.collapse-day');
  const icon = card.querySelector('.collapse-icon');
  if (body) body.hidden = collapsed;
  if (result) result.hidden = collapsed;
  if (button) button.setAttribute('aria-expanded', String(!collapsed));
  if (icon) icon.textContent = collapsed ? '+' : '^';
}

function toggleDayCard(card, forceCollapsed = null) {
  const collapsed = forceCollapsed === null ? !card.classList.contains('is-collapsed') : forceCollapsed;
  card.classList.toggle('is-collapsed', collapsed);
  syncCardCollapse(card);
}

function applyAbsenceState(card) {
  const status = card.querySelector('[data-field="absenceStatus"]')?.value || 'NA';
  const locked = status === 'Sick' || status === 'Holiday';
  card.classList.toggle('is-absence', status !== 'NA');
  card.classList.remove('absence-sick', 'absence-holiday', 'absence-time-off');
  if (status !== 'NA') card.classList.add(`absence-${status.toLowerCase().replace(/\s+/g, '-')}`);
  ['start', 'finish', 'lunchHad'].forEach((field) => {
    const input = card.querySelector(`[data-field="${field}"]`);
    if (!input) return;
    input.disabled = locked;
    if (locked) input.value = field === 'lunchHad' ? '0' : '';
  });
}

function getRows() {
  return [...daysContainer.querySelectorAll('.day-card')].map((card, index) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`);
    const lunchMinutes = normaliseBreakMinutes(get('lunchHad')?.value);
    return {
      label: `Day ${index + 1}`,
      collapsed: card.classList.contains('is-collapsed'),
      date: get('date')?.value || '',
      start: get('start')?.value || '',
      finish: get('finish')?.value || '',
      lunchHad: lunchMinutes > 0,
      lunchMinutes,
      absenceStatus: get('absenceStatus')?.value || 'NA',
      description: get('description')?.value || ''
    };
  });
}

function rawShiftMinutes(row) {
  const start = parseTimeToMinutes(row.start);
  const finish = parseTimeToMinutes(row.finish);
  if (start === null || finish === null) return null;
  return finish < start ? finish + 1440 - start : finish - start;
}

function workedMinutes(row) {
  if (isFullDayAbsence(row)) return 0;
  const raw = rawShiftMinutes(row);
  if (raw === null) return null;
  const total = raw - normaliseBreakMinutes(row.lunchMinutes);
  return total >= 0 ? total : null;
}

function splitSaturday(row) {
  const start = parseTimeToMinutes(row.start);
  let finish = parseTimeToMinutes(row.finish);
  if (start === null || finish === null) return { basic: 0, ot15: 0, ot20: 0, total: null, workedActual: null };
  if (finish < start) finish += 1440;
  const cutoff = 13 * 60;
  let before = Math.max(0, Math.min(finish, cutoff) - start);
  let after = Math.max(0, finish - Math.max(start, cutoff));
  let lunch = normaliseBreakMinutes(row.lunchMinutes);
  const fromAfter = Math.min(after, lunch);
  after -= fromAfter;
  lunch -= fromAfter;
  before -= Math.min(before, lunch);
  return { basic: 0, ot15: before, ot20: after, total: before + after, workedActual: before + after };
}

function calculateRows(rows) {
  return rows.map((row) => {
    const day = dayName(row.date);
    if (row.absenceStatus === 'Holiday') {
      return { ...row, dayName: day, workedActual: 0, total: HOLIDAY_PAID_MINUTES, basic: HOLIDAY_PAID_MINUTES, ot15: 0, ot20: 0, absent: true, note: 'Holiday counts as 8h basic.' };
    }
    if (row.absenceStatus === 'Sick') {
      return { ...row, dayName: day, workedActual: 0, total: 0, basic: 0, ot15: 0, ot20: 0, absent: true, note: 'Sick day recorded. Sick entitlement must be handled by admin/payroll.' };
    }
    const actual = workedMinutes(row);
    if (actual === null) {
      return { ...row, dayName: day, workedActual: null, total: null, basic: 0, ot15: 0, ot20: 0, absent: false, error: 'Start and finish are required unless absence reason is Sick or Holiday.' };
    }
    if (row.absenceStatus === 'Time Off') {
      return { ...row, dayName: day, workedActual: actual, total: actual, basic: actual, ot15: 0, ot20: 0, absent: false, note: 'Time Off records the completed worked hours only.' };
    }
    if (day === 'Sunday') return { ...row, dayName: day, workedActual: actual, total: actual, basic: 0, ot15: 0, ot20: actual, absent: false, note: 'Sunday is OT x2.0.' };
    if (day === 'Saturday') return { ...row, dayName: day, ...splitSaturday(row), absent: false, note: 'Saturday before 1pm is OT x1.5; after 1pm is OT x2.0.' };
    const basic = BASIC_DAY_MINUTES;
    const ot15 = Math.max(0, actual - BASIC_DAY_MINUTES);
    const workedActual = Math.max(actual, BASIC_DAY_MINUTES);
    return { ...row, dayName: day, workedActual, total: basic + ot15, basic, ot15, ot20: 0, absent: false, note: ot15 ? 'Weekday: 8h basic plus daily excess as OT x1.5.' : 'Weekday without absence records an 8h minimum.' };
  });
}

function applyWeeklyOvertimeThreshold(rows) {
  const weeklyBasic = rows.reduce((sum, row) => sum + (row.basic || 0), 0);
  const allowOvertime = weeklyBasic >= 40 * 60;
  return rows.map((row) => {
    const appliedOt15 = allowOvertime ? (row.ot15 || 0) : 0;
    const appliedOt20 = allowOvertime ? (row.ot20 || 0) : 0;
    const appliedBasic = row.basic || 0;
    const overtimeHeld = !allowOvertime && ((row.ot15 || 0) > 0 || (row.ot20 || 0) > 0);
    return {
      ...row,
      appliedBasic,
      appliedOt15,
      appliedOt20,
      appliedTotal: appliedBasic + appliedOt15 + appliedOt20,
      overtimeHeld
    };
  });
}

function totalsFor(rows) {
  return rows.reduce((acc, row) => {
    acc.workedActual += row.workedActual || 0;
    acc.total += row.appliedTotal ?? row.total ?? 0;
    acc.basic += row.appliedBasic ?? row.basic ?? 0;
    acc.ot15 += row.appliedOt15 ?? row.ot15 ?? 0;
    acc.ot20 += row.appliedOt20 ?? row.ot20 ?? 0;
    if (row.absent) acc.absent += 1;
    if (row.absenceStatus === 'Holiday') acc.holiday += 1;
    if (row.absenceStatus === 'Sick') acc.sick += 1;
    if (row.absenceStatus === 'Time Off') acc.timeOff += 1;
    if (row.error) acc.errors.push(`${row.label}: ${row.error}`);
    return acc;
  }, { workedActual: 0, total: 0, basic: 0, ot15: 0, ot20: 0, absent: 0, holiday: 0, sick: 0, timeOff: 0, errors: [] });
}

function statusFor(row) {
  if (row.error) return 'Check';
  if (row.absenceStatus === 'Sick' || row.absenceStatus === 'Holiday') return 'Absent';
  return 'Recorded';
}

function categoryFor(row) {
  if (row.error) return 'Issue';
  if (row.absenceStatus === 'Holiday') return 'Holiday';
  if (row.absenceStatus === 'Sick') return 'Sick';
  if (row.absenceStatus === 'Time Off') return 'Time Off';
  if (row.dayName === 'Sunday') return 'Sunday OT x2.0';
  if (row.dayName === 'Saturday') return 'Saturday OT';
  if ((row.ot15 || 0) > 0) return 'Weekday OT x1.5';
  return 'Basic day';
}

function weightedFor(row) {
  return hours(row.appliedBasic ?? row.basic) + hours(row.appliedOt15 ?? row.ot15) * 1.5 + hours(row.appliedOt20 ?? row.ot20) * 2;
}

function updateMiniSummary(card, row) {
  const summary = card.querySelector('.day-mini-summary');
  const bits = [];
  if (row.dayName) bits.push(row.dayName);
  if (row.date) bits.push(row.date);
  if (row.absenceStatus !== 'NA') bits.push(row.absenceStatus);
  if (!isFullDayAbsence(row) && (row.start || row.finish)) bits.push(`${row.start || '?'}-${row.finish || '?'}`);
  if (!isFullDayAbsence(row) && row.lunchMinutes) bits.push(breakLabel(row.lunchMinutes));
  summary.textContent = bits.length ? bits.join(' · ') : 'Not filled in yet';
}

function resultPill(label, minutes, className = '') {
  const classAttr = className ? ` class="${className}"` : '';
  return `<span${classAttr}>${escapeHtml(label)} - ${fmtMinutes(minutes)}</span>`;
}

function resultPills(row) {
  return [
    resultPill('Worked', row.workedActual),
    resultPill('Basic', row.basic),
    resultPill('OT 1.5', row.ot15),
    resultPill('OT 2.0', row.ot20)
  ].join('');
}

function recalculate() {
  const calculated = applyWeeklyOvertimeThreshold(calculateRows(getRows()));
  const totals = totalsFor(calculated);
  calculated.forEach((row, index) => {
    const card = daysContainer.querySelectorAll('.day-card')[index];
    if (!card) return;
    const output = card.querySelector('.day-result');
    updateMiniSummary(card, row);
    if (row.error) output.innerHTML = `<span class="pill bad">${escapeHtml(row.error)}</span>`;
    else if (row.absenceStatus === 'Holiday') output.innerHTML = `<span class="pill warn">Holiday</span>${resultPills(row)}`;
    else if (row.absenceStatus === 'Sick') output.innerHTML = `<span class="pill warn">Sick</span>${resultPills(row)}`;
    else output.innerHTML = `<span class="pill">${escapeHtml(row.dayName || 'No date')}</span>${resultPills(row)}`;
  });
  const weighted = totals.basic / 60 + (totals.ot15 / 60) * 1.5 + (totals.ot20 / 60) * 2;
  summaryOutput.innerHTML = `
    <div><strong>Worked hours</strong><span>${fmtMinutes(totals.workedActual)}</span></div>
    <div><strong>Basic</strong><span>${fmtMinutes(totals.basic)}</span></div>
    <div><strong>OT x1.5</strong><span>${fmtMinutes(totals.ot15)}</span></div>
    <div><strong>OT x2.0</strong><span>${fmtMinutes(totals.ot20)}</span></div>
    <div><strong>Weighted hours</strong><span>${weighted.toFixed(2)}h</span></div>
    <div><strong>Holiday days</strong><span>${totals.holiday}</span></div>
    <div><strong>Sick days</strong><span>${totals.sick}</span></div>
    <div><strong>Time Off days</strong><span>${totals.timeOff}</span></div>
  `;
  const payload = { employeeName: employeeName.value.trim(), employeeEmail: employeeEmail.value.trim(), weekStart: weekStart.value, weekEnd: weekEnd.value, absenceRanges, totals: { ...totals, weightedHours: weighted }, rows: calculated };
  payloadInput.value = JSON.stringify(payload);
  calculatedSummaryInput.value = `Worked ${fmtMinutes(totals.workedActual)} | Basic ${fmtMinutes(totals.basic)} | OT x1.5 ${fmtMinutes(totals.ot15)} | OT x2.0 ${fmtMinutes(totals.ot20)} | Weighted ${weighted.toFixed(2)}h | Holiday ${totals.holiday} | Sick ${totals.sick} | Time Off ${totals.timeOff}`;
  return { calculated, totals, weighted };
}

function scheduleRecalculate() {
  window.clearTimeout(recalculateTimer);
  recalculateTimer = window.setTimeout(recalculate, 120);
}

function addAbsenceRange() {
  clearMessage();
  if (!absenceStart.value || !absenceEnd.value) return showError('Choose an absence start and end date.');
  if (dateObj(absenceStart.value) > dateObj(absenceEnd.value)) return showError('Absence start must be before or equal to absence end.');
  absenceRanges.push({ start: absenceStart.value, end: absenceEnd.value, reason: absenceReason.value });
  renderAbsenceRanges();
  generateDaysFromRange(true);
}

function generateDaysFromRange(preserveRows = false) {
  clearMessage();
  if (!weekStart.value || !weekEnd.value) return showError('Choose a week starting and week ending date first.');
  const start = dateObj(weekStart.value);
  const end = dateObj(weekEnd.value);
  if (start > end) return showError('Week starting must be before or equal to week ending.');
  const existing = preserveRows ? new Map(getRows().map((row) => [row.date, row])) : new Map();
  const rows = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const date = isoDate(cursor);
    const reason = absenceForDate(date);
    rows.push({ ...(existing.get(date) || {}), date, absenceStatus: reason, collapsed: rows.length > 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  renderRows(rows);
}

function ensureXlsxLoaded() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_SRC;
      script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel generator loaded but was not available.'));
      script.onerror = () => reject(new Error('Could not load Excel generator. Please check the connection and try again.'));
      document.head.appendChild(script);
    });
  }
  return xlsxPromise;
}

function allRowsForExport(calculated) {
  return calculated.map((row) => ({
    Status: statusFor(row),
    Category: categoryFor(row),
    'Week start': weekStart.value,
    'Week end': weekEnd.value,
    Day: row.label,
    Date: row.date,
    Weekday: row.dayName,
    Start: row.start,
    Finish: row.finish,
    Break: breakLabel(row.lunchMinutes),
    'Absence reason': row.absenceStatus || 'NA',
    'Worked hours': hours(row.workedActual),
    'Basic hours': hours(row.appliedBasic ?? row.basic),
    'OT x1.5 hours': hours(row.appliedOt15 ?? row.ot15),
    'OT x2.0 hours': hours(row.appliedOt20 ?? row.ot20),
    'Weighted hours': Number(weightedFor(row).toFixed(2)),
    Note: [row.note || row.error || row.description || '', row.overtimeHeld ? 'Overtime calculated on this day but not added because weekly basic total is below 40h.' : ''].filter(Boolean).join(' ')
  }));
}

function buildWorkbook(calculated, totals, weighted) {
  const allRows = allRowsForExport(calculated);
  const totalsRows = [
    ['GMT Weekly Timesheet Totals'],
    [],
    ['Employee', employeeName.value.trim()],
    ['Employee email', employeeEmail.value.trim()],
    ['Week start', weekStart.value],
    ['Week end', weekEnd.value],
    [],
    ['Metric', 'Hours / Count'],
    ['Worked hours', hours(totals.workedActual)],
    ['Basic hours', hours(totals.basic)],
    ['OT x1.5 hours', hours(totals.ot15)],
    ['OT x2.0 hours', hours(totals.ot20)],
    ['Weighted hours', Number(weighted.toFixed(2))],
    ['Holiday days', totals.holiday],
    ['Sick days', totals.sick],
    ['Time Off days', totals.timeOff]
  ];
  const notesRows = [
    ['GMT Timesheet Notes'],
    [],
    ['Day', 'Date', 'Weekday', 'Category', 'Absence reason', 'Break', 'Note', 'Issue'],
    ...calculated.filter((row) => row.note || row.error || row.description || row.absenceStatus !== 'NA').map((row) => [
      row.label,
      row.date,
      row.dayName,
      categoryFor(row),
      row.absenceStatus || 'NA',
      breakLabel(row.lunchMinutes),
      row.description || row.note || '',
      row.error || ''
    ])
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(allRows), 'All');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(totalsRows), 'Totals');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(notesRows), 'Notes');
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([array], `GMT Timesheet - ${employeeName.value.trim() || 'Employee'} - ${weekStart.value || 'week'}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildCsvFile(calculated) {
  const rows = allRowsForExport(calculated);
  const header = Object.keys(rows[0] || {});
  const csv = [header, ...rows.map((row) => header.map((key) => row[key]))].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  return new File([csv], `GMT Timesheet - ${employeeName.value.trim() || 'Employee'} - ${weekStart.value || 'week'}.csv`, { type: 'text/csv' });
}

function setFileInputFiles(input, files) {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => dataTransfer.items.add(file));
  input.files = dataTransfer.files;
}

function formSubmitEndpoint() {
  return taggedFormSubmitEndpoint('timesheets');
}

function taggedFormSubmitEndpoint(tag) {
  const base = String(CONFIG.formSubmitEndpoint || '').replace('/ajax/', '/');
  return base.replace(/([^/?#/@]+)@([^/?#]+)/, (_, local, domain) => `${local.split('+')[0]}+${tag}@${domain}`);
}

function createEmailForm() {
  const iframe = document.createElement('iframe');
  iframe.name = 'formsubmit-frame';
  iframe.hidden = true;
  document.body.appendChild(iframe);
  const emailForm = document.createElement('form');
  emailForm.method = 'POST';
  emailForm.enctype = 'multipart/form-data';
  emailForm.target = 'formsubmit-frame';
  emailForm.hidden = true;
  emailForm.innerHTML = `
    <input type="hidden" name="_subject" data-clean-field="subject">
    <input type="hidden" name="_template" value="box">
    <input type="hidden" name="_captcha" value="false">
    <input type="hidden" name="_replyto" data-clean-field="replyto">
    <input type="hidden" name="_cc" data-clean-field="cc">
    <input type="hidden" name="employee_name" data-clean-field="employeeName">
    <input type="hidden" name="email" data-clean-field="employeeEmail">
    <input type="hidden" name="summary" data-clean-field="summary">
    <input type="hidden" name="message" data-clean-field="message">
    <input type="file" name="attachment" data-clean-field="xlsx">
    <input type="file" name="attachment_csv" data-clean-field="csv">
  `;
  document.body.appendChild(emailForm);
  return emailForm;
}

async function submitTimesheet(event) {
  event.preventDefault();
  clearMessage();
  const { calculated, totals, weighted } = recalculate();
  if (!employeeName.value.trim()) return showError('Please enter your full name before submitting.');
  if (!calculated.length) return showError('Please add at least one day.');
  if (totals.errors.length) return showError(totals.errors.join(' '));
  if (!CONFIG.formSubmitEndpoint) return showError('FormSubmit is not configured yet.');
  try {
    await ensureXlsxLoaded();
    const xlsxFile = buildWorkbook(calculated, totals, weighted);
    const csvFile = buildCsvFile(calculated);
    const emailForm = createEmailForm();
    const field = (name) => emailForm.querySelector(`[data-clean-field="${name}"]`);
    const userEmail = employeeEmail.value.trim();
    emailForm.action = formSubmitEndpoint();
    field('subject').value = `[GMT][TIMESHEET][SUBMISSION] ${employeeName.value.trim()} | Week ${weekStart.value || 'unspecified'}`;
    field('replyto').value = userEmail;
    field('cc').value = [CONFIG.formSubmitCc, userEmail].filter(Boolean).join(',');
    field('employeeName').value = employeeName.value.trim();
    field('employeeEmail').value = userEmail;
    field('summary').value = calculatedSummaryInput.value;
    field('message').value = 'Timesheet spreadsheets are attached. Please use the XLSX or CSV attachment for payroll/audit.';
    setFileInputFiles(field('xlsx'), [xlsxFile]);
    setFileInputFiles(field('csv'), [csvFile]);
    emailForm.submit();
    showSuccess('Timesheet sent with generated XLSX and CSV attachments.');
  } catch (error) {
    showError(error.message || 'Submission failed.');
  }
}

function saveDraftManually() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      employeeName: employeeName.value,
      employeeEmail: employeeEmail.value,
      weekStart: weekStart.value,
      weekEnd: weekEnd.value,
      absenceRanges,
      rows: getRows()
    }));
    showSuccess('Draft saved on this device. Draft loading is temporarily disabled while mobile input stability is verified.');
  } catch {
    showError('Draft could not be saved on this device. The form can still be submitted.');
  }
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
  showSuccess('Saved draft cleared on this device.');
}

form.addEventListener('input', (event) => {
  clearMessage();
  if (event.target.closest('.day-card')) scheduleRecalculate();
});

form.addEventListener('change', (event) => {
  clearMessage();
  const target = event.target;
  const card = target.closest('.day-card');
  if (target === weekStart && weekStart.value && !weekEnd.value) {
    const end = dateObj(weekStart.value);
    end.setDate(end.getDate() + 6);
    weekEnd.value = isoDate(end);
  }
  if (card && target.matches('[data-field="absenceStatus"]')) applyAbsenceState(card);
  if (card && target.matches('[data-field="date"]')) {
    const reason = absenceForDate(target.value);
    if (reason !== 'NA') {
      const select = card.querySelector('[data-field="absenceStatus"]');
      select.value = reason;
      applyAbsenceState(card);
    }
  }
  scheduleRecalculate();
});

daysContainer.addEventListener('click', (event) => {
  const collapseButton = event.target.closest('.collapse-day');
  if (collapseButton) {
    toggleDayCard(collapseButton.closest('.day-card'));
    return;
  }
  const removeButton = event.target.closest('.remove-day');
  if (removeButton) {
    removeButton.closest('.day-card').remove();
    recalculate();
  }
});

absenceRangesEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-absence]');
  if (!button) return;
  absenceRanges.splice(Number(button.dataset.removeAbsence), 1);
  renderAbsenceRanges();
  generateDaysFromRange(true);
});

addDayBtn.addEventListener('click', () => {
  daysContainer.querySelectorAll('.day-card').forEach((card) => toggleDayCard(card, true));
  addDay({ collapsed: false });
  recalculate();
  daysContainer.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

generateDaysBtn.addEventListener('click', () => generateDaysFromRange(true));
addAbsenceBtn.addEventListener('click', addAbsenceRange);
saveDraftBtn.addEventListener('click', saveDraftManually);
clearDraftBtn.addEventListener('click', clearDraft);
form.addEventListener('submit', submitTimesheet);

renderAbsenceRanges();
addDay();
recalculate();
