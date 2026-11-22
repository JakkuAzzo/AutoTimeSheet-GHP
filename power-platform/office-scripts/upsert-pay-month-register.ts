/*
 * GMT employee pay-month register. Run only against a certified workbook with
 * exactly the Daily Entries and Weekly Totals sheets. Original dated records
 * add new days; a portal replace-pay-month snapshot replaces the full month.
 * Conflicting originals stop for review instead of silently changing payroll.
 */

type InputRow = Record<string, unknown>;
type Envelope = {
  schemaVersion?: number;
  mode?: string;
  recordId?: string;
  employeeName?: string;
  employeeEmail?: string;
  payMonth?: string;
  cycleStart?: string;
  cycleEnd?: string;
  submittedAt?: string;
  deletedDays?: string[];
  rows?: InputRow[];
};
type DailyRow = {
  date: string;
  start: string;
  finish: string;
  breakMinutes: number | null;
  absence: string;
  totalMinutes: number | null;
  notes: string;
  sourceBasicMinutes?: number | null;
  sourceOt15Minutes?: number | null;
  sourceOt20Minutes?: number | null;
};
type CycleBounds = { start: string; end: string };
type VerifiedRow = DailyRow & { recordId: string };
// Office Scripts' published return-type restrictions do not include nullable
// numeric object properties. Preserve nulls as JSON text instead of coercing
// an unrecorded break or total to zero in the Power Automate connector.
type Result = { created: number; updated: number; unchanged: number; removed: number; rows: number; monthTotalMinutes: number; verifiedRecordIds: string[]; verifiedRecordIdsJson: string; verifiedRowsJson: string; unverifiedRecordIds: string[] };

const DAILY = "Daily Entries";
const WEEKLY = "Weekly Totals";
const DAILY_HEADERS = ["Date", "Start", "Finish", "Break", "Absence", "Total hours", "Notes"];
const RATE_HEADERS = ["Source basic hours", "Source overtime 1.5× hours", "Source overtime 2× hours"];
const WEEKLY_HEADERS = ["Week Start", "Week End", "Total hours"];
const PAY_MONTH_ANCHOR = Date.UTC(2026, 7, 24);
const DAY_MS = 86400000;

function text(value: unknown): string { return value == null ? "" : String(value).trim(); }
function value(row: InputRow, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return "";
}
function isoDate(input: unknown): string {
  if (typeof input === "number" && Number.isFinite(input)) return new Date(Math.round((input - 25569) * DAY_MS)).toISOString().slice(0, 10);
  const candidate = text(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || new Date(candidate + "T00:00:00Z").toISOString().slice(0, 10) !== candidate) throw new Error("Invalid daily Date: " + candidate);
  return candidate;
}
function payMonthForDate(date: string): string {
  const day = Date.parse(date + "T00:00:00Z");
  const cycle = Math.floor((day - PAY_MONTH_ANCHOR) / (28 * DAY_MS));
  return new Date(PAY_MONTH_ANCHOR + (cycle * 28 + 25) * DAY_MS).toISOString().slice(0, 7);
}
function clockText(input: unknown): string {
  if (typeof input === "number" && Number.isFinite(input)) {
    const minutes = ((Math.round(input * 1440) % 1440) + 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }
  return text(input);
}
function clockMinutes(input: string): number | null {
  if (!input) return null;
  if (!/^\d{1,2}:\d{2}$/.test(input)) throw new Error("Invalid clock time: " + input);
  const parts = input.split(":").map((part) => Number(part));
  if (parts[0] > 23 || parts[1] > 59) throw new Error("Invalid clock time: " + input);
  return parts[0] * 60 + parts[1];
}
function breakMinutes(row: InputRow, note: string): number | null {
  const supplied = value(row, ["breakMinutes", "Break", "lunchMinutes"]);
  if (supplied !== "") {
    const minutes = Number(supplied);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("Invalid break minutes");
    return minutes;
  }
  if (/\bBreak:\s*(?:No break|0\s*(?:minute|min))/i.test(note)) return 0;
  const match = /\bBreak:\s*(\d+)\s*(?:minute|min)/i.exec(note);
  return match ? Number(match[1]) : null;
}
function hoursLabel(minutes: number | null): string { return minutes === null ? "" : Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m"; }
function minutesFromLabel(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.round(input * 1440);
  const label = text(input);
  if (!label) return null;
  const match = /^(\d+)h\s*(\d{1,2})m$/.exec(label);
  if (!match || Number(match[2]) >= 60) throw new Error("Invalid Total hours cell: " + label);
  return Number(match[1]) * 60 + Number(match[2]);
}
function sourceNotes(row: InputRow): string {
  const aliases = ["note", "notes", "Notes", "description"];
  let result = "";
  for (const alias of aliases) {
    const candidate = text(row[alias]);
    if (!candidate) continue;
    if (result && result !== candidate) throw new Error("Conflicting source notes require review");
    result = candidate;
  }
  return result;
}
function normalize(row: InputRow, month: string, sourceInNotes = true, bounds: CycleBounds | null = null, rateMode = false): DailyRow {
  const date = isoDate(value(row, ["date", "Date"]));
  if (bounds ? date < bounds.start || date > bounds.end : payMonthForDate(date) !== month) throw new Error("Date " + date + " is outside pay month " + month);
  const start = clockText(value(row, ["startTime", "start", "Start"]));
  const finish = clockText(value(row, ["finishTime", "finish", "Finish"]));
  const rawNote = sourceNotes(row);
  const pause = breakMinutes(row, rawNote);
  const absence = text(value(row, ["absenceReason", "absenceStatus", "absence", "Absence"])) || "NA";
  const from = clockMinutes(start);
  const to = clockMinutes(finish);
  const suppliedTotal = row.totalMinutes === undefined || row.totalMinutes === null || row.totalMinutes === "" ? null : Number(row.totalMinutes);
  if (suppliedTotal !== null && (!Number.isInteger(suppliedTotal) || suppliedTotal < 0 || suppliedTotal > 1440)) throw new Error("Invalid supplied Total hours on " + date);
  let total: number | null = null;
  if (absence !== "NA") total = suppliedTotal === null ? 0 : suppliedTotal;
  else if (from !== null && to !== null && pause !== null) {
    const elapsed = to >= from ? to - from : to + 1440 - from;
    if (elapsed <= 0 || pause > elapsed) throw new Error("Invalid hours on " + date);
    total = elapsed - pause;
  } else if (suppliedTotal !== null) total = suppliedTotal;
  if (suppliedTotal !== null && total !== null && suppliedTotal !== total) {
    throw new Error("Clock total differs from supplied Total hours on " + date);
  }
  const changeNote = text(row.changeNote);
  const sourceId = text(value(row, ["recordId", "record_id"]));
  const notes = [rawNote, changeNote, sourceInNotes && sourceId && !changeNote ? "Source " + sourceId : ""].filter((part) => Boolean(part)).join(" | ");
  const result: DailyRow = { date, start, finish, breakMinutes: pause, absence, totalMinutes: total, notes };
  if (rateMode) {
    for (const name of ["sourceBasicMinutes", "sourceOt15Minutes", "sourceOt20Minutes"]) {
      const item = row[name];
      if (item !== null && (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 1440)) throw new Error("Invalid or missing source rate " + name);
      if (name === "sourceBasicMinutes") result.sourceBasicMinutes = item as number | null;
      else if (name === "sourceOt15Minutes") result.sourceOt15Minutes = item as number | null;
      else result.sourceOt20Minutes = item as number | null;
    }
  }
  return result;
}
function key(row: DailyRow): string { return JSON.stringify([row.start, row.finish, row.breakMinutes, row.absence, row.totalMinutes, row.sourceBasicMinutes, row.sourceOt15Minutes, row.sourceOt20Minutes]); }
function requireSafeCellText(row: DailyRow): void {
  // Excel setValues treats leading =, + or - as a formula. Hold these and @
  // for review before clearing or writing the destination; do not alter notes.
  if ([row.notes, row.absence].some((value) => /^[=+\-@]/.test(value.replace(/^\s+/, "")))) {
    throw new Error("Formula-like cell text requires review before workbook filing");
  }
}
function monday(date: string): string {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
function excelDate(date: string): number { return Date.parse(date + "T00:00:00Z") / DAY_MS + 25569; }
function excelTime(time: string): number | string { const minutes = clockMinutes(time); return minutes === null ? "" : minutes / 1440; }
function weekEnd(date: string): string {
  return new Date(Date.parse(date + "T00:00:00Z") + 6 * DAY_MS).toISOString().slice(0, 10);
}
function monthWeeks(month: string): string[] {
  const anchor = new Date(PAY_MONTH_ANCHOR);
  for (let shift = -120; shift <= 120; shift++) {
    const start = new Date(anchor.getTime() + shift * 28 * DAY_MS).toISOString().slice(0, 10);
    if (payMonthForDate(start) === month) return [0, 7, 14, 21].map((days) => new Date(Date.parse(start + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10));
  }
  throw new Error("Unsupported pay month: " + month);
}
function excelTruncatedLiteral(value: number): string {
  const input = String(value);
  let significant = 0;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char < "0" || char > "9") continue;
    if (char !== "0") started = true;
    if (started && ++significant > 15) return String(Number(input.slice(0, i)));
  }
  return input;
}
function dailyTotalFormula(row: DailyRow, line: number, excelPrecision = false, excelTruncate = false): string {
  const originalAbsence = row.absence.replace(/"/g, '""');
  const fraction = row.totalMinutes === null ? null : row.totalMinutes / 1440;
  const savedTotal = fraction === null ? '""' : excelTruncate ? excelTruncatedLiteral(fraction) : String(excelPrecision ? Number(fraction.toPrecision(15)) : fraction);
  const absenceTotal = row.absence === "NA" || row.totalMinutes === null || row.totalMinutes === 0 ? '0' : 'IF(E' + line + '="' + originalAbsence + '",' + savedTotal + ',0)';
  const missingTotal = row.absence === "NA" ? savedTotal : '""';
  return '=IF(E' + line + '<>"NA",' + absenceTotal + ',IF(OR(B' + line + '="",C' + line + '="",D' + line + '=""),' + missingTotal + ',MOD(C' + line + '-B' + line + ',1)-D' + line + '/1440))';
}
function currentRows(sheet: ExcelScript.Worksheet, month: string, bounds: CycleBounds | null = null, rateMode = false): DailyRow[] {
  const used = sheet.getUsedRange(true);
  const count = used ? used.getRowIndex() + used.getRowCount() : 0;
  if (!count) return [];
  const headerRange = sheet.getRange(rateMode ? "A1:J1" : "A1:G1");
  const headers = headerRange.getValues()[0].map((cell) => text(cell));
  if (headers.join("|") !== (rateMode ? DAILY_HEADERS.concat(RATE_HEADERS) : DAILY_HEADERS).join("|")) throw new Error("Daily Entries headings do not match the certified layout");
  if (headerRange.getFormulas()[0].some(value => typeof value === "string" && /^\s*=/.test(value))) throw new Error("Daily formulas need review");
  // A row without a date is not necessarily empty: preserve any free-form
  // notes or hidden formulas instead of discarding them during the rewrite.
  const allUsed = sheet.getUsedRange();
  const allCount = allUsed ? allUsed.getRowIndex() + allUsed.getRowCount() : 0;
  if (allCount > 10000) throw new Error("Daily content needs review");
  if (allCount > 1) {
    const range = sheet.getRange("A2:" + (rateMode ? "J" : "G") + allCount);
    const values = range.getValues(), formulas = range.getFormulas();
    let totals = 0;
    for (let i = 0; i < values.length; i++) {
      const label = text(values[i][0]);
      if (label && label !== "Pay month total") continue;
      if (label === "Pay month total" && ++totals > 1) throw new Error("Daily content needs review");
      for (let j = 0; j < values[i].length; j++) {
        if (label && j === 0) continue;
        const formula = formulas[i][j];
        if (label && j === 5) {
          if (typeof formula === "string" && /^\s*=/.test(formula) && formula !== "=SUM(F2:F" + (i + 1) + ")") throw new Error("Daily formulas need review");
          continue;
        }
        if (text(values[i][j]) || (typeof formula === "string" && /^\s*=/.test(formula))) throw new Error("Daily content needs review");
      }
    }
  }
  if (count < 2) return [];
  // Inputs may be formulas even when their displayed values look ordinary.
  // Only the calculated total column has formulas in the certified layout.
  for (const column of rateMode ? ["A", "B", "C", "D", "E", "G", "H", "I", "J"] : ["A", "B", "C", "D", "E", "G"]) {
    const formulas = sheet.getRange(column + "2:" + column + count).getFormulas();
    if (formulas.some((row) => row.some((cell) => typeof cell === "string" && cell.replace(/^\s+/, "").startsWith("=")))) {
      throw new Error("Formula-like cell text requires review before workbook filing");
    }
  }
  const seenDates: { [date: string]: boolean } = {};
  const totalFormulas = sheet.getRange("F2:F" + count).getFormulas();
  return sheet.getRange("A2:" + (rateMode ? "J" : "G") + count).getValues().map((cells, index) => ({cells, index})).filter(({cells}) => text(cells[0]) && text(cells[0]) !== "Pay month total").map(({cells, index}) => {
    const displayed = minutesFromLabel(cells[5]);
    const input: InputRow = { Date: isoDate(cells[0]), Start: cells[1], Finish: cells[2], Break: cells[3], Absence: cells[4], Notes: cells[6], totalMinutes: displayed === null ? "" : displayed };
    if (rateMode) { input.sourceBasicMinutes = minutesFromLabel(cells[7]); input.sourceOt15Minutes = minutesFromLabel(cells[8]); input.sourceOt20Minutes = minutesFromLabel(cells[9]); }
    const row = normalize(input, month, true, bounds, rateMode);
    if (seenDates[row.date]) throw new Error("Duplicate existing Date: " + row.date);
    seenDates[row.date] = true;
    // Existing review workbooks leave a clockless absence's calculated cell
    // blank. Its worked total is still zero, and the rewritten formula makes
    // that zero explicit without treating the day as missing.
    const stored = displayed === null && row.absence !== "NA" && !row.start && !row.finish ? 0 : displayed;
    if (row.totalMinutes !== stored) throw new Error("Existing Total hours disagrees with clocks on " + row.date);
    const formula = totalFormulas[index][0];
    if (typeof formula === "string" && /^\s*=/.test(formula) && formula !== dailyTotalFormula(row,index+2) && formula !== dailyTotalFormula(row,index+2,true) && formula !== dailyTotalFormula(row,index+2,false,true)) throw new Error("Daily formulas need review");
    return row;
  });
}
function weeksForBounds(bounds: CycleBounds): string[] {
  const weeks: string[] = [];
  let cursor = monday(bounds.start);
  while (cursor <= bounds.end) {
    weeks.push(cursor);
    if (weeks.length > 10) throw new Error("Invalid pay cycle length");
    cursor = new Date(Date.parse(cursor + "T00:00:00Z") + 7 * DAY_MS).toISOString().slice(0, 10);
  }
  return weeks;
}
function findSheet(sheets: ExcelScript.Worksheet[], name: string): ExcelScript.Worksheet | undefined {
  for (let index = 0; index < sheets.length; index++) {
    if (sheets[index].getName().toLowerCase() === name.toLowerCase()) return sheets[index];
  }
  return undefined;
}

function weeklyTotalFormula(dailyName: string, lastDaily: number, line: number): string {
  const quotedSheet = "'" + dailyName.replace(/'/g, "''") + "'";
  const sum = quotedSheet + "!$F$2:$F$" + lastDaily;
  const dates = quotedSheet + "!$A$2:$A$" + lastDaily;
  return '=SUMIFS(' + sum + ',' + dates + ',">="&A' + line + ',' + dates + ',"<="&B' + line + ')';
}
function requireCertifiedWeekly(sheet: ExcelScript.Worksheet, daily: ExcelScript.Worksheet, weeks: string[], existing: DailyRow[]): void {
  const used=sheet.getUsedRange(true), allUsed=sheet.getUsedRange();
  const count=used ? used.getRowIndex()+used.getRowCount() : 0;
  const allCount=allUsed ? allUsed.getRowIndex()+allUsed.getRowCount() : 0;
  if (!count || sheet.getRange("A1:C1").getValues()[0].map(cell=>text(cell)).join("|")!==WEEKLY_HEADERS.join("|")) throw new Error("Weekly layout needs review");
  if (count>weeks.length+2 || allCount>10000) throw new Error("Weekly content needs review");
  if(sheet.getRange("A1:C1").getFormulas()[0].some(value=>typeof value==="string" && /^\s*=/.test(value)) ||
    (allCount>1 && sheet.getRange("A2:B"+allCount).getFormulas().some(row=>row.some(value=>typeof value==="string" && /^\s*=/.test(value))))) throw new Error("Weekly formulas need review");
  if (allCount>weeks.length+2) {
    const extras=sheet.getRange("A"+(weeks.length+3)+":C"+allCount).getFormulas();
    if(extras.some(row=>row.some(value=>typeof value==="string" && /^\s*=/.test(value)))) throw new Error("Weekly formulas need review");
  }
  if(count===1) {
    if(allCount>1 && sheet.getRange("A2:C"+allCount).getFormulas().some(row=>row.some(value=>typeof value==="string" && /^\s*=/.test(value)))) throw new Error("Weekly formulas need review");
    return;
  }
  if(count!==weeks.length+2) throw new Error("Weekly layout needs review");
  const values=sheet.getRange("A2:C"+(weeks.length+2)).getValues();
  const totalFormulas=sheet.getRange("C2:C"+(weeks.length+2)).getFormulas();
  const dailyUsed=daily.getUsedRange(true), dailyCount=dailyUsed ? dailyUsed.getRowIndex()+dailyUsed.getRowCount() : 0;
  const dailyEnd=dailyCount>1 ? text(daily.getRange("A"+dailyCount+":A"+dailyCount).getValues()[0][0]) : "";
  for(let i=0;i<totalFormulas.length;i++) {
    const formula=totalFormulas[i][0];
    if(typeof formula!=="string" || !/^\s*=/.test(formula)) continue;
    const expected=i===weeks.length ? "=SUM(C2:C"+(weeks.length+1)+")" : weeklyTotalFormula(daily.getName(),dailyCount-1,i+2);
    if((i!==weeks.length && (dailyCount<3 || dailyEnd!=="Pay month total")) || formula!==expected) throw new Error("Weekly formulas need review");
  }
  const totalExtraFormula=sheet.getRange("B"+(weeks.length+2)+":B"+(weeks.length+2)).getFormulas()[0][0];
  if(text(values[weeks.length][1]) || (typeof totalExtraFormula==="string" && /^\s*=/.test(totalExtraFormula))) throw new Error("Weekly content needs review");
  const total=existing.reduce((sum,row)=>sum+(row.totalMinutes||0),0);
  if(!weeks.every((start,index)=>{
    const end=weekEnd(start), sum=existing.filter(row=>row.date>=start && row.date<=end).reduce((n,row)=>n+(row.totalMinutes||0),0);
    return isoDate(values[index][0])===start && isoDate(values[index][1])===end && minutesFromLabel(values[index][2])===sum;
  }) || text(values[weeks.length][0])!=="Month total" || minutesFromLabel(values[weeks.length][2])!==total) throw new Error("Weekly totals need review");
}

function write(workbook: ExcelScript.Workbook, rows: DailyRow[], weeks: string[], rateMode = false): number {
  const sheets = workbook.getWorksheets();
  const daily = findSheet(sheets, DAILY);
  const weekly = findSheet(sheets, WEEKLY);
  if (!daily || !weekly) throw new Error("The two register sheets are missing");
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.reduce((sum, row) => sum + (row.totalMinutes || 0), 0);
  const dailyValues: (string | number)[][] = ([(rateMode ? DAILY_HEADERS.concat(RATE_HEADERS) : DAILY_HEADERS)] as (string | number)[][]).concat(rows.map((row) => {
    const cells: (string | number)[] = [excelDate(row.date), excelTime(row.start), excelTime(row.finish), row.breakMinutes === null ? "" : row.breakMinutes, row.absence, row.totalMinutes === null ? "" : row.totalMinutes / 1440, row.notes];
    if (rateMode) [row.sourceBasicMinutes, row.sourceOt15Minutes, row.sourceOt20Minutes].forEach((minutes) => cells.push(minutes === null || minutes === undefined ? "" : minutes / 1440));
    return cells;
  }));
  dailyValues.push(rateMode ? ["Pay month total", "", "", "", "", total / 1440, "", "", "", ""] : ["Pay month total", "", "", "", "", total / 1440, ""]);
  const weeklyValues: (string | number)[][] = [WEEKLY_HEADERS];
  weeks.forEach((start) => {
    const end = weekEnd(start);
    const relevant = rows.filter((row) => row.date >= start && row.date <= end);
    weeklyValues.push([excelDate(start), excelDate(end), relevant.reduce((sum, row) => sum + (row.totalMinutes || 0), 0) / 1440]);
  });
  weeklyValues.push(["Month total", "", total / 1440]);
  [daily, weekly].forEach((sheet) => { const used = sheet.getUsedRange(); if (used) used.clear(ExcelScript.ClearApplyTo.contents); });
  daily.getRangeByIndexes(0, 0, dailyValues.length, rateMode ? 10 : 7).setValues(dailyValues);
  weekly.getRangeByIndexes(0, 0, weeklyValues.length, 3).setValues(weeklyValues);
  const lastDaily = rows.length + 1;
  if (rows.length) {
    daily.getRange("F2:F" + lastDaily).setFormulas(rows.map((row, index) => [dailyTotalFormula(row,index+2)]));
  }
  daily.getRange("F" + (lastDaily + 1)).setFormula("=SUM(F2:F" + lastDaily + ")");
  const lastWeek = weeks.length + 1;
  const totalLine = lastWeek + 1;
  weekly.getRange("C2:C" + lastWeek).setFormulas(weeks.map((_week, index) => {
    const line = index + 2;
    return [weeklyTotalFormula(daily.getName(),lastDaily,line)];
  }));
  weekly.getRange("C" + totalLine).setFormula("=SUM(C2:C" + lastWeek + ")");
  daily.getRange("A2:A" + lastDaily).setNumberFormat("dd/mm/yyyy");
  daily.getRange("B2:C" + lastDaily).setNumberFormat("hh:mm");
  daily.getRange("F2:F" + (lastDaily + 1)).setNumberFormat('[h]"h "mm"m"');
  if (rateMode) daily.getRange("H2:J" + (lastDaily + 1)).setNumberFormat('[h]"h "mm"m"');
  weekly.getRange("A2:B" + lastWeek).setNumberFormat("dd/mm/yyyy");
  weekly.getRange("C2:C" + totalLine).setNumberFormat('[h]"h "mm"m"');
  daily.getRange(rateMode ? "A1:J1" : "A1:G1").getFormat().getFont().setBold(true);
  weekly.getRange("A1:C1").getFormat().getFont().setBold(true);
  daily.getRange("A:A").getFormat().setColumnWidth(105);
  daily.getRange("B:F").getFormat().setColumnWidth(90);
  daily.getRange("G:G").getFormat().setColumnWidth(330);
  weekly.getRange("A:C").getFormat().setColumnWidth(115);
  daily.getFreezePanes().freezeRows(1);
  weekly.getFreezePanes().freezeRows(1);
  return total;
}

function main(workbook: ExcelScript.Workbook, recordJson: string): Result {
  // Company SharePoint files omit the prefix used by portal downloads.
  const file = /^(?:GMT Timesheet - )?(.+) - Pay Month (\d{4}-\d{2})\.xlsx$/i.exec(workbook.getName());
  if (!file) throw new Error("Destination must be a named employee pay-month workbook");
  const sheets = workbook.getWorksheets();
  const daily = findSheet(sheets, DAILY);
  const weekly = findSheet(sheets, WEEKLY);
  if (sheets.length !== 2 || !daily || !weekly) throw new Error("Destination must contain exactly Daily Entries and Weekly Totals");
  const parsed = JSON.parse(recordJson) as Envelope | InputRow[] | InputRow;
  const snapshot = !Array.isArray(parsed) && text((parsed as Envelope).mode) === "replace-pay-month";
  const envelope: Envelope = Array.isArray(parsed) ? { rows: parsed } : snapshot ? parsed as Envelope : { rows: [parsed as InputRow] };
  if (snapshot && envelope.schemaVersion !== undefined && envelope.schemaVersion !== 2 && envelope.schemaVersion !== 3) throw new Error("Unsupported snapshot schema");
  const rateMode = snapshot && envelope.schemaVersion === 3;
  // The writer clears each used range. Refuse a workbook containing content
  // beyond the certified layout rather than silently deleting that content.
  for (const entry of [{sheet: daily, width: rateMode ? 10 : 7}, {sheet: weekly, width: 3}]) {
    const used = entry.sheet.getUsedRange(true);
    if (used && used.getColumnIndex() + used.getColumnCount() > entry.width) throw new Error("Content outside the certified register columns requires review");
    const allUsed = entry.sheet.getUsedRange();
    const lastColumn = allUsed ? allUsed.getColumnIndex() + allUsed.getColumnCount() : 0;
    const lastRow = allUsed ? allUsed.getRowIndex() + allUsed.getRowCount() : 0;
    if (lastColumn > entry.width) {
      if (lastColumn > 200 || lastRow > 10000) throw new Error("Content outside the certified register columns requires review");
      const formulas = entry.sheet.getRangeByIndexes(0,entry.width,lastRow,lastColumn-entry.width).getFormulas();
      if (formulas.some(row => row.some(value => typeof value === "string" && /^\s*=/.test(value)))) throw new Error("Formula outside the certified register columns requires review");
    }
  }
  const month = file[2];
  if (envelope.payMonth && envelope.payMonth !== month) throw new Error("Snapshot pay month does not match workbook");
  if (envelope.employeeName && envelope.employeeName.toLowerCase() !== file[1].toLowerCase()) throw new Error("Employee does not match workbook");
  let bounds: CycleBounds | null = null;
  if (envelope.cycleStart || envelope.cycleEnd) {
    if (!envelope.cycleStart || !envelope.cycleEnd) throw new Error("Both pay cycle bounds are required");
    const start = isoDate(envelope.cycleStart), end = isoDate(envelope.cycleEnd);
    const span = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY_MS;
    if (span < 0 || span > 61) throw new Error("Invalid pay cycle bounds");
    bounds = {start, end};
  }
  const weeks = bounds ? weeksForBounds(bounds) : monthWeeks(month);
  const existing = currentRows(daily, month, bounds, rateMode);
  requireCertifiedWeekly(weekly, daily, weeks, existing);
  const byDate: { [date: string]: DailyRow } = {};
  if (!snapshot) existing.forEach((row) => { byDate[row.date] = row; });
  const incoming = (envelope.rows || []).map((raw) => {
    const name = text(value(raw, ["employeeName", "employee_name"])) || text(envelope.employeeName);
    if (name.toLowerCase() !== file[1].toLowerCase()) throw new Error("Employee does not match workbook");
    return normalize(raw, month, !snapshot, bounds, rateMode);
  });
  existing.forEach((row) => requireSafeCellText(row));
  incoming.forEach((row) => requireSafeCellText(row));
  const sourceId = text(envelope.recordId);
  if (snapshot && sourceId && (envelope.rows || []).some((raw, index) => text(value(raw, ["recordId", "record_id"])) !== sourceId + "|" + incoming[index].date)) {
    throw new Error("Snapshot source row identity does not match its record and date");
  }
  const seen: { [date: string]: boolean } = {};
  let created = 0, updated = 0, unchanged = 0;
  incoming.forEach((row) => {
    if (seen[row.date]) throw new Error("Conflicting duplicate Date in one submission: " + row.date);
    seen[row.date] = true;
    const old = existing.find((item) => item.date === row.date);
    if (!old) created++;
    else if (key(old) === key(row) && (!snapshot || old.notes === row.notes)) {
      unchanged++;
      if (!snapshot) return;
    }
    else if (snapshot) updated++;
    else throw new Error("Conflicting submitted version for " + row.date + "; review source before changing payroll");
    byDate[row.date] = row;
  });
  if (snapshot && !incoming.length) throw new Error("Empty pay-month snapshot cannot replace a workbook");
  const removed = snapshot ? existing.filter((row) => !seen[row.date]).length : 0;
  const rows = Object.keys(byDate).sort().map((date) => byDate[date]);
  const total = write(workbook, rows, weeks, rateMode);
  workbook.getApplication().calculate(ExcelScript.CalculationType.full);
  // Re-read the workbook rather than reporting the values that were sent to
  // setValues. In replacement mode also ensure no old dated row remains.
  const persisted = currentRows(daily, month, bounds, rateMode);
  const verifiedRows: VerifiedRow[] = [];
  const unverifiedRecordIds: string[] = [];
  if (snapshot && sourceId) {
    incoming.forEach((row) => {
      const id = sourceId + "|" + row.date;
      const actual = persisted.find((item) => item.date === row.date);
      if (actual && key(actual) === key(row) && actual.notes === row.notes) verifiedRows.push({ recordId: id, ...actual });
      else unverifiedRecordIds.push(id);
    });
    if (persisted.length !== incoming.length || unverifiedRecordIds.length) {
      throw new Error("Workbook read-back does not match the full pay-month snapshot");
    }
    const savedWeeks = weekly.getRange("A2:C" + (weeks.length + 2)).getValues();
    const savedDailyTotal = daily.getRange("F" + (rows.length + 2)).getValues()[0][0];
    const weeklyMatches = weeks.every((start, index) => {
      const end = weekEnd(start);
      const expected = rows.filter((row) => row.date >= start && row.date <= end).reduce((sum, row) => sum + (row.totalMinutes || 0), 0);
      return isoDate(savedWeeks[index][0]) === start && isoDate(savedWeeks[index][1]) === end && minutesFromLabel(savedWeeks[index][2]) === expected;
    });
    if (!weeklyMatches || text(savedWeeks[weeks.length][0]) !== "Month total" || minutesFromLabel(savedWeeks[weeks.length][2]) !== total || minutesFromLabel(savedDailyTotal) !== total) {
      throw new Error("Workbook total read-back does not match the pay-month snapshot");
    }
  }
  const verifiedRecordIds = verifiedRows.map((item) => item.recordId);
  return { created, updated, unchanged, removed, rows: rows.length, monthTotalMinutes: total,
    verifiedRecordIds, verifiedRecordIdsJson: JSON.stringify(verifiedRecordIds), verifiedRowsJson: JSON.stringify(verifiedRows), unverifiedRecordIds };
}
