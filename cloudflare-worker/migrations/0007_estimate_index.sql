CREATE TABLE IF NOT EXISTS estimate_index (
  canonical_id TEXT PRIMARY KEY,
  estimate_number TEXT NOT NULL DEFAULT '',
  number_aliases_json TEXT NOT NULL DEFAULT '[]',
  client TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  estimate_date TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('email', 'app')),
  outlook_message_id TEXT UNIQUE,
  outlook_url TEXT NOT NULL DEFAULT '',
  sharepoint_url TEXT NOT NULL DEFAULT '',
  attachment_url TEXT NOT NULL DEFAULT '',
  correlation_status TEXT NOT NULL DEFAULT 'unmatched',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_estimate_index_number ON estimate_index(estimate_number);
CREATE INDEX IF NOT EXISTS idx_estimate_index_client ON estimate_index(client, estimate_date);
CREATE INDEX IF NOT EXISTS idx_estimate_index_updated ON estimate_index(updated_at DESC);
