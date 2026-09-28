import payPeriods from '../pay-periods.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function field(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function recordRows(parsed) {
  if (Array.isArray(parsed)) return { envelope: {}, rows: parsed };
  if (!parsed || typeof parsed !== 'object') throw new Error('Record JSON must be an object or an array of dated rows.');
  if (Array.isArray(parsed.rows)) return { envelope: parsed, rows: parsed.rows };
  return { envelope: {}, rows: [parsed] };
}

/**
 * Reference validator for the attachment identity needed before the live flow
 * selects a company workbook. It does not mutate a workbook or send an email.
 */
function londonDate(input) {
  if (!input) return '';
  const instant = new Date(input);
  if (Number.isNaN(instant.getTime())) throw new Error('Invalid submittedAt timestamp.');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = key => parts.find(part => part.type === key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function partitionRecordAttachment(input, options = {}) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  const { envelope, rows } = recordRows(parsed);
  if (!rows.length) throw new Error('Record JSON has no dated rows.');
  const name = field(envelope.employeeName) || field(rows[0]?.employeeName);
  const email = field(envelope.employeeEmail) || field(rows[0]?.employeeEmail);
  if (!name || /[\\/<>:"|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('Invalid employee name for workbook routing.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A verified employee email is required.');
  const expectedMonth = field(envelope.payMonth);
  if (expectedMonth && !MONTH.test(expectedMonth)) throw new Error('Invalid declared pay month.');
  const dates = new Set();
  const rowsByMonth = new Map();
  const submissionIds = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Every record row must be an object.');
    if (field(row.employeeName).toLowerCase() !== name.toLowerCase() && field(row.employeeName)) throw new Error('Mixed employees in one attachment.');
    if (field(row.employeeEmail).toLowerCase() !== email.toLowerCase() && field(row.employeeEmail)) throw new Error('Mixed employee emails in one attachment.');
    const date = field(row.date || row.Date);
    if (!DATE.test(date)) throw new Error('Each row needs a valid Date.');
    const month = payPeriods.payMonthKeyForDate(date);
    if (!month) throw new Error('Invalid daily Date.');
    const absence = field(row.absenceReason || row.absenceStatus || row.absence || row.Absence);
    const worked = !absence || absence.toUpperCase() === 'NA';
    const submitted = londonDate(row.submittedAt || envelope.submittedAt);
    if (worked && submitted && date > submitted) throw new Error(`Future worked Date ${date} requires source review.`);
    if (worked && Array.isArray(options.rosterWeekdays)) {
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
      if (!options.rosterWeekdays.includes(weekday)) throw new Error(`Off-roster worked Date ${date} requires source review.`);
    }
    if (dates.has(date)) throw new Error(`Duplicate Date ${date} requires source review.`);
    dates.add(date);
    if (!rowsByMonth.has(month)) rowsByMonth.set(month, []);
    rowsByMonth.get(month).push(row);
    const declared = field(row.payMonth);
    if (declared && (!MONTH.test(declared) || declared !== month)) throw new Error(`Declared pay month disagrees with Date ${date}.`);
    const submissionId = field(row.submissionId);
    if (submissionId) submissionIds.add(submissionId);
  }
  if (submissionIds.size > 1) throw new Error('Mixed submission IDs in one attachment.');
  const recordId = field(envelope.recordId) || field(envelope.submissionId) || [...submissionIds][0] || field(rows[0].recordId);
  if (!recordId) throw new Error('A stable source record ID is required.');
  if (expectedMonth && (rowsByMonth.size !== 1 || !rowsByMonth.has(expectedMonth))) throw new Error('Envelope pay month disagrees with daily Dates.');
  if (field(envelope.mode) === 'replace-pay-month' && rowsByMonth.size !== 1) throw new Error('A replacement snapshot cannot span pay months.');
  return [...rowsByMonth].sort(([left], [right]) => left.localeCompare(right)).map(([payMonth, selected]) => {
    const [year, month] = payMonth.split('-');
    return {
      employeeName: name,
      employeeEmail: email.toLowerCase(),
      payMonth,
      recordId,
      dates: selected.map(row => field(row.date || row.Date)).sort(),
      mode: field(envelope.mode) || 'original',
      workbookPath: `/Timesheets/${year}/${month}/${name}/GMT Timesheet - ${name} - Pay Month ${payMonth}.xlsx`,
      recordJson: JSON.stringify(field(envelope.mode) === 'replace-pay-month' ? envelope : selected)
    };
  });
}

export function routeRecordAttachment(input, options = {}) {
  const routes = partitionRecordAttachment(input, options);
  if (routes.length !== 1) throw new Error('One attachment spans multiple pay months; process each Date partition separately.');
  return routes[0];
}
