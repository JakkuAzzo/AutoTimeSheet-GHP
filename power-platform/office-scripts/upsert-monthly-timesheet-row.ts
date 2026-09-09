/*
 * Power Automate action: Excel Online (Business) -> Run script.
 *
 * Run this against the employee/month workbook copied from the approved GMT
 * monthly-timesheet template. The script creates the event worksheet on first use and
 * retains every submitted version. Exact retries are skipped; changed versions
 * are appended and flagged, never silently substituted for original entries.
 */

type MonthlyTimesheetRecord = {
  recordId?: string;
  employeeName?: string;
  employeeEmail?: string;
  weekStart?: string;
  weekEnd?: string;
  date?: string;
  action?: string;
  status?: string;
  absenceReason?: string;
  startTime?: string;
  lunchStart?: string;
  lunchEnd?: string;
  finishTime?: string;
  workedHours?: number | string;
  basicHours?: number | string;
  ot15Hours?: number | string;
  ot20Hours?: number | string;
  location?: string;
  note?: string;
  submittedAt?: string;
  sourceFolderLink?: string;
};

type UpsertResult = {
  created: number;
  updated: number;
  unchanged: number;
  flagged: number;
  skipped: number;
  recordIds: string[];
  skippedRecordIds: string[];
};

const SHEET_NAME = "Timesheet Events";
const RECORD_ID_HEADER = "Source record ID";
const HEADERS = [
  "Employee", "Employee email", "Week start", "Week end", "Date", "Action", "Status",
  "Absence reason", "Start", "Lunch start", "Lunch end", "Finish", "Worked hours",
  "Basic hours", "OT x1.5 hours", "OT x2.0 hours", "Location / site", "Note",
  "Submitted at", RECORD_ID_HEADER, "Source folder link"
];
const FORM_FIELD_NAMES = [
  "employee_name", "email", "gmt_type", "gmt_action", "gmt_record_id", "gmt_submission_id",
  "gmt_employee", "gmt_employee_email", "gmt_employee_upn", "gmt_week_start", "gmt_week_end",
  "gmt_clock_date", "gmt_clock_time", "gmt_absence_reason", "gmt_location", "gmt_note",
  "gmt_day_start", "gmt_lunch_start", "gmt_lunch_end", "gmt_day_finish", "gmt_year", "gmt_month",
  "gmt_worked_hours", "gmt_basic_hours", "gmt_ot15_hours", "gmt_ot20_hours", "gmt_submitted_at",
  "clock_action", "clock_date", "clock_time", "absence_reason", "location", "note", "summary", "message"
];

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function number(value: unknown): number | string {
  const parsed = Number(value);
  // Preserve malformed submitted values so reconciliation can flag them.
  return Number.isFinite(parsed) ? parsed : text(value);
}

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|tr|dt|dd|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#124;/gi, "|")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function escaped(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function fieldFromFormBody(body: string, name: string): string {
  const allNames = FORM_FIELD_NAMES.map((fieldName) => escaped(fieldName)).join("|");
  const pattern = new RegExp(
    "(?:^|\\s)" + escaped(name) +
    "\\s*:?\\s*([\\s\\S]*?)(?=\\s+(?:" + allNames + ")\\s*:?\\s|\\s+Submitted at\\b|$)",
    "i"
  );
  const match = pattern.exec(" " + body);
  return match ? match[1].trim() : "";
}

function firstField(body: string, names: string[]): string {
  for (const name of names) {
    const value = fieldFromFormBody(body, name);
    if (value) return value;
  }
  return "";
}

function parseFormSubmitBody(input: string): MonthlyTimesheetRecord[] {
  const body = decodeHtml(input);
  const employeeName = firstField(body, ["gmt_employee", "employee_name"]);
  const employeeEmail = firstField(body, ["gmt_employee_upn", "gmt_employee_email", "email"]);
  const action = firstField(body, ["gmt_action", "clock_action"]) || "submission";
  const date = firstField(body, ["gmt_week_start", "gmt_clock_date", "clock_date"]);
  const clockTime = firstField(body, ["gmt_clock_time", "clock_time"]);
  const recordId = firstField(body, ["gmt_record_id", "gmt_submission_id"]) ||
    [employeeEmail || employeeName, date, action, clockTime].join("|");
  if (!employeeName && !employeeEmail) return [];
  return [{
    recordId, employeeName, employeeEmail,
    weekStart: firstField(body, ["gmt_week_start"]) || date,
    weekEnd: firstField(body, ["gmt_week_end"]) || date,
    date, action,
    status: action === "submission" ? "Submitted" : "Recorded",
    absenceReason: firstField(body, ["gmt_absence_reason", "absence_reason"]),
    startTime: firstField(body, ["gmt_day_start"]),
    lunchStart: firstField(body, ["gmt_lunch_start"]),
    lunchEnd: firstField(body, ["gmt_lunch_end"]),
    finishTime: firstField(body, ["gmt_day_finish"]),
    workedHours: firstField(body, ["gmt_worked_hours"]),
    basicHours: firstField(body, ["gmt_basic_hours"]),
    ot15Hours: firstField(body, ["gmt_ot15_hours"]),
    ot20Hours: firstField(body, ["gmt_ot20_hours"]),
    location: firstField(body, ["gmt_location", "location"]),
    note: firstField(body, ["gmt_note", "note", "summary", "message"]),
    submittedAt: firstField(body, ["gmt_submitted_at"])
  }];
}

function parseRecords(input: string): MonthlyTimesheetRecord[] {
  const value = text(input).trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as MonthlyTimesheetRecord | MonthlyTimesheetRecord[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    return parseFormSubmitBody(value);
  }
}

function isSyntheticOrAdminRecord(record: MonthlyTimesheetRecord): boolean {
  const employeeName = text(record.employeeName).trim().toLowerCase();
  const employeeEmail = text(record.employeeEmail).trim().toLowerCase();
  const recordId = text(record.recordId).trim().toLowerCase();

  // The admin accounts are transport/validation identities, not payroll
  // employees. Synthetic IDs are also deliberately prefixed so route and
  // reconciliation tests cannot enter employee history by accident.
  return employeeName === "test" || /^test(?:[-_]|$)/.test(recordId) ||
    employeeEmail.includes("acc.gmtelect") || employeeEmail.includes("amanda");
}

function recordValues(record: MonthlyTimesheetRecord): (string | number)[] {
  return [
    text(record.employeeName), text(record.employeeEmail), text(record.weekStart), text(record.weekEnd),
    text(record.date || record.weekStart), text(record.action), text(record.status), text(record.absenceReason),
    text(record.startTime), text(record.lunchStart), text(record.lunchEnd), text(record.finishTime),
    number(record.workedHours), number(record.basicHours), number(record.ot15Hours), number(record.ot20Hours),
    text(record.location), text(record.note), text(record.submittedAt), text(record.recordId),
    text(record.sourceFolderLink)
  ];
}

function getOrCreateSheet(workbook: ExcelScript.Workbook): ExcelScript.Worksheet {
  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) sheet = workbook.addWorksheet(SHEET_NAME);
  return sheet;
}

function normalizedCell(value: string | number | boolean, column: number): string {
  if (typeof value === "number" && [2, 3, 4].indexOf(column) >= 0) {
    return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (typeof value === "number" && [8, 9, 10, 11].indexOf(column) >= 0) {
    const minutes = Math.round(value * 1440) % 1440;
    return ("0" + Math.floor(minutes / 60)).slice(-2) + ":" + ("0" + minutes % 60).slice(-2);
  }
  return text(value).trim();
}

function sameSubmission(a: (string | number | boolean)[], b: (string | number | boolean)[]): boolean {
  // Source-folder links may be enriched independently; they are not a new submission.
  return a.slice(0, 20).every((value, column) => normalizedCell(value, column) === normalizedCell(b[column], column));
}

function refreshReconciliation(workbook: ExcelScript.Workbook, sheet: ExcelScript.Worksheet, rows: (string | number | boolean)[][]): number {
  const issues: string[][] = rows.map(() => []);
  const related: number[][] = rows.map(() => []);
  const day = (value: string): number => /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + "T00:00:00Z") / 86400000 : NaN;
  const bounds = rows.map((row, index) => {
    const date = day(normalizedCell(row[4] || row[2], 4));
    const start = normalizedCell(row[8], 8);
    const finish = normalizedCell(row[11], 11);
    const weekly = !start && !finish && text(row[5]) === "submission" && normalizedCell(row[4], 4) === normalizedCell(row[2], 2);
    const endDay = weekly ? day(normalizedCell(row[3], 3)) : date;
    if (!Number.isFinite(date) || !Number.isFinite(endDay) || endDay < date) issues[index].push("Invalid date range");
    if ([12, 13, 14, 15].some((column) => !Number.isFinite(Number(row[column])) || Number(row[column]) < 0)) issues[index].push("Invalid hours");
    if (Number(row[12]) > 0 && Math.abs(Number(row[12]) - Number(row[13]) - Number(row[14]) - Number(row[15])) > 0.02) issues[index].push("Hour totals do not reconcile");
    const minute = (value: string): number => /^\d{1,2}:\d{2}$/.test(value) && Number(value.split(":")[0]) < 24 && Number(value.split(":")[1]) < 60 ? Number(value.split(":")[0]) * 60 + Number(value.split(":")[1]) : NaN;
    const from = minute(start);
    const to = minute(finish);
    if ((start && !Number.isFinite(from)) || (finish && !Number.isFinite(to))) issues[index].push("Invalid time");
    // Clock-in/out milestones alone are not overlapping work intervals.
    const milestone = text(row[5]) !== "submission" && (!start || !finish);
    return { start: date * 1440 + (Number.isFinite(from) ? from : 0), end: endDay * 1440 + (Number.isFinite(to) ? to + (Number.isFinite(from) && to <= from ? 1440 : 0) : 1440), milestone };
  });
  rows.forEach((row, i) => {
    rows.forEach((other, j) => {
      if (j <= i) return;
      const revision = text(row[19]) === text(other[19]);
      const overlap = !bounds[i].milestone && !bounds[j].milestone && bounds[i].start < bounds[j].end && bounds[j].start < bounds[i].end;
      if (!revision && !overlap) return;
      const reason = revision ? "Multiple submitted versions of source record" : "Overlapping submitted time";
      [i, j].forEach((index) => { if (issues[index].indexOf(reason) < 0) issues[index].push(reason); });
      related[i].push(j + 2);
      related[j].push(i + 2);
    });
  });
  sheet.getRange("V1:W1").setValues([["Issues — review Reconciliation", "Related main rows"]]);
  let reconciliation = workbook.getWorksheet("Reconciliation");
  if (!reconciliation) reconciliation = workbook.addWorksheet("Reconciliation");
  reconciliation.getRange("A1:Y1").setValues([[...HEADERS, "Issues", "Related main rows", "Main row", "Reviewer notes (manual)"]]);
  const used = reconciliation.getUsedRange(true);
  const last = used ? used.getRowIndex() + used.getRowCount() : 1;
  const reviewRows: { [key: string]: number } = {};
  if (last > 1) reconciliation.getRange("X2:X" + last).getValues().forEach((row, index) => { reviewRows[text(row[0])] = index + 2; });
  let next = Math.max(2, last + 1);
  let flagged = 0;
  rows.forEach((row, index) => {
    const mainRow = index + 2;
    const issue = issues[index].join("; ");
    const links = related[index].join(", ");
    sheet.getRange("V" + mainRow + ":W" + mainRow).setValues([[issue, links]]);
    if (!issue) return;
    flagged++;
    sheet.getRange("A" + mainRow + ":W" + mainRow).getFormat().getFill().setColor("#FFF2CC");
    const target = reviewRows[text(mainRow)] || next++;
    // Leave Y and later columns untouched so a replay preserves reviewer notes.
    reconciliation.getRange("A" + target + ":X" + target).setValues([[...row.slice(0, 21), issue, links, mainRow]]);
  });
  [sheet, reconciliation].forEach((page) => {
    const bottom = Math.max(2, rows.length + 1);
    // Values copied from Excel may be date/time serials. Preserve the values,
    // but apply explicit display formats on both the source and review sheets.
    page.getRange("C2:E" + bottom).setNumberFormat("dd/mm/yyyy");
    page.getRange("I2:L" + bottom).setNumberFormat("hh:mm");
    page.getRange("M2:P" + bottom).setNumberFormat("0.00");
    page.getRange("A1:U" + bottom).getFormat().setColumnWidth(110);
    page.getRange("C1:E" + bottom).getFormat().setColumnWidth(90);
    page.getRange("I1:L" + bottom).getFormat().setColumnWidth(75);
    page.getRange("A1:W1").getFormat().setWrapText(true);
    page.getRange("A1:W1").getFormat().getFont().setBold(true);
    page.getRange("A1:W1").getFormat().getFill().setColor("#D9EAD3");
    page.getRange("V1:W" + Math.max(2, rows.length + 1)).getFormat().setColumnWidth(230);
    page.getRange("V1:W" + Math.max(2, rows.length + 1)).getFormat().setWrapText(true);
    page.getRange("A1:W" + bottom).getFormat().autofitRows();
  });
  return flagged;
}

function main(workbook: ExcelScript.Workbook, recordJson: string): UpsertResult {
  const parsed = parseRecords(recordJson);
  if (!parsed.length || parsed.some((record) => !record || !text(record.recordId).trim() || !text(record.employeeName).trim())) {
    throw new Error("No valid timesheet records: employeeName and recordId are required.");
  }
  const skippedRecords = parsed.filter(isSyntheticOrAdminRecord);
  const records = parsed.filter((record) => !isSyntheticOrAdminRecord(record));
  if (!records.length) {
    return {
      created: 0, updated: 0, unchanged: 0, flagged: 0,
      skipped: skippedRecords.length,
      recordIds: [],
      skippedRecordIds: skippedRecords.map((record) => text(record.recordId).trim()).filter((value) => Boolean(value))
    };
  }
  const fileMatch = /^GMT Timesheet - (.+) - (\d{4}-\d{2})\.xlsx$/i.exec(workbook.getName());
  if (!fileMatch) throw new Error("The destination is not a named employee/month timesheet workbook.");
  records.forEach((record) => {
    if (text(record.employeeName).trim().toLowerCase() !== fileMatch[1].trim().toLowerCase()) {
      throw new Error("Employee does not match the destination workbook.");
    }
    const recordMonth = text(record.date || record.weekStart).slice(0, 7);
    if (recordMonth !== fileMatch[2]) throw new Error("Record month does not match the destination workbook.");
  });
  const sheet = getOrCreateSheet(workbook);
  sheet.getRange("A1:U1").setValues([HEADERS]);

  // Read populated values only: formatting can otherwise extend a worksheet to
  // its final row. Keep absolute row numbers for reconciliation references.
  const used = sheet.getUsedRange(true);
  const lastRow = used ? used.getRowIndex() + used.getRowCount() : 1;
  const rows = lastRow > 1 ? sheet.getRange("A2:U" + lastRow).getValues() : [];
  const existingById: { [key: string]: number[] } = {};
  rows.forEach((row, index) => {
    const id = "id:" + text(row[19]).trim();
    if (!existingById[id]) existingById[id] = [];
    existingById[id].push(index);
  });
  let nextRow = Math.max(2, lastRow + 1);
  let created = 0;
  let unchanged = 0;
  records.forEach((record) => {
    const id = text(record.recordId).trim();
    if (!id) return;
    const values = recordValues(record);
    const versions = existingById["id:" + id] || [];
    if (versions.some((index) => sameSubmission(rows[index], values))) { unchanged++; return; }
    const targetRow = nextRow++;
    sheet.getRange("A" + targetRow + ":U" + targetRow).setValues([values]);
    versions.push(rows.length);
    existingById["id:" + id] = versions;
    rows.push(values);
    created++;
  });

  const flagged = refreshReconciliation(workbook, sheet, rows);
  return {
    created, updated: 0, unchanged, flagged,
    skipped: skippedRecords.length,
    recordIds: records.map((record) => text(record.recordId).trim()).filter((value) => Boolean(value)),
    skippedRecordIds: skippedRecords.map((record) => text(record.recordId).trim()).filter((value) => Boolean(value))
  };
}
