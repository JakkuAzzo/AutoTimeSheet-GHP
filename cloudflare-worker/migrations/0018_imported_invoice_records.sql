-- Reviewed invoice documents are an archive, not Xero invoices.
CREATE TABLE IF NOT EXISTS imported_invoice_records (
  record_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_key TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  total REAL NOT NULL,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  imported_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, invoice_key)
);
CREATE INDEX IF NOT EXISTS idx_imported_invoice_created ON imported_invoice_records(created_at DESC);
