const CONFIG = window.GMT_APP_CONFIG || {};
const STORAGE_KEY = 'gmt_guest_timesheet_draft_v3';
const HOLIDAY_PAID_MINUTES = 8 * 60;
const BASIC_DAY_MINUTES = 8 * 60;

const daysContainer = document.getElementById('days-container');
const form = document.getElementById('timesheet-form');
const addDayBtn = document.getElementById('add-day-btn');
const generateDaysBtn = document.getElementById('generate-days-btn');
const addAbsenceBtn = document.getElementById('add-absence-btn');
const absenceRangesEl = document.getElementById('absence-ranges');
const summaryOutput = document.getElementById('summary-output');
const formError = document.getElementById('form-error');
const employeeName = document.getElementById('employee-name');
const employeeEmail = document.getElementById('employee-email');
const weekStart = document.getElementById('week-start');
const weekEnd = document.getElementById('week-end');
const absenceStart = document.getElementById('absence-start');
const absenceEnd = document.getElementById('absence-end');
const absenceReason = document.getElementById('absence-reason');
const absencePlanner = document.getElementById('absence-planner');
const payloadInput = document.getElementById('timesheet-payload');
const calculatedSummaryInput = document.getElementById('calculated-summary');
const saveDraftBtn = document.getElementById('save-draft-btn');
const clearDraftBtn = document.getElementById('clear-draft-btn');

let dayCount = 0;
let absenceRanges = [];

function pad(num) { return String(num).padStart(2, '0'); }
function isoDate(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function dateObj(value) { return value ? new Date(`${value}T00:00:00`) : null; }
function dayName(dateString) {
  const date = dateObj(dateString);
  if (!date || Number.isNaN(date.getTime())) return '';
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}
function parseTimeToMinutes(value) {
  if (!value) return null;
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
function isFullDayAbsence(row) { return row.absenceStatus === 'Sick' || row.absenceStatus === 'Holiday'; }
function hasAbsenceReason(row) { return row.absenceStatus && row.absenceStatus !== 'NA'; }
function isPaidHoliday(row) { return row.absenceStatus === 'Holiday'; }
function isTimeOff(row) { return row.absenceStatus === 'Time Off'; }
function parseLunchMinutes(row) { return row.lunchHad ? 60 : 0; }
function rawShiftMinutes(row) {
  const start = parseTimeToMinutes(row.start);
  const finish = parseTimeToMinutes(row.finish);
  if (start === null || finish === null) return null;
  let adjustedFinish = finish;
  if (adjustedFinish < start) adjustedFinish += 1440;
  return adjustedFinish - start;
}
function workedMinutes(row) {
  if (isFullDayAbsence(row)) return 0;
  const raw = rawShiftMinutes(row);
  if (raw === null) return null;
  const total = raw - parseLunchMinutes(row);
  return total >= 0 ? total : null;
}
function fmtMinutes(minutes) {
  const value = Math.round(Number(minutes || 0));
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${pad(m)}m`;
}
function splitSaturday(row) {
  let start = parseTimeToMinutes(row.start);
  let finish = parseTimeToMinutes(row.finish);
  if (start === null || finish === null) return { basic:0, ot15:0, ot20:0, total:null };
  if (finish < start) finish += 1440;
  const cutoff = 13 * 60;
  let before = Math.max(0, Math.min(finish, cutoff) - start);
  let after = Math.max(0, finish - Math.max(start, cutoff));
  let lunch = parseLunchMinutes(row);
  const fromAfter = Math.min(after, lunch);
  after -= fromAfter;
  lunch -= fromAfter;
  const fromBefore = Math.min(before, lunch);
  before -= fromBefore;
  return { basic:0, ot15:before, ot20:after, total:before + after };
}
function calculateRows(rows) {
  let weekdayBasicUsed = 0;
  return rows.map((row) => {
    const day = dayName(row.date);
    if (row.absenceStatus === 'Holiday') {
      return { ...row, dayName:day, total:HOLIDAY_PAID_MINUTES, basic:HOLIDAY_PAID_MINUTES, ot15:0, ot20:0, absent:true, paid:true, note:'Holiday is paid at basic rate.' };
    }
    if (row.absenceStatus === 'Sick') {
      return { ...row, dayName:day, total:0, basic:0, ot15:0, ot20:0, absent:true, paid:false, sick:true, note:'Sick day recorded. Sick entitlement must be handled by admin/payroll.' };
    }

    const total = workedMinutes(row);
    if (total === null) {
      return { ...row, dayName:day, total:null, basic:0, ot15:0, ot20:0, absent:false, paid:true, error:'Start and finish are required unless absence reason is Sick or Holiday.' };
    }
    if (row.absenceStatus === 'Time Off' && total >= BASIC_DAY_MINUTES) {
      return { ...row, dayName:day, total, basic:0, ot15:0, ot20:0, absent:false, paid:true, error:'Time Off can only be selected when the completed hours are less than 8h.' };
    }
    if (day === 'Sunday') return { ...row, dayName:day, total, basic:0, ot15:0, ot20:total, absent:false, paid:true, note:'Sunday is OT x2.0.' };
    if (day === 'Saturday') return { ...row, dayName:day, ...splitSaturday(row), absent:false, paid:true, note:row.absenceStatus === 'Time Off' ? 'Partial day with Time Off. Saturday rules still apply to worked time.' : 'Saturday before 1pm is OT x1.5; after 1pm is OT x2.0.' };
    const allowance = Math.max(0, 40 * 60 - weekdayBasicUsed);
    const basic = Math.min(total, allowance);
    const ot15 = total - basic;
    weekdayBasicUsed += basic;
    return { ...row, dayName:day, total, basic, ot15, ot20:0, absent:false, paid:true, note:row.absenceStatus === 'Time Off' ? 'Partial day with Time Off. Completed time is calculated.' : (ot15 ? 'Weekday excess after 40h is OT x1.5.' : 'Weekday basic time.') };
  });
}
function totalsFor(calculatedRows) {
  return calculatedRows.reduce((acc, row) => {
    acc.total += row.total || 0;
    acc.basic += row.basic || 0;
    acc.ot15 += row.ot15 || 0;
    acc.ot20 += row.ot20 || 0;
    if (row.absent) acc.absent += 1;
    if (row.absenceStatus === 'Holiday') acc.holiday += 1;
    if (row.absenceStatus === 'Sick') acc.sick += 1;
    if (row.absenceStatus === 'Time Off') acc.timeOff += 1;
    if (row.error) acc.errors.push(`${row.label || row.date || 'A day'}: ${row.error}`);
    return acc;
  }, { total:0, basic:0, ot15:0, ot20:0, absent:0, holiday:0, sick:0, timeOff:0, errors:[] });
}
function defaultDateForNextDay() {
  const start = weekStart.value;
  if (!start) return '';
  const date = dateObj(start);
  date.setDate(date.getDate() + dayCount);
  return isoDate(date);
}
function escapeAttr(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeHtml(value) { return escapeAttr(value); }
function dateInRange(date, start, end) {
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
}
function absenceForDate(date) {
  return absenceRanges.find((range) => dateInRange(date, range.start, range.end))?.reason || 'NA';
}
function addDay(data = {}) {
  dayCount += 1;
  const index = dayCount;
  const dateValue = data.date || defaultDateForNextDay();
  const absenceStatus = data.absenceStatus || 'NA';
  const card = document.createElement('article');
  card.className = data.collapsed ? 'day-card is-collapsed' : 'day-card';
  card.dataset.dayIndex = String(index);
  card.innerHTML = `
    <div class="day-card-header">
      <button type="button" class="collapse-day" aria-expanded="${data.collapsed ? 'false' : 'true'}" aria-controls="day_body_${index}">
        <span class="collapse-icon" aria-hidden="true">${data.collapsed ? '-' : '^'}</span>
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
          <input type="date" name="day_${index}_date" data-field="date" value="${dateValue}" />
        </label>
        <label>Start
          <input type="time" name="day_${index}_start" data-field="start" value="${escapeAttr(data.start || '')}" />
        </label>
        <label>Finish
          <input type="time" name="day_${index}_finish" data-field="finish" value="${escapeAttr(data.finish || '')}" />
        </label>
      </div>
      <div class="toggle-row lunch-row-core">
        <label class="check-card"><input type="checkbox" data-field="lunchHad" ${data.lunchHad ? 'checked' : ''} /> Lunch had? <span class="hint-inline">Deducts 1 hour</span></label>
      </div>
      <details class="additional-fields">
        <summary>Additional fields <span>optional</span></summary>
        <div class="additional-fields-body">
          <label>Absence reason
            <select name="day_${index}_absence_status" data-field="absenceStatus">
              <option value="NA" ${absenceStatus === 'NA' ? 'selected' : ''}>NA</option>
              <option value="Sick" ${absenceStatus === 'Sick' ? 'selected' : ''}>Sick</option>
              <option value="Holiday" ${absenceStatus === 'Holiday' ? 'selected' : ''}>Holiday</option>
              <option value="Time Off" ${absenceStatus === 'Time Off' ? 'selected' : ''}>Time Off</option>
            </select>
          </label>
          <p class="small-text absence-help">Holiday pays 8h basic. Sick is recorded for payroll/admin. Time Off can only be used when worked time is less than 8h.</p>
          <label>Location / site
            <input type="text" name="day_${index}_location" data-field="location" value="${escapeAttr(data.location || '')}" placeholder="Optional site or job address" />
          </label>
          <label class="file-pick">Images / job photos
            <span class="file-control"><span class="file-button">Choose photos</span><span class="file-name">No photos selected</span></span>
            <input type="file" data-field="images" name="day_${index}_images" accept="image/*" multiple />
          </label>
          <label>Description of work / notes
            <textarea data-field="description" name="day_${index}_description" rows="3" placeholder="Optional notes">${escapeHtml(data.description || '')}</textarea>
          </label>
        </div>
      </details>
    </div>
    <div class="day-result" aria-live="polite"></div>
  `;
  daysContainer.appendChild(card);
  card.addEventListener('input', handleInput);
  card.addEventListener('change', handleInput);
  card.querySelector('.remove-day').addEventListener('click', () => {
    card.remove();
    recalculate();
    saveDraft();
  });
  card.querySelector('.collapse-day').addEventListener('click', () => toggleDayCard(card));
  card.querySelector('[data-field="images"]').addEventListener('change', (event) => updateFileLabel(event.currentTarget));
  applyAbsenceState(card);
  recalculate();
}
function toggleDayCard(card, forceCollapsed = null) {
  const willCollapse = forceCollapsed === null ? !card.classList.contains('is-collapsed') : forceCollapsed;
  card.classList.toggle('is-collapsed', willCollapse);
  const button = card.querySelector('.collapse-day');
  const icon = card.querySelector('.collapse-icon');
  if (button) button.setAttribute('aria-expanded', String(!willCollapse));
  if (icon) icon.textContent = willCollapse ? '-' : '^';
  saveDraft();
}
function updateFileLabel(input) {
  const label = input.closest('.file-pick')?.querySelector('.file-name');
  if (!label) return;
  const count = input.files ? input.files.length : 0;
  label.textContent = count === 0 ? 'No photos selected' : `${count} photo${count === 1 ? '' : 's'} selected`;
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
    if (locked) {
      if (input.type === 'checkbox') input.checked = false;
      else input.value = '';
    }
  });
}
function getRows() {
  return [...document.querySelectorAll('.day-card')].map((card, i) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`);
    return {
      label:`Day ${i + 1}`,
      collapsed:card.classList.contains('is-collapsed'),
      date:get('date')?.value || '',
      start:get('start')?.value || '',
      finish:get('finish')?.value || '',
      lunchHad:!!get('lunchHad')?.checked,
      absenceStatus:get('absenceStatus')?.value || 'NA',
      location:get('location')?.value || '',
      description:get('description')?.value || ''
    };
  });
}
function updateMiniSummary(card, row) {
  const summary = card.querySelector('.day-mini-summary');
  if (!summary) return;
  const bits = [];
  if (row.dayName) bits.push(row.dayName);
  if (row.date) bits.push(row.date);
  if (hasAbsenceReason(row)) bits.push(row.absenceStatus === 'Holiday' ? 'Holiday paid basic' : row.absenceStatus);
  if (!isFullDayAbsence(row) && (row.start || row.finish)) bits.push(`${row.start || '?'}–${row.finish || '?'}`);
  if (!isFullDayAbsence(row) && row.lunchHad) bits.push('Lunch 1h');
  if (row.location) bits.push(row.location);
  summary.textContent = bits.length ? bits.join(' · ') : 'Not filled in yet';
}
function recalculate() {
  const calculated = calculateRows(getRows());
  const totals = totalsFor(calculated);
  calculated.forEach((row, i) => {
    const card = document.querySelectorAll('.day-card')[i];
    const out = card?.querySelector('.day-result');
    if (!out) return;
    updateMiniSummary(card, row);
    if (row.error) out.innerHTML = `<span class="pill bad">${row.error}</span>`;
    else if (row.absenceStatus === 'Holiday') out.innerHTML = `<span class="pill warn">Holiday</span><span>Paid basic ${fmtMinutes(row.basic)}</span>`;
    else if (row.absenceStatus === 'Sick') out.innerHTML = `<span class="pill warn">Sick</span><span>Recorded for payroll</span>`;
    else if (row.absenceStatus === 'Time Off') out.innerHTML = `<span class="pill warn">Time Off</span><span>Worked ${fmtMinutes(row.total)}</span><span>Basic ${fmtMinutes(row.basic)}</span>`;
    else out.innerHTML = `<span class="pill">${row.dayName || 'No date'}</span><span>Worked ${fmtMinutes(row.total)}</span><span>Basic ${fmtMinutes(row.basic)}</span><span>OT 1.5 ${fmtMinutes(row.ot15)}</span><span>OT 2.0 ${fmtMinutes(row.ot20)}</span>`;
  });
  const weighted = totals.basic / 60 + (totals.ot15 / 60) * 1.5 + (totals.ot20 / 60) * 2;
  summaryOutput.innerHTML = `
    <div><strong>Actual/paid hours</strong><span>${fmtMinutes(totals.total)}</span></div>
    <div><strong>Basic</strong><span>${fmtMinutes(totals.basic)}</span></div>
    <div><strong>OT x1.5</strong><span>${fmtMinutes(totals.ot15)}</span></div>
    <div><strong>OT x2.0</strong><span>${fmtMinutes(totals.ot20)}</span></div>
    <div><strong>Paid weighted hours</strong><span>${weighted.toFixed(2)}h</span></div>
    <div><strong>Holiday days</strong><span>${totals.holiday}</span></div>
    <div><strong>Sick days</strong><span>${totals.sick}</span></div>
    <div><strong>Time Off days</strong><span>${totals.timeOff}</span></div>
  `;
  const payload = buildPayload(calculated, totals, weighted);
  payloadInput.value = JSON.stringify(payload, null, 2);
  calculatedSummaryInput.value = `Paid ${fmtMinutes(totals.total)} | Basic ${fmtMinutes(totals.basic)} | OT x1.5 ${fmtMinutes(totals.ot15)} | OT x2.0 ${fmtMinutes(totals.ot20)} | Weighted ${weighted.toFixed(2)}h | Holiday ${totals.holiday} | Sick ${totals.sick} | Time Off ${totals.timeOff}`;
  return { calculated, totals, weighted, payload };
}
function buildPayload(calculated, totals, weighted) {
  return {
    submittedAt:new Date().toISOString(),
    employeeName:employeeName.value.trim(),
    employeeEmail:employeeEmail.value.trim(),
    weekStart:weekStart.value,
    weekEnd:weekEnd.value,
    absenceRanges:absenceRanges.map((range) => ({ start:range.start, end:range.end, reason:range.reason })),
    totals:{ ...totals, weightedHours:weighted },
    rows:calculated
  };
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
function addAbsenceRange() {
  clearError();
  if (!absenceStart.value || !absenceEnd.value) return showError('Choose an absence start and end date.');
  if (dateObj(absenceStart.value) > dateObj(absenceEnd.value)) return showError('Absence start must be before or equal to absence end.');
  absenceRanges.push({ start:absenceStart.value, end:absenceEnd.value, reason:absenceReason.value });
  renderAbsenceRanges();
  generateDaysFromRange(true);
  saveDraft();
}
function generateDaysFromRange(preserveManualRows = false) {
  clearError();
  if (!weekStart.value || !weekEnd.value) return showError('Choose a week starting and week ending date first.');
  const start = dateObj(weekStart.value);
  const end = dateObj(weekEnd.value);
  if (start > end) return showError('Week starting must be before or equal to week ending.');
  const existing = preserveManualRows ? new Map(getRows().map((row) => [row.date, row])) : new Map();
  daysContainer.innerHTML = '';
  dayCount = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const date = isoDate(cursor);
    const existingRow = existing.get(date) || {};
    const reason = absenceForDate(date);
    addDay({ ...existingRow, date, absenceStatus: reason, collapsed: dayCount > 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  recalculate();
  saveDraft();
}
function showError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden');
}
function clearError() {
  formError.textContent = '';
  formError.classList.add('hidden');
  formError.classList.remove('success');
  formError.classList.add('banner');
}
function handleInput(event) {
  clearError();
  const card = event?.target?.closest('.day-card');
  if (event?.target?.matches('[data-field="absenceStatus"]') && card) applyAbsenceState(card);
  if (event?.target?.matches('[data-field="date"]') && card) {
    const newDate = event.target.value;
    const reason = absenceForDate(newDate);
    const absenceSelect = card.querySelector('[data-field="absenceStatus"]');
    if (absenceSelect && reason !== 'NA') {
      absenceSelect.value = reason;
      applyAbsenceState(card);
    }
  }
  if (event?.target?.matches('[data-field="images"]')) updateFileLabel(event.target);
  recalculate();
  scheduleDraftSave();
}
let saveTimer = null;
function scheduleDraftSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 700);
}
function saveDraft() {
  const draft = {
    employeeName:employeeName.value,
    employeeEmail:employeeEmail.value,
    weekStart:weekStart.value,
    weekEnd:weekEnd.value,
    absenceRanges,
    rows:getRows()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}
function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw);
    employeeName.value = draft.employeeName || '';
    employeeEmail.value = draft.employeeEmail || '';
    weekStart.value = draft.weekStart || '';
    weekEnd.value = draft.weekEnd || '';
    absenceRanges = draft.absenceRanges || [];
    renderAbsenceRanges();
    daysContainer.innerHTML = '';
    dayCount = 0;
    (draft.rows || []).forEach(addDay);
    return true;
  } catch {
    return false;
  }
}
function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
  absenceRanges = [];
  renderAbsenceRanges();
  daysContainer.innerHTML = '';
  dayCount = 0;
  addDay();
  recalculate();
}
function buildWorkbook(calculated, totals, weighted) {
  if (!window.XLSX) throw new Error('Excel generator is still loading. Please try again.');
  const summaryRows = [
    ['Employee', employeeName.value.trim()],
    ['Employee email', employeeEmail.value.trim()],
    ['Week start', weekStart.value],
    ['Week end', weekEnd.value],
    ['Paid/basic hours', totals.basic / 60],
    ['OT x1.5 hours', totals.ot15 / 60],
    ['OT x2.0 hours', totals.ot20 / 60],
    ['Paid weighted hours', weighted],
    ['Holiday days', totals.holiday],
    ['Sick days', totals.sick],
    ['Time Off days', totals.timeOff]
  ];
  const dayRows = calculated.map((row) => ({
    Day: row.label,
    Date: row.date,
    Weekday: row.dayName,
    Start: row.start,
    Finish: row.finish,
    Lunch: row.lunchHad ? 'Yes - 1h deducted' : 'No',
    'Absence reason': row.absenceStatus,
    Location: row.location,
    Description: row.description,
    'Paid/worked hours': (row.total || 0) / 60,
    'Basic hours': (row.basic || 0) / 60,
    'OT x1.5 hours': (row.ot15 || 0) / 60,
    'OT x2.0 hours': (row.ot20 || 0) / 60,
    Note: row.note || row.error || ''
  }));
  const absenceRows = absenceRanges.map((range) => ({ From: range.start, To: range.end, Reason: range.reason }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dayRows), 'Daily Entries');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(absenceRows.length ? absenceRows : [{ From:'', To:'', Reason:'No absence periods marked' }]), 'Absence Periods');
  const array = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  return new File([array], `GMT Timesheet - ${employeeName.value.trim() || 'Employee'} - ${weekStart.value || 'week'}.xlsx`, {
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
async function submitTimesheet(event) {
  event.preventDefault();
  clearError();
  const { calculated, totals, weighted } = recalculate();
  if (!employeeName.value.trim()) return showError('Please enter your full name before submitting.');
  if (!getRows().length) return showError('Please add at least one day.');
  if (totals.errors.length) return showError(totals.errors.join(' '));
  if (!CONFIG.formSubmitEndpoint) return showError('FormSubmit is not configured yet. Set window.GMT_APP_CONFIG.formSubmitEndpoint in config.js.');
  const formData = new FormData(form);
  if (CONFIG.formSubmitCc) formData.append('_cc', CONFIG.formSubmitCc);
  if (employeeEmail.value.trim()) formData.append('_replyto', employeeEmail.value.trim());
  formData.append('attachment', buildWorkbook(calculated, totals, weighted));
  try {
    const response = await fetch(CONFIG.formSubmitEndpoint, { method:'POST', body:formData, headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error('FormSubmit rejected the submission.');
    localStorage.removeItem(STORAGE_KEY);
    form.reset();
    absenceRanges = [];
    renderAbsenceRanges();
    daysContainer.innerHTML = '';
    dayCount = 0;
    addDay();
    showError('Timesheet submitted successfully.');
    formError.classList.remove('banner');
    formError.classList.add('success');
  } catch (err) {
    showError(err.message || 'Submission failed.');
  }
}

addDayBtn.addEventListener('click', () => {
  document.querySelectorAll('.day-card').forEach((card) => toggleDayCard(card, true));
  addDay();
  saveDraft();
  daysContainer.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'start' });
});
generateDaysBtn.addEventListener('click', () => generateDaysFromRange(true));
addAbsenceBtn.addEventListener('click', addAbsenceRange);
absencePlanner.addEventListener('toggle', () => document.body.classList.toggle('absence-planner-open', absencePlanner.open));
absenceRangesEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-absence]');
  if (!button) return;
  absenceRanges.splice(Number(button.dataset.removeAbsence), 1);
  renderAbsenceRanges();
  generateDaysFromRange(true);
  saveDraft();
});
saveDraftBtn.addEventListener('click', () => { saveDraft(); showError('Draft saved on this device.'); });
clearDraftBtn.addEventListener('click', () => { if (confirm('Clear this draft?')) clearDraft(); });
form.addEventListener('submit', submitTimesheet);
[employeeName, employeeEmail, weekStart, weekEnd, absenceStart, absenceEnd, absenceReason].forEach((el) => {
  el.addEventListener('input', handleInput);
  el.addEventListener('change', handleInput);
});
weekStart.addEventListener('change', () => {
  if (weekStart.value && !weekEnd.value) {
    const end = dateObj(weekStart.value);
    end.setDate(end.getDate() + 6);
    weekEnd.value = isoDate(end);
  }
});

renderAbsenceRanges();
if (!loadDraft()) addDay();
document.body.classList.toggle('absence-planner-open', absencePlanner.open);
recalculate();
