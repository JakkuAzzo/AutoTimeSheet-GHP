-- Account and role assignments are keyed to both the verified Entra object ID
-- and UPN. The application never allows an administrator to grant the admin
-- role through this table; full admins remain controlled by Entra/Worker config.
CREATE TABLE IF NOT EXISTS portal_access_assignments (
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('hr', 'xero', 'operations', 'job-card')),
  created_by_oid TEXT NOT NULL,
  created_by_upn TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_oid, role)
);

CREATE INDEX IF NOT EXISTS idx_portal_access_assignments_identity
  ON portal_access_assignments(owner_oid, owner_upn);

CREATE TABLE IF NOT EXISTS portal_access_audit (
  audit_id TEXT PRIMARY KEY,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  target_oid TEXT NOT NULL,
  target_upn TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hr', 'xero', 'operations', 'job-card')),
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  created_at TEXT NOT NULL
);
