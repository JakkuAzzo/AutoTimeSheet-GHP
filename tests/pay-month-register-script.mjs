import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const code = stripTypeScriptTypes(readFileSync(new URL('../power-platform/office-scripts/upsert-pay-month-register.ts', import.meta.url), 'utf8'));
const context = { ExcelScript: { ClearApplyTo: { contents: 'contents' }, CalculationType: {full:'full'} } };
vm.runInNewContext(code + '\nthis.runScript = main;', context);

function sheet(name, initial = [], options = {}) {
  let cells = initial.map((row) => row.slice());
  const formulas = {};
  const frozenRows = [];
  const noopFormat = { getFont: () => ({ setBold() {} }), setColumnWidth() {} };
  return {
    name,
    getName: () => name,
    rows: () => cells.map((row) => row.slice()),
    formulas: () => ({ ...formulas }),
    frozenRows: () => frozenRows.slice(),
    getUsedRange(valuesOnly) { return cells.length ? { getRowIndex: () => 0, getRowCount: () => cells.length, getColumnIndex:()=>0, getColumnCount:()=>Math.max(...cells.map(row=>row.length),!valuesOnly&&options.extraFormula&&name.toLowerCase()==='daily entries'?8:0), clear: () => { cells = []; } } : null; },
    getRange(ref) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!match) {
        const single = /^([A-Z]+)(\d+)$/.exec(ref);
        return { getFormat: () => noopFormat, getValues:()=>[[cells[Number(single[2])-1]?.[single[1].charCodeAt(0)-65]??'']], setFormula: (formula) => { formulas[ref] = formula; }, setNumberFormat() {} };
      }
      const startRow = Number(match[2]) - 1, endRow = Number(match[4]) - 1;
      const startCol = match[1].charCodeAt(0) - 65, endCol = match[3].charCodeAt(0) - 65;
      return {
        getValues: () => Array.from({ length: endRow - startRow + 1 }, (_, offset) => Array.from({ length: endCol - startCol + 1 }, (_, column) => cells[startRow + offset]?.[startCol + column] ?? '')),
        getFormulas: () => Array.from({ length: endRow - startRow + 1 }, (_, offset) => Array.from({ length: endCol - startCol + 1 }, (_, column) =>
          (((options.formulaNote && startCol + column === 6) || (options.formulaRate && startCol + column === 7)) && startRow + offset === 1) ||
          (options.formulaAt?.sheet?.toLowerCase() === name.toLowerCase() && options.formulaAt.row === startRow + offset && options.formulaAt.col === startCol + column) ||
          (options.formulaWeeklyTotal && name.toLowerCase() === 'weekly totals' && startCol + column === 1 && startRow + offset === 5)
            ? '=1+1' : (cells[startRow + offset]?.[startCol + column] ?? ''))),
        getFormat: () => noopFormat,
        setFormulas: (values) => { formulas[ref] = values; },
        setNumberFormat() {}
      };
    },
    getRangeByIndexes(startRow, startCol, rowCount, columnCount) {
      return { getFormulas(){return Array.from({length:rowCount},(_,r)=>Array.from({length:columnCount},(_,c)=>options.extraFormula&&name.toLowerCase()==='daily entries'&&startRow+r===1&&startCol+c===7?'=""':(cells[startRow+r]?.[startCol+c]??'')));}, clear() { for (let r=0;r<rowCount;r++) for (let c=0;c<columnCount;c++) if (cells[startRow+r]) cells[startRow+r][startCol+c]=''; }, setValues(values) {
        assert.equal(values.length, rowCount);
        values.forEach((row, offset) => {
          assert.equal(row.length, columnCount);
          while (cells.length <= startRow + offset) cells.push([]);
          row.forEach((value, column) => { cells[startRow + offset][startCol + column] = value; });
        });
        if (options.tamperWrittenNote && name.toLowerCase() === 'daily entries' && cells[1]) cells[1][6] = 'unexpected workbook value';
        if (options.tamperWrittenRate && name.toLowerCase() === 'daily entries' && cells[1]) cells[1][7] = 5 / 1440;
        if (options.tamperWeeklyTotal && name.toLowerCase() === 'weekly totals' && cells[1]) cells[1][2] = 99 / 1440;
      } };
    },
    getFreezePanes: () => ({ freezeRows(count) { frozenRows.push(count); } })
  };
}
function workbook(options = {}) {
  const daily = sheet(options.lowercase ? 'Daily entries' : 'Daily Entries', options.dailyRows || [['Date', 'Start', 'Finish', 'Break', 'Absence', 'Total hours', 'Notes']],options);
  const weekly = sheet(options.lowercase ? 'Weekly totals' : 'Weekly Totals', options.weeklyRows || [['Week Start', 'Week End', 'Total hours']],options);
  const sheets = [daily, weekly];
  const calculations=[];
  return { daily, weekly, calculations, getApplication:()=>({calculate:type=>calculations.push(type)}), getName: () => options.name || 'GMT Timesheet - Matthew - Pay Month 2026-09.xlsx', getWorksheets: () => sheets, getWorksheet: (name) => sheets.find((item) => item.name === name) };
}

const book = workbook();
const dateCell = (value) => typeof value === 'number' ? new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10) : value;
const durationCell = (value) => Math.round(value * 1440);
const original = [
  { recordId: 'source-1|2026-09-03', employeeName: 'Matthew', date: '2026-09-03', startTime: '08:00', finishTime: '18:00', note: 'Break: 30 minute break' },
  { recordId: 'source-1|2026-09-04', employeeName: 'Matthew', date: '2026-09-04', startTime: '07:00', finishTime: '17:00', note: 'Break: No break' }
];
const protectedExtra=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes','Keep this'],['','','','','','','','private note']]});
assert.throws(()=>context.runScript(protectedExtra,JSON.stringify([original[0]])),/outside.*register/i,'hold a workbook with additional content');
assert.equal(protectedExtra.daily.rows()[0][7],'Keep this','content outside the register columns must survive');
assert.equal(protectedExtra.daily.rows()[1][7],'private note');
const protectedWeekly=workbook({weeklyRows:[['Week Start','Week End','Total hours','Keep this']]});
assert.throws(()=>context.runScript(protectedWeekly,JSON.stringify([original[0]])),/outside.*register/i);
assert.deepEqual(protectedWeekly.daily.rows(),[['Date','Start','Finish','Break','Absence','Total hours','Notes']],'both sheets are checked before either is changed');
assert.equal(protectedWeekly.weekly.rows()[0][3],'Keep this');
const hiddenFormula=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['','','','','','','']],extraFormula:true});
assert.throws(()=>context.runScript(hiddenFormula,JSON.stringify([original[0]])),/formula|outside.*register/i,'an empty-result formula outside the register must be preserved');
const weeklyExtra=workbook({weeklyRows:[['Week Start','Week End','Total hours'],[],[],[],[],[],['Do not erase']]});
assert.throws(()=>context.runScript(weeklyExtra,JSON.stringify([original[0]])),/weekly.*review|weekly.*layout/i,'additional weekly content is held before either sheet is written');
assert.equal(weeklyExtra.weekly.rows()[6][0],'Do not erase');
const weeklyChanged=workbook({weeklyRows:[['Week Start','Week End','Total hours'],['2026-08-24','2026-08-30',0],['2026-08-31','2026-09-06',0],['2026-09-07','2026-09-13',0],['2026-09-14','2026-09-20',0],['Month total','',99/1440]]});
assert.throws(()=>context.runScript(weeklyChanged,JSON.stringify([original[0]])),/weekly.*review/i,'unexpected weekly totals are not silently overwritten');
assert.equal(weeklyChanged.weekly.rows().at(-1)[2],99/1440);
const weeklyTotalNote=workbook({weeklyRows:[['Week Start','Week End','Total hours'],['2026-08-24','2026-08-30',0],['2026-08-31','2026-09-06',0],['2026-09-07','2026-09-13',0],['2026-09-14','2026-09-20',0],['Month total','Keep this note',0]]});
assert.throws(()=>context.runScript(weeklyTotalNote,JSON.stringify([original[0]])),/weekly.*review/i,'extra content on the weekly total row must be preserved');
assert.equal(weeklyTotalNote.weekly.rows().at(-1)[1],'Keep this note');
const weeklyTotalFormula=workbook({formulaWeeklyTotal:true,weeklyRows:[['Week Start','Week End','Total hours'],['2026-08-24','2026-08-30',0],['2026-08-31','2026-09-06',0],['2026-09-07','2026-09-13',0],['2026-09-14','2026-09-20',0],['Month total','',0]]});
assert.throws(()=>context.runScript(weeklyTotalFormula,JSON.stringify([original[0]])),/weekly.*review/i,'an empty-result formula on the weekly total row must be preserved');
const undatedNote=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['','','','','','','Keep this note']]});
assert.throws(()=>context.runScript(undatedNote,JSON.stringify([original[0]])),/daily.*review/i,'an undated note must be held before either sheet is changed');
assert.equal(undatedNote.daily.rows()[1][6],'Keep this note');
const undatedFormula=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['','','','','','','']],formulaNote:true});
assert.throws(()=>context.runScript(undatedFormula,JSON.stringify([original[0]])),/daily.*review/i,'an empty-result formula in an undated row must be held');
const totalWithNote=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['Pay month total','','','','',0,'Keep this note']]});
assert.throws(()=>context.runScript(totalWithNote,JSON.stringify([original[0]])),/daily.*review/i,'the total row cannot conceal extra content');
assert.equal(totalWithNote.daily.rows()[1][6],'Keep this note');
const duplicateTotals=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['Pay month total','','','','',0,''],['Pay month total','','','','',0,'']]});
assert.throws(()=>context.runScript(duplicateTotals,JSON.stringify([original[0]])),/daily.*review/i,'duplicate total rows must be reviewed');
const calculatedStart=workbook({formulaAt:{sheet:'Daily Entries',row:1,col:1},dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-09-03','08:00','18:00',30,'NA',570/1440,'']]});
assert.throws(()=>context.runScript(calculatedStart,JSON.stringify([original[0]])),/formula.*review/i,'a calculated start time must not be replaced with its displayed value');
assert.equal(calculatedStart.daily.rows()[1][1],'08:00');
for (const col of [0,2,3,4,6]) {
  const calculatedInput=workbook({formulaAt:{sheet:'Daily Entries',row:1,col},dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-09-03','08:00','18:00',30,'NA',570/1440,'']]});
  assert.throws(()=>context.runScript(calculatedInput,JSON.stringify([original[0]])),/formula.*review/i,'a calculated daily input must be preserved');
}
const calculatedDailyHeader=workbook({formulaAt:{sheet:'Daily Entries',row:0,col:0}});
assert.throws(()=>context.runScript(calculatedDailyHeader,JSON.stringify([original[0]])),/formula.*review/i,'a calculated heading must be preserved');
const calculatedWeeklyDate=workbook({formulaAt:{sheet:'Weekly Totals',row:1,col:0},weeklyRows:[['Week Start','Week End','Total hours'],['2026-08-24','2026-08-30',0],['2026-08-31','2026-09-06',0],['2026-09-07','2026-09-13',0],['2026-09-14','2026-09-20',0],['Month total','',0]]});
assert.throws(()=>context.runScript(calculatedWeeklyDate,JSON.stringify([original[0]])),/formula.*review/i,'a calculated weekly date must be preserved');
assert.equal(calculatedWeeklyDate.weekly.rows()[1][0],'2026-08-24');
const customDailyTotal=workbook({formulaAt:{sheet:'Daily Entries',row:1,col:5},dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],['2026-09-03','08:00','18:00',30,'NA',570/1440,'']]});
assert.throws(()=>context.runScript(customDailyTotal,JSON.stringify([original[0]])),/formula.*review/i,'a custom daily total formula must not be overwritten');
assert.equal(customDailyTotal.daily.rows()[1][5],570/1440);
const customWeeklyTotal=workbook({formulaAt:{sheet:'Weekly Totals',row:1,col:2},weeklyRows:[['Week Start','Week End','Total hours'],['2026-08-24','2026-08-30',0],['2026-08-31','2026-09-06',0],['2026-09-07','2026-09-13',0],['2026-09-14','2026-09-20',0],['Month total','',0]]});
assert.throws(()=>context.runScript(customWeeklyTotal,JSON.stringify([original[0]])),/formula.*review/i,'a custom weekly total formula must not be overwritten');
assert.equal(customWeeklyTotal.weekly.rows()[1][2],0);
const extendedHeaders=['Date','Start','Finish','Break','Absence','Total hours','Notes','Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'];
const rateSnapshot={schemaVersion:3,mode:'replace-pay-month',employeeName:'Matthew',payMonth:'2026-09',recordId:'test-rates',rows:[{recordId:'test-rates|2026-09-03',date:'2026-09-03',startTime:'08:00',finishTime:'18:00',breakMinutes:30,absenceReason:'NA',totalMinutes:570,sourceBasicMinutes:480,sourceOt15Minutes:90,sourceOt20Minutes:0}]};
const ratesBook=workbook({dailyRows:[extendedHeaders]});
const rateResult=context.runScript(ratesBook,JSON.stringify(rateSnapshot));
assert.deepEqual(ratesBook.daily.rows()[0],extendedHeaders);
assert.deepEqual(ratesBook.daily.rows()[1].slice(7).map(durationCell),[480,90,0]);
const verifiedRate=JSON.parse(rateResult.verifiedRowsJson)[0];
assert.equal(verifiedRate.sourceBasicMinutes,480);
assert.equal(verifiedRate.sourceOt15Minutes,90);
assert.equal(verifiedRate.sourceOt20Minutes,0);
const nullRates=workbook({dailyRows:[extendedHeaders]});
const nullResult=context.runScript(nullRates,JSON.stringify({...rateSnapshot,rows:[{...rateSnapshot.rows[0],sourceBasicMinutes:null,sourceOt15Minutes:0,sourceOt20Minutes:null}]}));
assert.deepEqual(nullRates.daily.rows()[1].slice(7),['',0,'']);
assert.equal(JSON.parse(nullResult.verifiedRowsJson)[0].sourceBasicMinutes,null);
assert.throws(()=>context.runScript(workbook({dailyRows:[extendedHeaders]}),JSON.stringify({...rateSnapshot,rows:[{...rateSnapshot.rows[0],sourceBasicMinutes:undefined}]})),/source rate/i);
assert.throws(()=>context.runScript(workbook({dailyRows:[extendedHeaders],tamperWrittenRate:true}),JSON.stringify(rateSnapshot)),/read-back/i,'a changed rate cannot produce a verified receipt');
const formulaRates=workbook({dailyRows:[extendedHeaders,['2026-09-03','08:00','18:00',30,'NA',570/1440,'',480/1440,90/1440,0]],formulaRate:true});
assert.throws(()=>context.runScript(formulaRates,JSON.stringify(rateSnapshot)),/formula/i,'source rate formulas require review before rewriting');
const oldLayout=workbook();
assert.throws(()=>context.runScript(oldLayout,JSON.stringify(rateSnapshot)),/headings|layout/i,'the old layout requires an explicit migration');
assert.deepEqual(oldLayout.daily.rows(),[['Date','Start','Finish','Break','Absence','Total hours','Notes']]);
assert.throws(()=>context.runScript(workbook(),JSON.stringify({...rateSnapshot,schemaVersion:4})),/schema/i,'an unknown format cannot fall back to the old writer');
// Power Automate's Office Scripts runtime failed on a worksheet-array find
// callback that calls getName. Simulate that failure on the provider array;
// row arrays still have their normal JavaScript methods.
const providerBook = workbook({lowercase: true});
const providerSheets = providerBook.getWorksheets();
providerSheets.find = () => { throw new TypeError('sheets.findAsync is not a function'); };
assert.equal(context.runScript(providerBook, JSON.stringify(original)).created, 2,
  'worksheet discovery must work without find on an Excel worksheet array');
const first = context.runScript(book, JSON.stringify(original));
assert.equal(first.created, 2);
assert.equal(first.monthTotalMinutes, 1170);
assert.deepEqual(book.daily.frozenRows(), [1], 'the daily header is frozen through the Excel worksheet API');
assert.deepEqual(book.weekly.frozenRows(), [1], 'the weekly header is frozen through the Excel worksheet API');
assert.deepEqual(book.daily.rows().map((row) => dateCell(row[0])), ['Date', '2026-09-03', '2026-09-04', 'Pay month total']);
assert.equal(book.daily.rows()[1][3], 30, 'Break stores numeric minutes');
assert.equal(durationCell(book.daily.rows()[1][5]), 570);
assert.equal(durationCell(book.weekly.rows().at(-1)[2]), 1170);
assert.match(book.daily.formulas()['F2:F3'][0][0], /MOD\(C2-B2,1\)-D2\/1440/, 'Excel recalculates a row when clocks or break change');
assert.match(book.weekly.formulas()['C2:C5'][0][0], /SUMIFS/, 'weekly totals derive from dated daily rows');
assert.equal(context.runScript(book, JSON.stringify(original)).unchanged, 2, 'exact replay is idempotent');

const auditedBook = workbook();
context.runScript(auditedBook, JSON.stringify([original[0]]));
context.runScript(auditedBook, JSON.stringify({
  mode: 'replace-pay-month', employeeName: 'Matthew', payMonth: '2026-09',
  rows: [{ date: '2026-09-03', startTime: '08:00', finishTime: '18:00', breakMinutes: 30,
    absenceReason: 'NA', changeNote: 'Edited on behalf of Matthew by Accounts at 2026-09-27T19:00:00Z' }]
}));
assert.match(auditedBook.daily.rows()[1][6], /Edited on behalf of Matthew/, 'the saved correction has an audit note');
assert.equal(context.runScript(auditedBook, JSON.stringify([original[0]])).unchanged, 1, 'the original replay is an unchanged dated row');
assert.match(auditedBook.daily.rows()[1][6], /Edited on behalf of Matthew/, 'an unchanged source replay must not erase a later correction note');

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

const verifiedBook = workbook();
const verifiedSnapshot = {...replacement, recordId:'correction-123', rows:replacement.rows.map(row=>({...row,recordId:`correction-123|${row.date}`}))};
const pluralNoteBook = workbook();
const pluralNoteSnapshot = {...verifiedSnapshot, rows: verifiedSnapshot.rows.map((row, index) => index === 0 ? {...row, notes: 'Fictional source location'} : row)};
context.runScript(pluralNoteBook, JSON.stringify(pluralNoteSnapshot));
assert.match(pluralNoteBook.daily.rows()[1][6], /Fictional source location/,
  'snapshot read-back must include a source note supplied as notes');
const conflictingNotes = {...verifiedSnapshot, rows: verifiedSnapshot.rows.map((row, index) => index === 0 ? {...row, note:'First source', notes:'Different source'} : row)};
assert.throws(() => context.runScript(workbook(), JSON.stringify(conflictingNotes)), /Conflicting source notes/,
  'different nonempty note aliases require review rather than silently losing one');
const unsafePluralNote = {...verifiedSnapshot, rows: verifiedSnapshot.rows.map((row, index) => index === 0 ? {...row, notes:' =1+1'} : row)};
assert.throws(() => context.runScript(workbook(), JSON.stringify(unsafePluralNote)), /Formula-like cell text/,
  'the plural notes alias receives the same formula guard');
const verified = context.runScript(verifiedBook,JSON.stringify(verifiedSnapshot));
assert.deepEqual(verifiedBook.calculations,['full'],'recalculate formulas before verifying their saved values');
assert.ok(Array.isArray(JSON.parse(verified.verifiedRowsJson)),'the script returns verified workbook rows');
assert.deepEqual(JSON.parse(JSON.stringify(JSON.parse(verified.verifiedRowsJson))), [
  {recordId:'correction-123|2026-09-03',date:'2026-09-03',start:'08:00',finish:'18:00',breakMinutes:60,absence:'NA',totalMinutes:540,notes:'Edited by Accounts at 2026-09-27T19:00:00Z'},
  {recordId:'correction-123|2026-09-07',date:'2026-09-07',start:'',finish:'',breakMinutes:0,absence:'Holiday',totalMinutes:0,notes:''}
], 'delivery evidence includes the actual saved times, break, absence, hours and notes');
assert.deepEqual(JSON.parse(JSON.stringify(JSON.parse(verified.verifiedRowsJson))).map(({recordId,date,notes})=>({recordId,date,notes})),verifiedSnapshot.rows.map(row=>({recordId:row.recordId,date:row.date,notes:row.changeNote||''})),
  'a replacement confirms every source row only after reading the written workbook');
assert.deepEqual(JSON.parse(JSON.stringify(verified.unverifiedRecordIds)),[]);
const changedNoteSnapshot={...verifiedSnapshot,rows:verifiedSnapshot.rows.map((row,index)=>index===0?{...row,changeNote:'Accounts corrected the location note'}:row)};
const changedNote=context.runScript(verifiedBook,JSON.stringify(changedNoteSnapshot));
assert.equal(changedNote.updated,1,'a snapshot that changes only notes reports the changed row as updated');
assert.equal(changedNote.unchanged,1);
assert.match(verifiedBook.daily.rows()[1][6],/Accounts corrected the location note/);
const sameNote=context.runScript(verifiedBook,JSON.stringify(changedNoteSnapshot));
assert.equal(sameNote.unchanged,2,'replaying the identical corrected notes remains idempotent');
const badReadback = workbook({tamperWrittenNote:true});
assert.throws(()=>context.runScript(badReadback,JSON.stringify(verifiedSnapshot)),/read-back/i,
  'a changed workbook cell prevents a successful verification result');
const badWeekly=workbook({tamperWeeklyTotal:true});
assert.throws(()=>context.runScript(badWeekly,JSON.stringify(verifiedSnapshot)),/total.*read-back/i,
  'a changed weekly total prevents a successful verification result');
const badSource=workbook();
const beforeBadSource=badSource.daily.rows();
assert.throws(()=>context.runScript(badSource,JSON.stringify({...verifiedSnapshot,rows:verifiedSnapshot.rows.map(row=>({...row,recordId:'wrong-source'}))})),/source row identity/i);
assert.deepEqual(badSource.daily.rows(),beforeBadSource,'a mismatched source identity is rejected before the workbook is written');
for(const unsafeText of ['=1+1','+1','-1','@SUM(A1)']) {
  const unsafeBook=workbook();
  const beforeUnsafe=unsafeBook.daily.rows();
  const unsafeSnapshot={...verifiedSnapshot,rows:verifiedSnapshot.rows.map((row,index)=>index===0?{...row,note:unsafeText}:row)};
  assert.throws(()=>context.runScript(unsafeBook,JSON.stringify(unsafeSnapshot)),/formula.*review/i,
    'formula-like source notes must be held before writing Excel cells');
  assert.deepEqual(unsafeBook.daily.rows(),beforeUnsafe,'a rejected note does not clear the destination');
}
const unsafeExisting=workbook({dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],
  [Date.parse('2026-09-03T00:00:00Z')/86400000+25569,8/24,18/24,30,'NA',570/1440,'=1+1']]});
const beforeUnsafeExisting=unsafeExisting.daily.rows();
assert.throws(()=>context.runScript(unsafeExisting,JSON.stringify(verifiedSnapshot)),/formula.*review/i,
  'an existing formula-like note must be held before it is rewritten');
assert.deepEqual(unsafeExisting.daily.rows(),beforeUnsafeExisting);
const hiddenFormulaBook=workbook({formulaNote:true,dailyRows:[['Date','Start','Finish','Break','Absence','Total hours','Notes'],
  [Date.parse('2026-09-03T00:00:00Z')/86400000+25569,8/24,18/24,30,'NA',570/1440,2]]});
const beforeHiddenFormula=hiddenFormulaBook.daily.rows();
assert.throws(()=>context.runScript(hiddenFormulaBook,JSON.stringify(verifiedSnapshot)),/formula.*review/i,
  'a pre-existing formula is held even if its evaluated note appears harmless');
assert.deepEqual(hiddenFormulaBook.daily.rows(),beforeHiddenFormula);
const portalHoliday=workbook();
const holidaySnapshot={mode:'replace-pay-month',recordId:'holiday-correction',employeeName:'Matthew',payMonth:'2026-09',rows:[{
  recordId:'holiday-correction|2026-09-07',date:'2026-09-07',startTime:'',finishTime:'',breakMinutes:'',absenceReason:'Holiday',totalMinutes:480,note:''
}]};
const holidayWritten=context.runScript(portalHoliday,JSON.stringify(holidaySnapshot));
assert.equal(holidayWritten.monthTotalMinutes,480,'paid holiday matches the portal workbook calculation');
assert.equal(durationCell(portalHoliday.daily.rows()[1][5]),480);
const unknownBreakBook=workbook();
const unknownBreakSnapshot={...holidaySnapshot,recordId:'unknown-break-correction',rows:[{
  recordId:'unknown-break-correction|2026-09-07',date:'2026-09-07',startTime:'08:00',finishTime:'17:00',breakMinutes:'',absenceReason:'NA',totalMinutes:540,note:'Break not recorded; total before any break deduction'
}]};
const unknownBreak=context.runScript(unknownBreakBook,JSON.stringify(unknownBreakSnapshot));
assert.equal(unknownBreak.monthTotalMinutes,540,'a provisional portal total remains visible when the break is unknown');
assert.equal(unknownBreakBook.daily.rows()[1][3],'','an unknown break is not recorded as zero');
assert.equal(durationCell(unknownBreakBook.daily.rows()[1][5]),540);
const fiveWeekBook=workbook({name:'GMT Timesheet - Matthew - Pay Month 2026-10.xlsx'});
const fiveWeekSnapshot={mode:'replace-pay-month',recordId:'five-week-correction',employeeName:'Matthew',payMonth:'2026-10',cycleStart:'2026-09-21',cycleEnd:'2026-10-25',rows:[{
  recordId:'five-week-correction|2026-10-24',date:'2026-10-24',startTime:'10:30',finishTime:'12:30',breakMinutes:0,absenceReason:'NA',totalMinutes:120
}]};
const fiveWeek=context.runScript(fiveWeekBook,JSON.stringify(fiveWeekSnapshot));
assert.equal(fiveWeek.monthTotalMinutes,120);
assert.deepEqual(fiveWeekBook.weekly.rows().map(row=>dateCell(row[0])),['Week Start','2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19','Month total'],
  'configured five-week pay periods retain the last week');
assert.equal(durationCell(fiveWeekBook.weekly.rows()[5][2]),120);
assert.deepEqual(JSON.parse(JSON.stringify(JSON.parse(fiveWeek.verifiedRowsJson))).map(({recordId,date,notes})=>({recordId,date,notes})),[{recordId:'five-week-correction|2026-10-24',date:'2026-10-24',notes:''}]);
const invalidBoundsBook=workbook({name:'GMT Timesheet - Matthew - Pay Month 2026-10.xlsx'});
const beforeInvalidBounds=invalidBoundsBook.daily.rows();
assert.throws(()=>context.runScript(invalidBoundsBook,JSON.stringify({...fiveWeekSnapshot,cycleEnd:'2026-09-20'})),/period|cycle/i);
assert.deepEqual(invalidBoundsBook.daily.rows(),beforeInvalidBounds,'invalid cycle bounds do not change the workbook');

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
const companyNamed = workbook({ name: 'Matthew - Pay Month 2026-09.xlsx' });
assert.equal(context.runScript(companyNamed, JSON.stringify(original)).created, 2, 'the company SharePoint filename is accepted');
const weekendBook = workbook({ name: 'GMT Timesheet - Jason - Pay Month 2026-09.xlsx' });
const weekendResult = context.runScript(weekendBook, JSON.stringify([{
  recordId: 'source-jason|2026-08-29', employeeName: 'Jason', date: '2026-08-29',
  startTime: '10:30', finishTime: '14:30', breakMinutes: 0
}]));
assert.equal(weekendResult.monthTotalMinutes, 240, 'the dated Saturday contributes four hours to the month');
assert.equal(dateCell(weekendBook.weekly.rows()[1][1]), '2026-08-30', 'the first weekly interval includes its weekend');
assert.equal(durationCell(weekendBook.weekly.rows()[1][2]), 240, 'Saturday hours appear in the same weekly total');
assert.equal(dateCell(weekendBook.weekly.rows()[4][1]), '2026-09-20', 'the final weekly interval includes the trailing weekend in this pay cycle');
const finalWeekendBook = workbook();
const finalWeekendResult = context.runScript(finalWeekendBook, JSON.stringify([{
  recordId: 'source-matthew|2026-09-19', employeeName: 'Matthew', date: '2026-09-19',
  startTime: '08:00', finishTime: '17:00', breakMinutes: 0, absenceReason: 'NA'
}]));
assert.equal(finalWeekendResult.monthTotalMinutes, 540, 'the weekend after payroll Friday stays in the September cycle');
assert.equal(durationCell(finalWeekendBook.weekly.rows()[4][2]), 540, 'the fourth weekly total includes its Saturday');
assert.equal(dateCell(finalWeekendBook.weekly.rows()[4][1]), '2026-09-20', 'the weekly interval ends on Sunday');
const absentWithTemplateClocks = workbook();
const absentResult = context.runScript(absentWithTemplateClocks, JSON.stringify([{
  recordId: 'source-matthew|2026-08-24', employeeName: 'Matthew', date: '2026-08-24',
  startTime: '08:00', finishTime: '17:00', breakMinutes: 60, absenceReason: 'Holiday'
}]));
assert.equal(absentResult.monthTotalMinutes, 0, 'an absence-marked day cannot contribute template clock hours to the month');
assert.equal(durationCell(absentWithTemplateClocks.daily.rows()[1][5]), 0, 'the stored total agrees with the absence formula');
assert.equal(durationCell(absentWithTemplateClocks.weekly.rows().at(-1)[2]), 0, 'weekly and month totals agree for an absence-marked day');
const longBreakBook = workbook({ name: 'GMT Timesheet - Jason - Pay Month 2026-09.xlsx' });
const longBreakResult = context.runScript(longBreakBook, JSON.stringify([{
  recordId: 'source-jason|2026-09-01', employeeName: 'Jason', date: '2026-09-01',
  startTime: '00:00', finishTime: '23:00', breakMinutes: 780
}]));
assert.equal(longBreakBook.daily.rows()[1][3], 780, 'the workbook accepts the same minute range as the portal editor');
assert.equal(longBreakResult.monthTotalMinutes, 600, 'a valid long break is deducted from elapsed hours');
const duplicatedDate = workbook({ dailyRows: [
  ['Date', 'Start', 'Finish', 'Break', 'Absence', 'Total hours', 'Notes'],
  [serial, 8 / 24, 17 / 24, 60, 'NA', 8 / 24, 'First source'],
  [serial, 8 / 24, 17 / 24, 60, 'NA', 8 / 24, 'Second source']
] });
const duplicatedBefore = duplicatedDate.daily.rows();
assert.throws(
  () => context.runScript(duplicatedDate, JSON.stringify([original[0]])),
  /Duplicate existing Date: 2026-08-24/,
  'a replay must stop before silently collapsing two existing rows for one day'
);
assert.deepEqual(duplicatedDate.daily.rows(), duplicatedBefore, 'a duplicate-date rejection leaves the destination untouched');
console.log('PASS: two-tab Office Script replays dated originals, rejects conflicts, and replaces a full corrected pay month.');
