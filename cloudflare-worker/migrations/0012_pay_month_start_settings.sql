CREATE TABLE IF NOT EXISTS pay_month_start_settings (
  month_key TEXT PRIMARY KEY,
  start_date TEXT NOT NULL UNIQUE,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(month_key) = 7 AND substr(month_key, 5, 1) = '-'),
  CHECK (length(start_date) = 10 AND substr(start_date, 5, 1) = '-' AND substr(start_date, 8, 1) = '-')
);

CREATE TABLE IF NOT EXISTS pay_month_start_audit (
  audit_id TEXT PRIMARY KEY,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  month_key TEXT NOT NULL,
  old_start_date TEXT NOT NULL,
  new_start_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_month_start_audit_month_created
  ON pay_month_start_audit(month_key, created_at DESC);
