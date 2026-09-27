// Reconciles corrected Microsoft 365 source variants without discarding valid
// daily rows from earlier messages. Derived from the previously deployed
// provider reconciliation Worker.
const MAX_RECORD_ID = 180;
function text(value, fallback = '', max = 6000) { return String(value == null ? fallback : value).trim().slice(0, max); }
function numberValue(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function validDate(value) { const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!match) return null; const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))); return date.toISOString().slice(0, 10) === match[0] ? date : null; }
function providerRowKey(row, index = 0) {
  const date = text(row && (row.date || row.recordDate || row.record_date || row.workDate || row.Date), '', 80).slice(0, 10);
  if (date) return date;
  return `row-${index}`;
}

function providerRowScore(row) {
  if (!row || typeof row !== 'object') return 0;
  let score = validDate(providerRowKey(row)) ? 10 : 0;
  const start = row.start || row.startTime || row.start_time || row.clockIn || row.clock_in;
  const finish = row.finish || row.finishTime || row.finish_time || row.clockOut || row.clock_out;
  if (start) score += 2;
  if (finish) score += 2;
  if (start && finish && String(start).trim() === String(finish).trim()) score -= 20;
  if (numberValue(row.workedMinutes ?? row.worked_minutes ?? row.workedHours ?? row.worked_hours) !== null) score += 2;
  return score;
}

function providerAbsenceCount(record) {
  const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {};
  const value = record && (record.absence_count ?? record.absenceCount ?? payload.absence_count ?? payload.absenceCount ?? payload.totals?.absenceCount ?? payload.totals?.absent);
  return numberValue(value);
}

function providerRowIsAbsenceOnly(row) {
  if (!row || typeof row !== 'object') return false;
  const absence = text(row.absenceReason ?? row.absence_reason ?? row.absenceStatus ?? row.absence_status ?? row.absence, '').toLowerCase();
  if (!absence || /^(na|none|no absence|not applicable|n\/a)$/.test(absence)) return false;
  const start = row.start ?? row.startTime ?? row.start_time ?? row.clockIn ?? row.clock_in;
  const finish = row.finish ?? row.finishTime ?? row.finish_time ?? row.clockOut ?? row.clock_out;
  const worked = numberValue(row.workedMinutes ?? row.worked_minutes ?? row.workedHours ?? row.worked_hours ?? row.hours ?? row.totalHours);
  return !text(start) && !text(finish) && (worked === null || worked === 0);
}

function mergeProviderRows(leftRows, rightRows, options = {}) {
  const byDate = new Map();
  const left = Array.isArray(leftRows) ? leftRows : [];
  const right = Array.isArray(rightRows) ? rightRows : [];
  const source = options.dropLeftAbsenceOnly ? left.filter((row) => !providerRowIsAbsenceOnly(row)).concat(right) : left.concat(right);
  source.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const key = providerRowKey(row, index);
    const current = byDate.get(key);
    if (!current || providerRowScore(row) >= providerRowScore(current)) byDate.set(key, row);
  });
  return [...byDate.values()];
}

function deduplicateProviderRecords(records) {
  const bySourceId = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = text(record && record.source_record_id, '', MAX_RECORD_ID) || `provider-row-${bySourceId.size}`;
    const current = bySourceId.get(key);
    if (!current) {
      bySourceId.set(key, record);
      return;
    }
    const currentPayload = current.payload && typeof current.payload === 'object' ? current.payload : {};
    const nextPayload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    const currentUpdated = Date.parse(String(current.updated_at || current.submitted_at || '')) || 0;
    const nextUpdated = Date.parse(String(record.updated_at || record.submitted_at || '')) || 0;
    const preferred = nextUpdated >= currentUpdated && (record.employee_name || record.issue || nextPayload.rows?.length) ? record : current;
    const merged = { ...preferred };
    const preferredAbsenceCount = providerAbsenceCount(preferred);
    const older = preferred === record ? current : record;
    const olderPayload = older && older.payload && typeof older.payload === 'object' ? older.payload : {};
    const shouldDropStaleAbsences = preferredAbsenceCount === 0 && providerAbsenceCount(older) !== 0;
    const mergedRows = shouldDropStaleAbsences
      ? mergeProviderRows(olderPayload.rows, (preferred.payload && preferred.payload.rows) || [], { dropLeftAbsenceOnly: true })
      : mergeProviderRows(currentPayload.rows, nextPayload.rows);
    merged.payload = {
      ...currentPayload,
      ...nextPayload,
      // A corrected submission that explicitly reports zero absences is a
      // replacement for stale holiday-only rows from the same source ID.
      // Keep older worked rows so a partial correction cannot erase valid
      // days from the pay-month workbook.
      rows: mergedRows
    };
    if (preferredAbsenceCount !== null) merged.payload.absenceCount = preferredAbsenceCount;
    if (!merged.issue) merged.issue = current.issue || record.issue || '';
    bySourceId.set(key, merged);
  });
  return [...bySourceId.values()];
}

function providerEmployeeKey(record) {
  return text(record && (record.employee_upn || record.owner_upn || record.employee_email || record.employeeEmail || record.employee_name || record.employeeName), '').toLowerCase();
}

function providerWindow(record) {
  const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {};
  const start = text(record && (record.start_date || record.startDate || record.week_start || record.weekStart || payload.weekStart || payload.week_start), '').slice(0, 10);
  const end = text(record && (record.end_date || record.endDate || record.week_end || record.weekEnd || payload.weekEnd || payload.week_end), '').slice(0, 10);
  return { start: validDate(start) ? start : '', end: validDate(end) ? end : start };
}

function dateInProviderWindow(date, window) {
  return !!(date && window && window.start && window.end && date >= window.start && date <= window.end);
}

function removeStaleAbsenceRows(records) {
  const input = Array.isArray(records) ? records : [];
  const noAbsence = input.filter((record) => providerAbsenceCount(record) === 0 && providerEmployeeKey(record)).map((record) => ({
    record,
    employee: providerEmployeeKey(record),
    window: providerWindow(record),
    updated: Date.parse(String(record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || '')) || 0
  }));
  if (!noAbsence.length) return input;
  return input.map((record) => {
    const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : null;
    const rows = payload && Array.isArray(payload.rows) ? payload.rows : null;
    if (!rows || !rows.length) return record;
    const employee = providerEmployeeKey(record);
    const updated = Date.parse(String(record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || '')) || 0;
    const window = providerWindow(record);
    const replacement = noAbsence.some((candidate) => candidate.record !== record
      && candidate.employee === employee
      && candidate.updated > updated
      && candidate.window.start
      && candidate.window.end
      && candidate.window.start <= window.end
      && candidate.window.end >= window.start);
    if (!replacement) return record;
    const filtered = rows.filter((row) => {
      if (!providerRowIsAbsenceOnly(row)) return true;
      const date = providerRowKey(row, 0);
      return !noAbsence.some((candidate) => candidate.record !== record
        && candidate.employee === employee
        && candidate.updated > updated
        && dateInProviderWindow(date, candidate.window));
    });
    if (filtered.length === rows.length) return record;
    return { ...record, payload: { ...payload, rows: filtered } };
  });
}


export { deduplicateProviderRecords, removeStaleAbsenceRows };
