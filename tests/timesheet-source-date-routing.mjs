import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../power-platform/office-scripts/upsert-monthly-timesheet-row.ts', import.meta.url), 'utf8');
const script = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(source), script);

function workbook(name = 'Simon', payMonthLabel = false) {
  const sheets = {};
  const column = letters => [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  function addWorksheet(sheetName) {
    const rows = [];
    const sheet = {
      rows,
      getUsedRange: () => ({ getRowIndex: () => 0, getRowCount: () => rows.length }),
      getRange(address) {
        const [, first, start, last, end] = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
        const startColumn = column(first);
        const width = column(last) - startColumn + 1;
        return {
          setValues(values) {
            values.forEach((valuesRow, index) => {
              const target = rows[Number(start) - 1 + index] ||= [];
              valuesRow.forEach((value, offset) => { target[startColumn + offset] = value; });
            });
          },
          getValues: () => Array.from({ length: Number(end) - Number(start) + 1 }, (_, index) =>
            Array.from({ length: width }, (_, offset) => rows[Number(start) - 1 + index]?.[startColumn + offset] ?? '')),
          setNumberFormat() {},
          getFormat: () => ({
            getFill: () => ({ setColor() {} }), getFont: () => ({ setBold() {} }),
            setColumnWidth() {}, setWrapText() {}, autofitRows() {}
          })
        };
      }
    };
    sheets[sheetName] = sheet;
    return sheet;
  }
  return {
    sheets, getName: () => `GMT Timesheet - ${name} - ${payMonthLabel ? 'Pay Month ' : ''}2026-09.xlsx`,
    getWorksheet: sheetName => sheets[sheetName], addWorksheet
  };
}

const datedCsv = [
  'GMT Timesheet - Simon - 2026-09-07.csv',
  'Employee email,Week start,Week end,Date,Start,Finish,Worked hours,Basic hours,OT x1.5 hours,OT x2.0 hours',
  'simon@gmt-services.co.uk,2026-09-07,2026-09-11,2026-09-03,08:00,17:00,9,8,1,0'
].join('\n');
const csvBook = workbook();
assert.equal(script.main(csvBook, datedCsv).created, 1);
assert.equal(csvBook.sheets['Timesheet Events'].rows[1][4], '2026-09-03', 'CSV Date must not be moved into its week label');
const undatedCsv = datedCsv.replace(',2026-09-03,08:00', ',,08:00');
assert.throws(() => script.main(workbook(), undatedCsv), /No valid timesheet records/,
  'a missing CSV Date cannot be invented from Week start');
const undatedEnvelope = {
  employeeName: 'Simon', employeeEmail: 'simon@gmt-services.co.uk',
  submissionId: 'missing-date', weekStart: '2026-09-07', weekEnd: '2026-09-11',
  rows: [{ startTime: '08:00', finishTime: '17:00' }]
};
assert.throws(() => script.main(workbook(), JSON.stringify(undatedEnvelope)), /No valid timesheet records/,
  'a missing JSON row Date cannot be invented from Week start');
const summaryOnly = [
  'employee_name: Simon',
  'gmt_employee_upn: simon@gmt-services.co.uk',
  'gmt_record_id: summary-only',
  'gmt_week_start: 2026-09-07',
  'gmt_week_end: 2026-09-11'
].join('\n');
assert.equal(script.parseFormSubmitBody(summaryOnly)[0].date, '',
  'a week-level email without a Date must not claim the week start as its work date');

const monthBook = workbook();
const record = (id, weekStart, date) => ({
  employeeName: 'Simon', employeeEmail: 'simon@gmt-services.co.uk', recordId: id,
  action: 'submission', status: 'Submitted', weekStart, weekEnd: weekStart,
  date, startTime: '08:00', finishTime: '17:00', workedHours: 9, basicHours: 8,
  ot15Hours: 1, ot20Hours: 0
});
assert.equal(script.main(monthBook, JSON.stringify(record('aug-24', '2026-08-24', '2026-08-24'))).created, 1,
  '24 August belongs to pay month 2026-09');
assert.equal(monthBook.sheets['Timesheet Events'].rows[1][4], '2026-08-24');
assert.throws(() => script.main(monthBook, JSON.stringify(record('sep-21', '2026-09-14', '2026-09-21'))), /Record month/,
  '21 September belongs to the next pay month even when the form week says otherwise');
const canonicalBook = workbook('Simon', true);
assert.equal(script.main(canonicalBook, JSON.stringify(record('canonical-aug-24', '2026-08-24', '2026-08-24'))).created, 1,
  'the company canonical Pay Month filename must be accepted');

console.log('PASS: source Date is preserved and drives four-week pay-month routing.');
