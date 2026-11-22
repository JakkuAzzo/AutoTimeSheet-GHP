CREATE TABLE IF NOT EXISTS timesheet_delivery_routes (
  record_id TEXT NOT NULL,
  flow_run_id TEXT NOT NULL,
  run_started_at TEXT NOT NULL,
  generation TEXT NOT NULL,
  employee_folder_id TEXT NOT NULL,
  month_folder_id TEXT NOT NULL,
  workbook_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,flow_run_id),
  UNIQUE(record_id,generation),
  FOREIGN KEY(record_id) REFERENCES records(record_id)
);
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_routes_no_update BEFORE UPDATE ON timesheet_delivery_routes
BEGIN SELECT RAISE(ABORT, 'timesheet delivery routes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_delivery_routes_no_delete BEFORE DELETE ON timesheet_delivery_routes
BEGIN SELECT RAISE(ABORT, 'timesheet delivery routes are append-only'); END;
