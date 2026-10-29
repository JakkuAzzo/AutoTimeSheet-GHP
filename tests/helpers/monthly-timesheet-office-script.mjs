import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../../power-platform/office-scripts/upsert-monthly-timesheet-row.ts', import.meta.url), 'utf8');
const officeScript = vm.createContext({});
vm.runInContext(stripTypeScriptTypes(source), officeScript);

export function createTimesheetWorkbook(employee, payMonth) {
  const sheets = {};
  function addWorksheet(name) {
    const rows = [];
    const columnIndex = letters => [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    const sheet = {
      rows,
      getRange(address) {
        const [, firstColumn, start, lastColumn, end] = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
        const first = columnIndex(firstColumn);
        const width = columnIndex(lastColumn) - first + 1;
        return {
          setNumberFormat() {},
          getFormat: () => ({
            getFill: () => ({ setColor() {} }),
            getFont: () => ({ setBold() {} }),
            setColumnWidth() {},
            setWrapText() {},
            autofitRows() {}
          }),
          setValues(values) {
            values.forEach((row, rowIndex) => {
              const target = rows[Number(start) - 1 + rowIndex] ||= [];
              row.forEach((value, columnOffset) => { target[first + columnOffset] = value; });
            });
          },
          getValues() {
            return Array.from({ length: Number(end) - Number(start) + 1 }, (_, rowIndex) =>
              Array.from({ length: width }, (_, columnOffset) => rows[Number(start) - 1 + rowIndex]?.[first + columnOffset] ?? '')
            );
          }
        };
      },
      getUsedRange(valuesOnly) {
        if (valuesOnly !== true) throw new Error('Expected values-only used range.');
        return { getRowIndex: () => 0, getRowCount: () => rows.length };
      }
    };
    sheets[name] = sheet;
    return sheet;
  }
  const main = addWorksheet('Timesheet Events');
  return {
    rows: main.rows,
    sheets,
    getName: () => `GMT Timesheet - ${employee} - ${payMonth}.xlsx`,
    getWorksheet: name => sheets[name],
    addWorksheet
  };
}

export function parseCsvThroughOfficeScript(workbook, fileName, csv) {
  return JSON.parse(JSON.stringify(officeScript.main(workbook, `${fileName}\n${csv}`)));
}

export function runRecordThroughOfficeScript(workbook, payload) {
  const source = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return JSON.parse(JSON.stringify(officeScript.main(workbook, source)));
}
