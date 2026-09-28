/*
 * GMT employee pay-month register. Run only against a certified workbook with
 * exactly the Daily Entries and Weekly Totals sheets. Original dated records
 * add new days; a portal replace-pay-month snapshot replaces the full month.
 * Conflicting originals stop for review instead of silently changing payroll.
 */

type InputRow = Record<string, unknown>;
type Envelope = {
  mode?: string;
  recordId?: string;
  employeeName?: string;
  employeeEmail?: string;
  payMonth?: string;
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
};
type Result = { created: number; updated: number; unchanged: number; removed: number; rows: number; monthTotalMinutes: number };

const DAILY = "Daily Entries";
const WEEKLY = "Weekly Totals";
const DAILY_HEADERS = ["Date", "Start", "Finish", "Break", "Absence", "Total hours", "Notes"];
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
function normalize(row: InputRow, month: string, sourceInNotes = true): DailyRow {
  const date = isoDate(value(row, ["date", "Date"]));
  if (payMonthForDate(date) !== month) throw new Error("Date " + date + " is outside pay month " + month);
  const start = clockText(value(row, ["startTime", "start", "Start"]));
  const finish = clockText(value(row, ["finishTime", "finish", "Finish"]));
  const rawNote = text(value(row, ["note", "Notes", "description"]));
  const pause = breakMinutes(row, rawNote);
  const absence = text(value(row, ["absenceReason", "absenceStatus", "absence", "Absence"])) || "NA";
  const from = clockMinutes(start);
  const to = clockMinutes(finish);
  let total: number | null = null;
  if (from !== null && to !== null && pause !== null) {
    const elapsed = to >= from ? to - from : to + 1440 - from;
    if (elapsed <= 0 || pause > elapsed) throw new Error("Invalid hours on " + date);
    total = elapsed - pause;
  } else if (from === null && to === null && absence !== "NA") total = 0;
  if (row.totalMinutes !== undefined && row.totalMinutes !== null && row.totalMinutes !== "" && total !== null && Number(row.totalMinutes) !== total) {
    throw new Error("Clock total differs from supplied Total hours on " + date);
  }
  const changeNote = text(row.changeNote);
  const sourceId = text(value(row, ["recordId", "record_id"]));
  const notes = [rawNote, changeNote, sourceInNotes && sourceId && !changeNote ? "Source " + sourceId : ""].filter((part) => Boolean(part)).join(" | ");
  return { date, start, finish, breakMinutes: pause, absence, totalMinutes: total, notes };
}
function key(row: DailyRow): string { return [row.start, row.finish, row.breakMinutes === null ? "" : row.breakMinutes, row.absence, row.totalMinutes === null ? "" : row.totalMinutes].join("|"); }
function monday(date: string): string {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
function excelDate(date: string): number { return Date.parse(date + "T00:00:00Z") / DAY_MS + 25569; }
function excelTime(time: string): number | string { const minutes = clockMinutes(time); return minutes === null ? "" : minutes / 1440; }
function weekEnd(date: string, finalWeek: boolean): string {
  return new Date(Date.parse(date + "T00:00:00Z") + (finalWeek ? 4 : 6) * DAY_MS).toISOString().slice(0, 10);
}
function monthWeeks(month: string): string[] {
  const anchor = new Date(PAY_MONTH_ANCHOR);
  for (let shift = -120; shift <= 120; shift++) {
    const start = new Date(anchor.getTime() + shift * 28 * DAY_MS).toISOString().slice(0, 10);
    if (payMonthForDate(start) === month) return [0, 7, 14, 21].map((days) => new Date(Date.parse(start + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10));
  }
  throw new Error("Unsupported pay month: " + month);
}
function currentRows(sheet: ExcelScript.Worksheet, month: string): DailyRow[] {
  const used = sheet.getUsedRange(true);
  const count = used ? used.getRowIndex() + used.getRowCount() : 0;
  if (!count) return [];
  const headers = sheet.getRange("A1:G1").getValues()[0].map((cell) => text(cell));
  if (headers.join("|") !== DAILY_HEADERS.join("|")) throw new Error("Daily Entries headings do not match the certified seven-column format");
  if (count < 2) return [];
  const seenDates: { [date: string]: boolean } = {};
  return sheet.getRange("A2:G" + count).getValues().filter((cells) => text(cells[0]) && text(cells[0]) !== "Pay month total").map((cells) => {
    const row = normalize({ Date: isoDate(cells[0]), Start: cells[1], Finish: cells[2], Break: cells[3], Absence: cells[4], Notes: cells[6] }, month);
    if (seenDates[row.date]) throw new Error("Duplicate existing Date: " + row.date);
    seenDates[row.date] = true;
    // Existing review workbooks leave a clockless absence's calculated cell
    // blank. Its worked total is still zero, and the rewritten formula makes
    // that zero explicit without treating the day as missing.
    const displayed = minutesFromLabel(cells[5]);
    const stored = displayed === null && row.absence !== "NA" && !row.start && !row.finish ? 0 : displayed;
    if (row.totalMinutes !== stored) throw new Error("Existing Total hours disagrees with clocks on " + row.date);
    return row;
  });
}
function write(workbook: ExcelScript.Workbook, rows: DailyRow[], month: string): number {
  const daily = workbook.getWorksheets().find((sheet) => sheet.getName().toLowerCase() === DAILY.toLowerCase());
  const weekly = workbook.getWorksheets().find((sheet) => sheet.getName().toLowerCase() === WEEKLY.toLowerCase());
  if (!daily || !weekly) throw new Error("The two register sheets are missing");
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.reduce((sum, row) => sum + (row.totalMinutes || 0), 0);
  const dailyValues: (string | number)[][] = [DAILY_HEADERS].concat(rows.map((row) => [excelDate(row.date), excelTime(row.start), excelTime(row.finish), row.breakMinutes === null ? "" : row.breakMinutes, row.absence, row.totalMinutes === null ? "" : row.totalMinutes / 1440, row.notes]));
  dailyValues.push(["Pay month total", "", "", "", "", total / 1440, ""]);
  const weeklyValues: (string | number)[][] = [WEEKLY_HEADERS];
  monthWeeks(month).forEach((start, index) => {
    const end = weekEnd(start, index === 3);
    const relevant = rows.filter((row) => row.date >= start && row.date <= end);
    weeklyValues.push([excelDate(start), excelDate(end), relevant.reduce((sum, row) => sum + (row.totalMinutes || 0), 0) / 1440]);
  });
  weeklyValues.push(["Month total", "", total / 1440]);
  [daily, weekly].forEach((sheet) => { const used = sheet.getUsedRange(); if (used) used.clear(ExcelScript.ClearApplyTo.contents); });
  daily.getRangeByIndexes(0, 0, dailyValues.length, 7).setValues(dailyValues);
  weekly.getRangeByIndexes(0, 0, weeklyValues.length, 3).setValues(weeklyValues);
  const lastDaily = rows.length + 1;
  if (rows.length) {
    daily.getRange("F2:F" + lastDaily).setFormulas(rows.map((_row, index) => {
      const line = index + 2;
      return ['=IF(E' + line + '<>"NA",0,IF(OR(B' + line + '="",C' + line + '="",D' + line + '=""),"",MOD(C' + line + '-B' + line + ',1)-D' + line + '/1440))'];
    }));
  }
  daily.getRange("F" + (lastDaily + 1)).setFormula("=SUM(F2:F" + lastDaily + ")");
  const quotedSheet = "'" + daily.getName().replace(/'/g, "''") + "'";
  weekly.getRange("C2:C5").setFormulas([2, 3, 4, 5].map((line) => {
    const sum = quotedSheet + "!$F$2:$F$" + lastDaily;
    const dates = quotedSheet + "!$A$2:$A$" + lastDaily;
    return ['=SUMIFS(' + sum + ',' + dates + ',">="&A' + line + ',' + dates + ',"<="&B' + line + ')'];
  }));
  weekly.getRange("C6").setFormula("=SUM(C2:C5)");
  daily.getRange("A2:A" + lastDaily).setNumberFormat("dd/mm/yyyy");
  daily.getRange("B2:C" + lastDaily).setNumberFormat("hh:mm");
  daily.getRange("F2:F" + (lastDaily + 1)).setNumberFormat('[h]"h "mm"m"');
  weekly.getRange("A2:B5").setNumberFormat("dd/mm/yyyy");
  weekly.getRange("C2:C6").setNumberFormat('[h]"h "mm"m"');
  daily.getRange("A1:G1").getFormat().getFont().setBold(true);
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
  const daily = sheets.find((sheet) => sheet.getName().toLowerCase() === DAILY.toLowerCase());
  const weekly = sheets.find((sheet) => sheet.getName().toLowerCase() === WEEKLY.toLowerCase());
  if (sheets.length !== 2 || !daily || !weekly) throw new Error("Destination must contain exactly Daily Entries and Weekly Totals");
  const parsed = JSON.parse(recordJson) as Envelope | InputRow[] | InputRow;
  const snapshot = !Array.isArray(parsed) && text((parsed as Envelope).mode) === "replace-pay-month";
  const envelope: Envelope = Array.isArray(parsed) ? { rows: parsed } : snapshot ? parsed as Envelope : { rows: [parsed as InputRow] };
  const month = file[2];
  if (envelope.payMonth && envelope.payMonth !== month) throw new Error("Snapshot pay month does not match workbook");
  if (envelope.employeeName && envelope.employeeName.toLowerCase() !== file[1].toLowerCase()) throw new Error("Employee does not match workbook");
  const existing = currentRows(daily, month);
  const byDate: { [date: string]: DailyRow } = {};
  if (!snapshot) existing.forEach((row) => { byDate[row.date] = row; });
  const incoming = (envelope.rows || []).map((raw) => {
    const name = text(value(raw, ["employeeName", "employee_name"])) || text(envelope.employeeName);
    if (name.toLowerCase() !== file[1].toLowerCase()) throw new Error("Employee does not match workbook");
    return normalize(raw, month, !snapshot);
  });
  const seen: { [date: string]: boolean } = {};
  let created = 0, updated = 0, unchanged = 0;
  incoming.forEach((row) => {
    if (seen[row.date]) throw new Error("Conflicting duplicate Date in one submission: " + row.date);
    seen[row.date] = true;
    const old = existing.find((item) => item.date === row.date);
    if (!old) created++;
    else if (key(old) === key(row)) unchanged++;
    else if (snapshot) updated++;
    else throw new Error("Conflicting submitted version for " + row.date + "; review source before changing payroll");
    byDate[row.date] = row;
  });
  if (snapshot && !incoming.length) throw new Error("Empty pay-month snapshot cannot replace a workbook");
  const removed = snapshot ? existing.filter((row) => !seen[row.date]).length : 0;
  const rows = Object.keys(byDate).sort().map((date) => byDate[date]);
  const total = write(workbook, rows, month);
  return { created, updated, unchanged, removed, rows: rows.length, monthTotalMinutes: total };
}
