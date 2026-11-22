/*
 * Prepares the three source-rate headings in an already certified private
 * workbook. This operation does not establish write ordering: use only after
 * access, destination and concurrent-writer controls have been verified.
 */
type PreparationResult = { status: string };

function main(workbook: ExcelScript.Workbook): PreparationResult {
  if (!/^(?:GMT Timesheet - )?(.+) - Pay Month (\d{4}-\d{2})\.xlsx$/i.test(workbook.getName())) throw new Error("Workbook name needs review");
  const sheets = workbook.getWorksheets();
  if (sheets.length !== 2) throw new Error("Workbook layout needs review");
  let daily: ExcelScript.Worksheet | undefined;
  let weekly: ExcelScript.Worksheet | undefined;
  for (const sheet of sheets) {
    if (sheet.getName().toLowerCase() === "daily entries") daily = sheet;
    if (sheet.getName().toLowerCase() === "weekly totals") weekly = sheet;
  }
  if (!daily || !weekly) throw new Error("Workbook layout needs review");
  const base = ["Date", "Start", "Finish", "Break", "Absence", "Total hours", "Notes"];
  const rates = ["Source basic hours", "Source overtime 1.5× hours", "Source overtime 2× hours"];
  const text = (value: string | number | boolean): string => String(value == null ? "" : value).trim();
  if (daily.getRange("A1:G1").getValues()[0].map(value => text(value)).join("|") !== base.join("|") ||
      weekly.getRange("A1:C1").getValues()[0].map(value => text(value)).join("|") !== ["Week Start", "Week End", "Total hours"].join("|")) throw new Error("Workbook headings need review");
  const extra = daily.getRange("H1:J1").getValues()[0].map(value => text(value));
  const alreadyPrepared = extra.join("|") === rates.join("|");
  const dailyUsed = daily.getUsedRange(true), weeklyUsed = weekly.getUsedRange(true);
  if ((dailyUsed && dailyUsed.getColumnIndex() + dailyUsed.getColumnCount() > (alreadyPrepared ? 10 : 7)) ||
      (weeklyUsed && weeklyUsed.getColumnIndex() + weeklyUsed.getColumnCount() > 3)) throw new Error("Content outside certified columns needs review");
  // Values-only ranges can miss a formula whose displayed result is empty.
  // Inspect the whole used row span before placing or trusting rate headings.
  const allDaily = daily.getUsedRange();
  const lastRow = allDaily ? allDaily.getRowIndex() + allDaily.getRowCount() : 1;
  if (lastRow > 10000) throw new Error("Workbook layout needs review");
  const formulaRanges = [daily.getRange("A1:G1"), weekly.getRange("A1:C1"), daily.getRange("H1:J" + Math.max(lastRow, 1))];
  for (const range of formulaRanges) {
    if (range.getFormulas().some(row => row.some(value => typeof value === "string" && /^\s*=/.test(value)))) throw new Error("Workbook formulas need review");
  }
  if (alreadyPrepared) return {status:"already-prepared"};
  if (extra.some(value => value !== "")) throw new Error("Source rate columns need review");
  daily.getRange("H1:J1").setValues([rates]);
  if (daily.getRange("H1:J1").getValues()[0].map(value => text(value)).join("|") !== rates.join("|")) throw new Error("Source rate headings did not save");
  return {status:"prepared"};
}
