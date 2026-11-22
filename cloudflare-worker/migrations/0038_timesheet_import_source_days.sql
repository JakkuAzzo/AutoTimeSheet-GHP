-- Preserve the original employee and dates of standalone imported days, so
-- later edits cannot silently remove their review hold from a pay month.
CREATE TABLE IF NOT EXISTS timesheet_import_source_days (
  record_id TEXT NOT NULL, owner_oid TEXT NOT NULL, owner_upn TEXT NOT NULL,
  source_day TEXT NOT NULL, PRIMARY KEY(record_id,owner_oid,owner_upn,source_day)
);
WITH snapshots AS (
  SELECT r.record_id,lower(COALESCE(r.owner_oid,'')) oid,lower(COALESCE(r.owner_upn,'')) upn,
    CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END payload
  FROM records r WHERE r.kind='timesheets' AND r.action<>'pay_month_correction'
  UNION ALL
  SELECT r.record_id,lower(COALESCE(v.owner_oid,r.owner_oid,'')),lower(COALESCE(r.owner_upn,'')),
    COALESCE(json_extract(CASE WHEN json_valid(v.payload_json) THEN v.payload_json ELSE '{}' END,'$.payload'),'{}')
  FROM records r JOIN record_versions v ON v.record_id=r.record_id WHERE r.kind='timesheets' AND r.action<>'pay_month_correction'
), sourced AS (
  SELECT * FROM snapshots WHERE json_valid(payload) AND COALESCE(CAST(json_extract(payload,'$.importSourceId') AS TEXT),'')<>''
)
INSERT OR IGNORE INTO timesheet_import_source_days(record_id,owner_oid,owner_upn,source_day)
SELECT s.record_id,s.oid,s.upn,CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
FROM sourced s JOIN json_each(s.payload,'$.rows') row
UNION ALL SELECT s.record_id,s.oid,s.upn,'*' FROM sourced s WHERE NOT EXISTS(SELECT 1 FROM json_each(s.payload,'$.rows'));
INSERT OR IGNORE INTO timesheet_import_source_days(record_id,owner_oid,owner_upn,source_day)
SELECT r.record_id,lower(COALESCE(r.owner_oid,'')),lower(COALESCE(r.owner_upn,'')),'*' FROM records r
WHERE r.kind='timesheets' AND r.action<>'pay_month_correction' AND r.record_id LIKE 'document-import-%'
  AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=r.record_id);
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_insert AFTER INSERT ON records WHEN NEW.kind='timesheets' AND NEW.action<>'pay_month_correction'
BEGIN
 INSERT OR IGNORE INTO timesheet_import_source_days
 SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
 WHERE COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'';
 INSERT OR IGNORE INTO timesheet_import_source_days SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),'*'
 WHERE (NEW.record_id LIKE 'document-import-%' OR COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'')
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=NEW.record_id);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_update AFTER UPDATE ON records WHEN NEW.kind='timesheets' AND NEW.action<>'pay_month_correction'
BEGIN
 INSERT OR IGNORE INTO timesheet_import_source_days
 SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),CASE WHEN row.type='object' AND json_extract(row.value,'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',julianday(json_extract(row.value,'$.date')))=json_extract(row.value,'$.date') THEN json_extract(row.value,'$.date') ELSE '*' END
 FROM json_each(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.rows') row
 WHERE COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'';
 INSERT OR IGNORE INTO timesheet_import_source_days SELECT NEW.record_id,lower(COALESCE(NEW.owner_oid,'')),lower(COALESCE(NEW.owner_upn,'')),'*'
 WHERE (NEW.record_id LIKE 'document-import-%' OR COALESCE(CAST(json_extract(CASE WHEN json_valid(NEW.payload_json) THEN NEW.payload_json ELSE '{}' END,'$.importSourceId') AS TEXT),'')<>'')
 AND NOT EXISTS(SELECT 1 FROM timesheet_import_source_days h WHERE h.record_id=NEW.record_id);
END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_no_update BEFORE UPDATE ON timesheet_import_source_days BEGIN SELECT RAISE(ABORT,'source day hold is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_import_source_days_no_delete BEFORE DELETE ON timesheet_import_source_days BEGIN SELECT RAISE(ABORT,'source day hold is immutable'); END;
