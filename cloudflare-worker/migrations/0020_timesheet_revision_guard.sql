CREATE TABLE IF NOT EXISTS timesheet_owner_revisions (owner_upn TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS timesheet_revision_insert AFTER INSERT ON records WHEN NEW.kind IN ('timesheets','clock')
BEGIN INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(NEW.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END;
CREATE TRIGGER IF NOT EXISTS timesheet_revision_update AFTER UPDATE ON records WHEN OLD.kind IN ('timesheets','clock') OR NEW.kind IN ('timesheets','clock')
BEGIN
  INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(OLD.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1;
  INSERT INTO timesheet_owner_revisions(owner_upn,revision) SELECT lower(NEW.owner_upn),1 WHERE lower(NEW.owner_upn)<>lower(OLD.owner_upn) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS timesheet_revision_delete AFTER DELETE ON records WHEN OLD.kind IN ('timesheets','clock')
BEGIN INSERT INTO timesheet_owner_revisions(owner_upn,revision) VALUES(lower(OLD.owner_upn),1) ON CONFLICT(owner_upn) DO UPDATE SET revision=revision+1; END;
