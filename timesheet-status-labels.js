function workbookStatus(row) {
  if (row && row.error) return 'Check';
  if (row && (row.absenceStatus === 'Sick' || row.absenceStatus === 'Holiday')) return 'Absent';
  return 'Recorded';
}
