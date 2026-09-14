-- Xero OAuth state is short-lived and single-use.
CREATE TABLE IF NOT EXISTS xero_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  owner_upn TEXT NOT NULL,
  return_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_xero_oauth_states_expiry ON xero_oauth_states(expires_at, consumed_at);

-- Refresh tokens are encrypted by the Worker before they are written.
CREATE TABLE IF NOT EXISTS xero_connections (
  tenant_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE,
  tenant_name TEXT NOT NULL,
  tenant_type TEXT NOT NULL,
  scopes TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  connected_by_oid TEXT NOT NULL,
  connected_by_upn TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_xero_connections_updated ON xero_connections(updated_at DESC);
