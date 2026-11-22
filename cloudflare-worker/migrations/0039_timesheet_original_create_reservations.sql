-- The same bytes in the same private vault may be created at most once until
-- an operator explicitly reconciles an uncertain attempt. A different file
-- extension or a new intent cannot bypass the reservation.
CREATE TABLE IF NOT EXISTS timesheet_original_create_reservations (
  vault_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  intent_id TEXT NOT NULL REFERENCES timesheet_original_filing_intents(intent_id),
  record_id TEXT NOT NULL REFERENCES records(record_id),
  file_name TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  PRIMARY KEY(vault_id,source_sha256)
);
CREATE TRIGGER IF NOT EXISTS timesheet_original_create_reservations_no_update BEFORE UPDATE ON timesheet_original_create_reservations BEGIN SELECT RAISE(ABORT,'original create reservation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_create_reservations_no_delete BEFORE DELETE ON timesheet_original_create_reservations BEGIN SELECT RAISE(ABORT,'original create reservation is immutable'); END;
