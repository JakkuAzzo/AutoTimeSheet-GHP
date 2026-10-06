PRAGMA foreign_keys = ON;

-- Searchable message metadata lives in D1. The original message (.eml), full
-- conversation exports and attachment bytes remain in the restricted
-- SharePoint archive; these opaque item IDs are used for server-side fetches.
CREATE TABLE IF NOT EXISTS archive_messages (
  id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('email', 'app')),
  classification_state TEXT NOT NULL DEFAULT 'candidate'
    CHECK (classification_state IN ('candidate', 'confirmed', 'needs-review', 'excluded')),
  message_direction TEXT NOT NULL DEFAULT ''
    CHECK (message_direction IN ('', 'inbound', 'outbound')),
  mailbox TEXT NOT NULL DEFAULT '',
  source_message_id TEXT NOT NULL DEFAULT '',
  internet_message_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  recipient_emails TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recipient_emails)),
  normalized_sender_email TEXT NOT NULL DEFAULT '',
  normalized_recipient_emails TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  customer_display TEXT NOT NULL DEFAULT '',
  normalized_customer TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  estimate_number TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT NOT NULL DEFAULT '',
  sharepoint_eml_item_id TEXT NOT NULL DEFAULT '',
  sharepoint_manifest_item_id TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL CHECK (length(trim(provenance_json)) > 0 AND json_valid(provenance_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_kind <> 'email' OR length(trim(mailbox)) > 0),
  CHECK (source_kind <> 'email' OR length(trim(source_message_id)) > 0)
);

-- Internet Message-ID deduplicates the same message copied into approved
-- mailboxes. Empty IDs use the mailbox-local provider ID for idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_messages_internet_identity
  ON archive_messages(internet_message_id) WHERE internet_message_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_messages_source_identity
  ON archive_messages(mailbox, source_message_id)
  WHERE source_kind = 'email' AND source_message_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_messages_app_identity
  ON archive_messages(source_message_id)
  WHERE source_kind = 'app' AND source_message_id <> '';

CREATE INDEX IF NOT EXISTS idx_archive_messages_estimate_number
  ON archive_messages(estimate_number);
CREATE INDEX IF NOT EXISTS idx_archive_messages_customer
  ON archive_messages(normalized_customer);
CREATE INDEX IF NOT EXISTS idx_archive_messages_sender
  ON archive_messages(normalized_sender_email);
CREATE INDEX IF NOT EXISTS idx_archive_messages_customer_email
  ON archive_messages(customer_email);
CREATE INDEX IF NOT EXISTS idx_archive_messages_recipient_emails
  ON archive_messages(normalized_recipient_emails);
CREATE INDEX IF NOT EXISTS idx_archive_messages_reference
  ON archive_messages(reference);
CREATE INDEX IF NOT EXISTS idx_archive_messages_sent_at
  ON archive_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_archive_messages_received_at
  ON archive_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_archive_messages_classification
  ON archive_messages(classification_state, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_messages_conversation
  ON archive_messages(conversation_id, sent_at, received_at);
CREATE INDEX IF NOT EXISTS idx_archive_messages_subject
  ON archive_messages(subject);

CREATE TABLE IF NOT EXISTS archive_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES archive_messages(id) ON DELETE CASCADE,
  source_attachment_id TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL DEFAULT '',
  sharepoint_item_id TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL CHECK (length(trim(provenance_json)) > 0 AND json_valid(provenance_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, source_attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_archive_attachments_message
  ON archive_attachments(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_archive_attachments_sha256
  ON archive_attachments(sha256);

CREATE TABLE IF NOT EXISTS archive_associations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES archive_messages(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('estimate', 'job-card', 'invoice')),
  target_id TEXT NOT NULL,
  target_reference TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT 'related',
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  state TEXT NOT NULL DEFAULT 'candidate'
    CHECK (state IN ('candidate', 'confirmed', 'needs-review', 'rejected')),
  provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('exact-reference', 'conversation-id', 'shared-customer-date', 'manual-review', 'app-link')),
  evidence_json TEXT NOT NULL CHECK (length(trim(evidence_json)) > 0 AND json_valid(evidence_json)),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, target_kind, target_id, relationship)
);
CREATE INDEX IF NOT EXISTS idx_archive_associations_target
  ON archive_associations(target_kind, target_reference, target_id);
CREATE INDEX IF NOT EXISTS idx_archive_associations_message
  ON archive_associations(message_id, state);
