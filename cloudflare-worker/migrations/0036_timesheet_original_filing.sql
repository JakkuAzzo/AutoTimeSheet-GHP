-- Pending filing evidence only. This does not authorise employee access,
-- validate document contents, or establish independent source review.
CREATE TABLE IF NOT EXISTS timesheet_original_filing_intents (
  intent_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(record_id),
  employee_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  owner_revision INTEGER NOT NULL CHECK(owner_revision>=0),
  dates_json TEXT NOT NULL CHECK(json_valid(dates_json) AND json_type(dates_json)='array' AND json_array_length(dates_json) BETWEEN 1 AND 62),
  actor_oid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_original_filing_revocations (
  intent_id TEXT PRIMARY KEY REFERENCES timesheet_original_filing_intents(intent_id),
  actor_oid TEXT NOT NULL,
  revoked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timesheet_private_originals (
  intent_id TEXT PRIMARY KEY REFERENCES timesheet_original_filing_intents(intent_id),
  record_id TEXT NOT NULL REFERENCES records(record_id),
  employee_oid TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_etag TEXT NOT NULL,
  file_name TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK(review_state='pending'),
  filed_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS timesheet_original_intent_no_update BEFORE UPDATE ON timesheet_original_filing_intents BEGIN SELECT RAISE(ABORT,'filing intent is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_intent_no_delete BEFORE DELETE ON timesheet_original_filing_intents BEGIN SELECT RAISE(ABORT,'filing intent is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_revocation_no_update BEFORE UPDATE ON timesheet_original_filing_revocations BEGIN SELECT RAISE(ABORT,'filing revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_revocation_no_delete BEFORE DELETE ON timesheet_original_filing_revocations BEGIN SELECT RAISE(ABORT,'filing revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_proof_no_update BEFORE UPDATE ON timesheet_private_originals BEGIN SELECT RAISE(ABORT,'private original proof is immutable'); END;
CREATE TRIGGER IF NOT EXISTS timesheet_original_proof_no_delete BEFORE DELETE ON timesheet_private_originals BEGIN SELECT RAISE(ABORT,'private original proof is immutable'); END;
