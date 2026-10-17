-- A refresh token can authorize several Xero tenants. Serialize its one-time
-- rotation across concurrent Worker requests; the hash is not a usable token.
CREATE TABLE IF NOT EXISTS xero_refresh_locks (
  token_hash TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL
);
