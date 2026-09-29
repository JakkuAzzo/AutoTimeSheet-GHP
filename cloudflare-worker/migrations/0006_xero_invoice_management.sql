-- Local links connect existing GMT records to Xero invoices without making
-- either system a shadow copy of the other. Audit records contain identifiers
-- and state transitions only; invoice payloads remain in Xero.
CREATE TABLE IF NOT EXISTS xero_invoice_links (
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('estimates', 'job-cards')),
  linked_by_upn TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, invoice_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_invoice_links_record
  ON xero_invoice_links(record_id, linked_at DESC);

CREATE TABLE IF NOT EXISTS xero_invoice_audit (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_status TEXT NOT NULL DEFAULT '',
  after_status TEXT NOT NULL DEFAULT '',
  actor_upn TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_xero_invoice_audit_invoice
  ON xero_invoice_audit(tenant_id, invoice_id, occurred_at DESC);
