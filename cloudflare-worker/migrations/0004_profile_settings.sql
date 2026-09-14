-- GMT app account settings are stored per verified Microsoft Entra object ID
-- so a display name and optional copy address follow the account across devices.
CREATE TABLE IF NOT EXISTS profile_settings (
  owner_oid TEXT PRIMARY KEY,
  owner_upn TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  notification_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_settings_upn ON profile_settings(owner_upn);
