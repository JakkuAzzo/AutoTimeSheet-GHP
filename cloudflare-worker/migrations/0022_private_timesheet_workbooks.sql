CREATE TABLE IF NOT EXISTS private_timesheet_workbooks (
  employee_oid TEXT NOT NULL,
  pay_month TEXT NOT NULL,
  employee_folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','ready')),
  month_folder_id TEXT,
  workbook_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(employee_oid,pay_month),
  CHECK ((state='reserved' AND month_folder_id IS NULL AND workbook_id IS NULL)
      OR (state='ready' AND month_folder_id IS NOT NULL AND workbook_id IS NOT NULL))
);
