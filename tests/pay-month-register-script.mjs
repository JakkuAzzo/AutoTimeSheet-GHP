import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const code = stripTypeScriptTypes(readFileSync(new URL('../power-platform/office-scripts/upsert-pay-month-register.ts', import.meta.url), 'utf8'));
const context = { ExcelScript: { ClearApplyTo: { contents: 'contents' } } };
vm.runInNewContext(code + '\nthis.runScript = main;', context);

function sheet(name, initial = []) {
  let cells = initial.map((row) => row.slice());
  const formulas = {};
  const noopFormat = { getFont: () => ({ setBold() {} }), setColumnWidth() {} };
  return {
    name,
    getName: () => name,
    rows: () => cells.map((row) => row.slice()),
    formulas: () => ({ ...formulas }),
    getUsedRange() { return cells.length ? { getRowIndex: () => 0, getRowCount: () => cells.length, clear: () => { cells = []; } } : null; },
    getRange(ref) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!match) {
        const single = /^([A-Z]+)(\d+)$/.exec(ref);
        return { getFormat: () => noopFormat, setFormula: (formula) => { formulas[ref] = formula; }, setNumberFormat() {} };
      }
      const startRow = Number(match[2]) - 1, endRow = Number(match[4]) - 1;
      const startCol = match[1].charCodeAt(0) - 65, endCol = match[3].charCodeAt(0) - 65;
      return {
        getValues: () => Array.from({ length: endRow - startRow + 1 }, (_, offset) => Array.from({ length: endCol - startCol + 1 }, (_, column) => cells[startRow + offset]?.[startCol + column] ?? '')),
        getFormat: () => noopFormat,
        setFormulas: (values) => { formulas[ref] = values; },
        setNumberFormat() {}
      };
    },
    getRangeByIndexes(startRow, startCol, rowCount, columnCount) {
      return { setValues(values) {
        assert.equal(values.length, rowCount);
        values.forEach((row, offset) => {
          assert.equal(row.length, columnCount);
          while (cells.length <= startRow + offset) cells.push([]);
          row.forEach((value, column) => { cells[startRow + offset][startCol + column] = value; });
        });
      } };
    },
    freezePanes: { freezeRows() {} }
  };
}
function workbook(options = {}) {
  const daily = sheet(options.lowercase ? 'Daily entries' : 'Daily Entries', options.dailyRows || [['Date', 'Start', 'Finish', 'Break', 'Absence', 'Total hours', 'Notes']]);
  const weekly = sheet(options.lowercase ? 'Weekly totals' : 'Weekly Totals', [['Week Start', 'Week End', 'Total hours']]);
  const sheets = [daily, weekly];
  return { daily, weekly, getName: () => 'GMT Timesheet - Matthew - Pay Month 2026-09.xlsx', getWorksheets: () => sheets, getWorksheet: (name) => sheets.find((item) => item.name === name) };
}

const book = workbook();
const dateCell = (value) => typeof value === 'number' ? new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10) : value;
const durationCell = (value) => Math.round(value * 1440);
const original = [
  { recordId: 'source-1|2026-09-03', employeeName: 'Matthew', date: '2026-09-03', startTime: '08:00', finishTime: '18:00', note: 'Break: 30 minute break' },
  { recordId: 'source-1|2026-09-04', employeeName: 'Matthew', date: '2026-09-04', startTime: '07:00', finishTime: '17:00', note: 'Break: No break' }
];
const first = context.runScript(book, JSON.stringify(original));
assert.equal(first.created, 2);
assert.equal(first.monthTotalMinutes, 1170);
assert.deepEqual(book.daily.rows().map((row) => dateCell(row[0])), ['Date', '2026-09-03', '2026-09-04', 'Pay month total']);
assert.equal(book.daily.rows()[1][3], 30, 'Break stores numeric minutes');
assert.equal(durationCell(book.daily.rows()[1][5]), 570);
assert.equal(durationCell(book.weekly.rows().at(-1)[2]), 1170);
assert.match(book.daily.formulas()['F2:F3'][0][0], /MOD\(C2-B2,1\)-D2\/1440/, 'Excel recalculates a row when clocks or break change');
assert.match(book.weekly.formulas()['C2:C5'][0][0], /SUMIFS/, 'weekly totals derive from dated daily rows');
assert.equal(context.runScript(book, JSON.stringify(original)).unchanged, 2, 'exact replay is idempotent');

assert.throws(() => context.runScript(book, JSON.stringify([{ ...original[0], finishTime: '17:00' }])), /Conflicting submitted version/, 'a competing original does not silently rewrite payroll');
assert.equal(durationCell(book.daily.rows()[1][5]), 570, 'failed replay leaves workbook values intact');

const replacement = {
  mode: 'replace-pay-month', employeeName: 'Matthew', employeeEmail: 'matthew@gmt-services.co.uk', payMonth: '2026-09',
  deletedDays: ['2026-09-04'],
  rows: [
    { date: '2026-09-03', startTime: '08:00', finishTime: '18:00', breakMinutes: 60, absenceReason: 'NA', totalMinutes: 540, changeNote: 'Edited by Accounts at 2026-09-27T19:00:00Z' },
    { date: '2026-09-07', startTime: '', finishTime: '', breakMinutes: 0, absenceReason: 'Holiday', totalMinutes: 0 }
  ]
};
const replaced = context.runScript(book, JSON.stringify(replacement));
assert.equal(replaced.created, 1);
assert.equal(replaced.updated, 1);
assert.equal(replaced.removed, 1);
assert.equal(replaced.monthTotalMinutes, 540);
assert.deepEqual(book.daily.rows().map((row) => dateCell(row[0])), ['Date', '2026-09-03', '2026-09-07', 'Pay month total']);
assert.match(book.daily.rows()[1][6], /Edited by Accounts/);
assert.equal(durationCell(book.daily.rows()[2][5]), 0);
assert.equal(durationCell(book.weekly.rows().at(-1)[2]), 540);

assert.throws(() => context.runScript(book, JSON.stringify({ ...replacement, rows: [{ ...replacement.rows[0], date: '2026-09-21' }] })), /outside pay month/);
assert.equal(durationCell(book.daily.rows()[1][5]), 540, 'invalid replacement does not clear an existing workbook');

const serial = Date.parse('2026-08-24T00:00:00Z') / 86400000 + 25569;
const candidate = workbook({ lowercase: true, dailyRows: [
  ['Date', 'Start', 'Finish', 'Break', 'Absence', 'Total hours', 'Notes'],
  [serial, 8 / 24, 17 / 24, 60, '', 8 / 24, 'Original dated row'],
  [Date.parse('2026-08-28T00:00:00Z') / 86400000 + 25569, '', '', 0, 'Holiday', '', 'Original dated absence']
] });
const candidateResult = context.runScript(candidate, JSON.stringify([{
  recordId: 'source-2|2026-08-25', employeeName: 'Matthew', date: '2026-08-25', startTime: '08:00', finishTime: '17:00', note: 'Break: 60 minute break'
}]));
assert.equal(candidateResult.created, 1, 'typed Excel dates, clock serials and duration serials from the review-candidate format are accepted');
assert.equal(candidateResult.monthTotalMinutes, 960);
assert.deepEqual(candidate.daily.rows().map((row) => dateCell(row[0])), ['Date', '2026-08-24', '2026-08-25', '2026-08-28', 'Pay month total']);
assert.equal(durationCell(candidate.daily.rows()[3][5]), 0, 'a clockless Holiday with a blank cached total is retained as a zero-hour day');
console.log('PASS: two-tab Office Script replays dated originals, rejects conflicts, and replaces a full corrected pay month.');
