CREATE TABLE IF NOT EXISTS document_import_files (
  record_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sharepoint_item_id TEXT NOT NULL,
  sharepoint_path TEXT NOT NULL,
  sharing_url TEXT NOT NULL,
  filed_at TEXT NOT NULL
);
