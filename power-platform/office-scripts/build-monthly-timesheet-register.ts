/*
 * Power Automate calls this script with a JSON array built from validated
 * Clock Events and Timesheet Submissions List items. Run it against a fresh
 * copy of the GMT monthly-register template, never against an arbitrary book.
 */

type PortalRecord = {
  recordId?: string;
  employeeName?: string;
  employeeEmail?: string;
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
  note?: string;
  sourceFolderLink?: string;
};

const RECORD_HEADERS = [
  "Employee", "Employee email", "Date", "Action", "Status", "Absence reason",
  "Start", "Lunch start", "Lunch end", "Finish", "Worked hours", "Basic hours",
  "OT x1.5 hours", "OT x2.0 hours", "Note", "Source record ID", "Source folder link"
];

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function requireSafeCellText(value: unknown): void {
  // Match the employee register's conservative handling of formula-like text.
  if (/^[=+\-@]/.test(text(value).replace(/^\s+/, ""))) {
    throw new Error("Formula-like cell text requires review before workbook filing");
  }
}

function hours(value: unknown): number | string {
  if (value == null || (typeof value === "string" && value.trim() === "")) return "";
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Invalid source hours");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid source hours");
  return parsed;
}

function completeTotal(values: unknown[]): number | string {
  const parsed = values.map(hours);
  if (parsed.some((value) => value === "")) return "";
  return parsed.reduce<number>((sum, value) => sum + Number(value), 0);
}

function safeSheetName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

function clearSheet(sheet: ExcelScript.Worksheet): void {
  const used = sheet.getUsedRange();
  if (used) used.clear(ExcelScript.ClearApplyTo.all);
  sheet.getTables().forEach((table) => table.delete());
}

function getOutputSheet(workbook: ExcelScript.Workbook, name: string): ExcelScript.Worksheet {
  const existing = workbook.getWorksheet(name);
  if (existing) {
    clearSheet(existing);
    return existing;
  }
  return workbook.addWorksheet(name);
}

function writeRecords(sheet: ExcelScript.Worksheet, records: PortalRecord[]): void {
  sheet.getRangeByIndexes(0, 0, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
  const values = records.map((record) => [
    text(record.employeeName), text(record.employeeEmail), text(record.date), text(record.action),
    text(record.status), text(record.absenceReason), text(record.startTime), text(record.lunchStart),
    text(record.lunchEnd), text(record.finishTime), hours(record.workedHours), hours(record.basicHours),
    hours(record.ot15Hours), hours(record.ot20Hours), text(record.note), text(record.recordId),
    text(record.sourceFolderLink)
  ]);
  if (values.length) sheet.getRangeByIndexes(1, 0, values.length, RECORD_HEADERS.length).setValues(values);
  const used = sheet.getUsedRange();
  if (!used) return;
  used.getFormat().autofitColumns();
  used.getFormat().autofitRows();
  sheet.freezePanes.freezeRows(1);
}

function main(workbook: ExcelScript.Workbook, recordsJson: string, monthLabel: string): { employees: number; records: number; sheets: string[] } {
  const parsed = JSON.parse(recordsJson || "[]") as PortalRecord[];
  if (!Array.isArray(parsed) || parsed.some((record) => !record || typeof record !== "object" || Array.isArray(record) || !text(record.employeeName).trim() || !text(record.date).trim())) {
    throw new Error("Each source record requires an employee and date");
  }
  const records = parsed
    .sort((a, b) => `${text(a.employeeName)}|${text(a.date)}`.localeCompare(`${text(b.employeeName)}|${text(b.date)}`));
  records.forEach((record) => {
    [record.workedHours, record.basicHours, record.ot15Hours, record.ot20Hours].forEach(hours);
    [record.employeeName, record.employeeEmail, record.date, record.action, record.status,
      record.absenceReason, record.startTime, record.lunchStart, record.lunchEnd, record.finishTime,
      record.note, record.recordId, record.sourceFolderLink].forEach(requireSafeCellText);
  });
  requireSafeCellText(monthLabel);
  const byEmployee = new Map<string, PortalRecord[]>();
  records.forEach((record) => {
    const key = `${text(record.employeeName).trim()}|${text(record.employeeEmail).trim().toLowerCase()}`;
    const current = byEmployee.get(key) || [];
    current.push(record);
    byEmployee.set(key, current);
  });

  const allUsers = getOutputSheet(workbook, "All Users");
  writeRecords(allUsers, records);
  const occupied = new Set<string>(["all users", "monthly totals"]);
  const outputSheets = ["All Users"];

  [...byEmployee.entries()].forEach(([key, employeeRecords], index) => {
    const employeeName = key.split("|")[0];
    const baseName = safeSheetName(employeeName, `Employee ${index + 1}`);
    let sheetName = baseName;
    let suffix = 2;
    while (occupied.has(sheetName.toLowerCase())) {
      const ending = ` ${suffix}`;
      sheetName = `${baseName.slice(0, 31 - ending.length)}${ending}`;
      suffix += 1;
    }
    occupied.add(sheetName.toLowerCase());
    writeRecords(getOutputSheet(workbook, sheetName), employeeRecords);
    outputSheets.push(sheetName);
  });

  const totals = getOutputSheet(workbook, "Monthly Totals");
  const totalHeaders = ["Employee", "Employee email", "Records", "Absent days", "Worked hours", "Basic hours", "OT x1.5 hours", "OT x2.0 hours"];
  totals.getRangeByIndexes(0, 0, 1, totalHeaders.length).setValues([totalHeaders]);
  const totalValues = [...byEmployee.values()].map((employeeRecords) => {
    const first = employeeRecords[0];
    return [
      text(first.employeeName), text(first.employeeEmail), employeeRecords.length,
      employeeRecords.filter((record) => text(record.status).toLowerCase() === "absent").length,
      completeTotal(employeeRecords.map((record) => record.workedHours)),
      completeTotal(employeeRecords.map((record) => record.basicHours)),
      completeTotal(employeeRecords.map((record) => record.ot15Hours)),
      completeTotal(employeeRecords.map((record) => record.ot20Hours))
    ];
  });
  if (totalValues.length) totals.getRangeByIndexes(1, 0, totalValues.length, totalHeaders.length).setValues(totalValues);
  totals.getRange("J1").setValue("Month");
  totals.getRange("J2").setValue(monthLabel);
  const totalUsed = totals.getUsedRange();
  if (totalUsed) {
    totalUsed.getFormat().autofitColumns();
    totalUsed.getFormat().autofitRows();
  }
  totals.freezePanes.freezeRows(1);
  outputSheets.push("Monthly Totals");
  return { employees: byEmployee.size, records: records.length, sheets: outputSheets };
}
