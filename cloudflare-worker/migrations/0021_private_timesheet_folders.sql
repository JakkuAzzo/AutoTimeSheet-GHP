CREATE TABLE IF NOT EXISTS private_timesheet_folders (
  employee_oid TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL UNIQUE,
  admin_group_oid TEXT NOT NULL,
  created_at TEXT NOT NULL
);
