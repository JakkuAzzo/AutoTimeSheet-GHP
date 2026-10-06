PRAGMA foreign_keys = ON;

-- Original scans stay in SharePoint; D1 stores a private pointer and a
-- searchable, page-level record with OCR candidates kept separate from
-- Accounts-confirmed values.
CREATE TABLE IF NOT EXISTS job_card_import_batches (
  batch_id TEXT PRIMARY KEY,
  source_count INTEGER NOT NULL CHECK (source_count > 0),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'source-complete', 'pages-complete')),
  created_by_oid TEXT NOT NULL,
  created_by_upn TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_card_source_files (
  batch_id TEXT NOT NULL REFERENCES job_card_import_batches(batch_id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  quick_xor_hash TEXT NOT NULL,
  sharepoint_item_id TEXT NOT NULL,
  sharepoint_path TEXT NOT NULL,
  uploaded_by_oid TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id, source_file),
  UNIQUE (sharepoint_item_id)
);

CREATE INDEX IF NOT EXISTS idx_job_card_source_files_hash
  ON job_card_source_files(sha256);

-- Only safe metadata is retained for an upload session. The preauthenticated
-- Graph uploadUrl is returned once to Accounts and is never persisted.
CREATE TABLE IF NOT EXISTS job_card_upload_sessions (
  session_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('source-batch', 'job-card-page')),
  batch_id TEXT NOT NULL REFERENCES job_card_import_batches(batch_id) ON DELETE CASCADE,
  record_id TEXT,
  source_file TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  expected_sha256 TEXT CHECK (expected_sha256 IS NULL OR length(expected_sha256) = 64),
  expected_quick_xor_hash TEXT,
  expected_path TEXT,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  manifest_entry_json TEXT CHECK (manifest_entry_json IS NULL OR json_valid(manifest_entry_json)),
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'complete', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_card_upload_sessions_expiry
  ON job_card_upload_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_job_card_upload_sessions_record
  ON job_card_upload_sessions(record_id, status);

CREATE TABLE IF NOT EXISTS job_card_archive (
  record_id TEXT PRIMARY KEY REFERENCES records(record_id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES job_card_import_batches(batch_id),
  source_file TEXT NOT NULL,
  source_page INTEGER NOT NULL CHECK (source_page > 0),
  card_type TEXT NOT NULL CHECK (card_type IN ('EC', 'MTA')),
  sharepoint_item_id TEXT NOT NULL,
  sharepoint_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  quick_xor_hash TEXT NOT NULL,
  ocr_text TEXT NOT NULL DEFAULT '',
  mean_ocr_confidence REAL CHECK (mean_ocr_confidence IS NULL OR (mean_ocr_confidence >= 0 AND mean_ocr_confidence <= 100)),
  candidates_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(candidates_json)),
  confirmed_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(confirmed_json)),
  review_state TEXT NOT NULL DEFAULT 'needs-review'
    CHECK (review_state IN ('ready', 'needs-review', 'confirmed')),
  review_note TEXT NOT NULL DEFAULT '',
  imported_by_oid TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by_oid TEXT,
  reviewed_by_upn TEXT,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id, source_file, source_page)
);

CREATE INDEX IF NOT EXISTS idx_job_card_archive_batch_source
  ON job_card_archive(batch_id, source_file, source_page);
CREATE INDEX IF NOT EXISTS idx_job_card_archive_type_review
  ON job_card_archive(card_type, review_state, record_id);
CREATE INDEX IF NOT EXISTS idx_job_card_archive_content_hash
  ON job_card_archive(content_sha256);

CREATE TABLE IF NOT EXISTS job_card_archive_review_audit (
  audit_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES job_card_archive(record_id) ON DELETE CASCADE,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'correct', 'reopen')),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_card_review_audit_record
  ON job_card_archive_review_audit(record_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS job_card_archive_fts USING fts5(
  record_id UNINDEXED,
  card_type,
  source_file,
  ocr_text,
  candidate_text,
  confirmed_text,
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS job_card_archive_fts_insert AFTER INSERT ON job_card_archive BEGIN
  INSERT INTO job_card_archive_fts(rowid, record_id, card_type, source_file, ocr_text, candidate_text, confirmed_text)
  VALUES (new.rowid, new.record_id, new.card_type, new.source_file, new.ocr_text, new.candidates_json, new.confirmed_json);
END;

CREATE TRIGGER IF NOT EXISTS job_card_archive_fts_update AFTER UPDATE ON job_card_archive BEGIN
  DELETE FROM job_card_archive_fts WHERE rowid = old.rowid;
  INSERT INTO job_card_archive_fts(rowid, record_id, card_type, source_file, ocr_text, candidate_text, confirmed_text)
  VALUES (new.rowid, new.record_id, new.card_type, new.source_file, new.ocr_text, new.candidates_json, new.confirmed_json);
END;

CREATE TRIGGER IF NOT EXISTS job_card_archive_fts_delete AFTER DELETE ON job_card_archive BEGIN
  DELETE FROM job_card_archive_fts WHERE rowid = old.rowid;
END;
