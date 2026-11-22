-- A correction that ever contained uploaded source evidence remains held
-- until a future independent review and release mechanism exists.
CREATE TABLE IF NOT EXISTS timesheet_import_source_holds (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id),
  first_seen_at TEXT NOT NULL
);
INSERT OR IGNORE INTO timesheet_import_source_holds(record_id,first_seen_at)
SELECT r.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM records r
WHERE r.kind='timesheets' AND r.action='pay_month_correction' AND (
  EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END,'$.rows') row
    WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
  OR EXISTS(SELECT 1 FROM record_versions v, json_each(CASE WHEN json_valid(v.payload_json) THEN v.payload_json ELSE '{}' END,'$.payload.rows') row
    WHERE v.record_id=r.record_id AND row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
);
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_insert AFTER INSERT ON records
WHEN NEW.kind='timesheets' AND NEW.action='pay_month_correction' AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
  WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
BEGIN INSERT OR IGNORE INTO timesheet_import_source_holds VALUES(NEW.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_update AFTER UPDATE ON records
WHEN NEW.kind='timesheets' AND NEW.action='pay_month_correction' AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
  WHERE row.type='object' AND COALESCE(CAST(json_extract(row.value,'$.sourceEvidence.sourceId') AS TEXT),'')<>'')
BEGIN INSERT OR IGNORE INTO timesheet_import_source_holds VALUES(NEW.record_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_no_update BEFORE UPDATE ON timesheet_import_source_holds BEGIN SELECT RAISE(ABORT,'source hold is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_hold_no_delete BEFORE DELETE ON timesheet_import_source_holds BEGIN SELECT RAISE(ABORT,'source hold is immutable'); END;
