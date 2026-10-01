CREATE TABLE IF NOT EXISTS estimate_mail_sources (
  canonical_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  outlook_message_id TEXT NOT NULL,
  internet_message_id TEXT NOT NULL DEFAULT '',
  outlook_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mailbox, outlook_message_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_mail_sources_canonical
  ON estimate_mail_sources(canonical_id);

CREATE INDEX IF NOT EXISTS idx_estimate_mail_sources_internet_id
  ON estimate_mail_sources(internet_message_id);
