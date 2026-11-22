-- Exclude known old-writer destinations and sealed candidates in both
-- directions. This does not revoke a previously issued ID or prevent a
-- separately authorised provider client from writing to a candidate.
CREATE INDEX IF NOT EXISTS idx_timesheet_publication_candidates_item ON timesheet_publication_candidates(item_id);
CREATE TRIGGER IF NOT EXISTS timesheet_candidate_excludes_old_writer BEFORE INSERT ON timesheet_publication_candidates
WHEN EXISTS(SELECT 1 FROM timesheet_delivery_routes WHERE workbook_id=NEW.item_id)
  OR EXISTS(SELECT 1 FROM private_timesheet_workbooks WHERE workbook_id=NEW.item_id)
BEGIN SELECT RAISE(ABORT,'publication candidate belongs to old writer'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_route_excludes_candidate BEFORE INSERT ON timesheet_delivery_routes
WHEN EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot route publication candidate'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_workbook_excludes_candidate_insert BEFORE INSERT ON private_timesheet_workbooks
WHEN NEW.workbook_id IS NOT NULL AND EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot register publication candidate'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_old_workbook_excludes_candidate_update BEFORE UPDATE OF workbook_id ON private_timesheet_workbooks
WHEN NEW.workbook_id IS NOT NULL AND EXISTS(SELECT 1 FROM timesheet_publication_candidates WHERE item_id=NEW.workbook_id)
BEGIN SELECT RAISE(ABORT,'old writer cannot register publication candidate'); END;
