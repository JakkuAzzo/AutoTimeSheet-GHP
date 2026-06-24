function workbookEmployeeName() {
  return document.getElementById('employee-name')?.value?.trim() || 'Employee';
}

function workbookEmployeeEmail() {
  return document.getElementById('employee-email')?.value?.trim() || '';
}

function workbookWeekStart() {
  return document.getElementById('week-start')?.value || '';
}

function workbookWeekEnd() {
  return document.getElementById('week-end')?.value || '';
}

function workbookHours(minutes) {
  return Number(((Number(minutes || 0)) / 60).toFixed(2));
}

function workbookText(value) {
  return value == null ? '' : String(value);
}

function workbookCategory(row) {
  if (row.error) return 'Issue';
  if (row.absenceStatus === 'Holiday') return 'Holiday';
  if (row.absenceStatus === 'Sick') return 'Sick';
  if (row.absenceStatus === 'Time Off') return 'Time Off';
  if (row.dayName === 'Sunday') return 'Sunday OT x2.0';
  if (row.dayName === 'Saturday') return 'Saturday OT';
  if ((row.ot15 || 0) > 0) return 'Weekday OT x1.5';
  return 'Basic day';
}

function workbookStatus(row) {
  if (row.error) return 'Check';
  if (row.absenceStatus === 'Sick') return 'Recorded';
  return 'OK';
}

function workbookWeighted(row) {
  return workbookHours(row.basic) + workbookHours(row.ot15) * 1.5 + workbookHours(row.ot20) * 2;
}

function applySheetBasics(ws, rowCount, colCount) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rowCount - 1), c: Math.max(0, colCount - 1) } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '214D2F' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
      };
    }
  }
}

function applyAllSheetStyles(ws, rowCount, categoryColumnIndex) {
  const colours = {
    'Issue': 'F8D7DA',
    'Holiday': 'DDEEFF',
    'Sick': 'FFE5DE',
    'Time Off': 'FFF1B8',
    'Sunday OT x2.0': 'E8DDF8',
    'Saturday OT': 'F3E8FF',
    'Weekday OT x1.5': 'EAF3E7',
    'Basic day': 'FFFFFF'
  };
  for (let r = 1; r < rowCount; r++) {
    const catCell = ws[XLSX.utils.encode_cell({ r, c: categoryColumnIndex })];
    const colour = colours[catCell?.v] || 'FFFFFF';
    for (let c = 0; c <= categoryColumnIndex; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.s = {
          fill: { fgColor: { rgb: colour } },
          alignment: { vertical: 'top', wrapText: true }
        };
      }
    }
  }
}

function makeAllRows(calculated) {
  return calculated.map((row) => ({
    Status: workbookStatus(row),
    Category: workbookCategory(row),
    Employee: workbookEmployeeName(),
    'Employee email': workbookEmployeeEmail(),
    'Week start': workbookWeekStart(),
    'Week end': workbookWeekEnd(),
    Day: row.label,
    Date: row.date,
    Weekday: row.dayName,
    Start: row.start,
    Finish: row.finish,
    Lunch: row.lunchHad ? 'Yes - 1h deducted' : 'No',
    'Absence reason': row.absenceStatus || 'NA',
    Location: row.location || '',
    Description: row.description || '',
    'Worked hours': workbookHours(row.workedActual),
    'Paid hours': workbookHours(row.total),
    'Paid Basic hours': workbookHours(row.basic),
    'OT x1.5 hours': workbookHours(row.ot15),
    'OT x2.0 hours': workbookHours(row.ot20),
    'Weighted hours': Number(workbookWeighted(row).toFixed(2)),
    Note: row.note || row.error || ''
  }));
}

function makeTotalsRows(calculated, totals, weighted) {
  const byCategory = calculated.reduce((acc, row) => {
    const category = workbookCategory(row);
    if (!acc[category]) acc[category] = { days: 0, worked: 0, paid: 0, basic: 0, ot15: 0, ot20: 0, weighted: 0 };
    acc[category].days += 1;
    acc[category].worked += row.workedActual || 0;
    acc[category].paid += row.total || 0;
    acc[category].basic += row.basic || 0;
    acc[category].ot15 += row.ot15 || 0;
    acc[category].ot20 += row.ot20 || 0;
    acc[category].weighted += workbookWeighted(row);
    return acc;
  }, {});

  const rows = [
    ['GMT Weekly Timesheet Totals'],
    [],
    ['Employee', workbookEmployeeName()],
    ['Employee email', workbookEmployeeEmail()],
    ['Week start', workbookWeekStart()],
    ['Week end', workbookWeekEnd()],
    [],
    ['Metric', 'Hours / Count'],
    ['Worked hours', workbookHours(totals.workedActual)],
    ['Paid hours', workbookHours(totals.total)],
    ['Paid Basic hours', workbookHours(totals.basic)],
    ['OT x1.5 hours', workbookHours(totals.ot15)],
    ['OT x2.0 hours', workbookHours(totals.ot20)],
    ['Paid weighted hours', Number(Number(weighted || 0).toFixed(2))],
    ['Holiday days', totals.holiday || 0],
    ['Sick days', totals.sick || 0],
    ['Time Off days', totals.timeOff || 0],
    [],
    ['Totals by category'],
    ['Category', 'Days', 'Worked hours', 'Paid hours', 'Paid Basic hours', 'OT x1.5 hours', 'OT x2.0 hours', 'Weighted hours']
  ];

  Object.entries(byCategory).forEach(([category, value]) => {
    rows.push([
      category,
      value.days,
      workbookHours(value.worked),
      workbookHours(value.paid),
      workbookHours(value.basic),
      workbookHours(value.ot15),
      workbookHours(value.ot20),
      Number(value.weighted.toFixed(2))
    ]);
  });

  return rows;
}

function makeNotesRows(calculated) {
  const noteRows = calculated
    .filter((row) => row.note || row.error || row.absenceStatus !== 'NA')
    .map((row) => [
      row.label,
      row.date,
      row.dayName,
      workbookCategory(row),
      row.absenceStatus || 'NA',
      row.note || '',
      row.error || ''
    ]);

  return [
    ['GMT Timesheet Notes'],
    [],
    ['How to read this workbook'],
    ['All', 'Every day appears here. Use the filter arrows to filter by Status, Category, date, weekday, or absence reason.'],
    ['Totals', 'Payroll-friendly summary and category totals.'],
    ['Notes', 'Absence notes, sick-day notes, time-off warnings, and validation messages.'],
    [],
    ['Colour key'],
    ['Blue', 'Holiday'],
    ['Red / peach', 'Sick'],
    ['Yellow', 'Time Off'],
    ['Purple', 'Weekend overtime'],
    ['Green', 'Weekday overtime'],
    [],
    ['Day', 'Date', 'Weekday', 'Category', 'Absence reason', 'Note', 'Issue'],
    ...noteRows
  ];
}

function buildWorkbook(calculated, totals, weighted) {
  if (!window.XLSX) throw new Error('Excel generator is still loading. Please try again.');

  const allRows = makeAllRows(calculated);
  const totalsRows = makeTotalsRows(calculated, totals, weighted);
  const notesRows = makeNotesRows(calculated);

  const wb = XLSX.utils.book_new();
  const allSheet = XLSX.utils.json_to_sheet(allRows);
  const totalsSheet = XLSX.utils.aoa_to_sheet(totalsRows);
  const notesSheet = XLSX.utils.aoa_to_sheet(notesRows);

  allSheet['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 },
    { wch: 16 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 42 }
  ];
  totalsSheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  notesSheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 48 }, { wch: 48 }];

  applySheetBasics(allSheet, allRows.length + 1, Object.keys(allRows[0] || {}).length);
  applyAllSheetStyles(allSheet, allRows.length + 1, 1);

  if (totalsSheet['A1']) totalsSheet['A1'].s = { font: { bold: true, sz: 16, color: { rgb: '214D2F' } } };
  if (notesSheet['A1']) notesSheet['A1'].s = { font: { bold: true, sz: 16, color: { rgb: '214D2F' } } };

  XLSX.utils.book_append_sheet(wb, allSheet, 'All');
  XLSX.utils.book_append_sheet(wb, totalsSheet, 'Totals');
  XLSX.utils.book_append_sheet(wb, notesSheet, 'Notes');

  const array = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new File([array], `GMT Timesheet - ${workbookEmployeeName()} - ${workbookWeekStart() || 'week'}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

function buildCsvFile(calculated, totals, weighted) {
  const allRows = makeAllRows(calculated);
  const header = Object.keys(allRows[0] || {});
  const rows = allRows.map((row) => header.map((key) => row[key]));
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  return new File([csv], `GMT Timesheet - ${workbookEmployeeName()} - ${workbookWeekStart() || 'week'}.csv`, { type: 'text/csv' });
}
