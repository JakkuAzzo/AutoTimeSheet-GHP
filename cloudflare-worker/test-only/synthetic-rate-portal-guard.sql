-- Local build-only rate fixture. Never apply to a production or prior test DB.
CREATE TABLE synthetic_test_environment (
  marker TEXT PRIMARY KEY CHECK (marker = 'gmt-timesheet-rate-build-only')
);
INSERT INTO synthetic_test_environment (marker) VALUES ('gmt-timesheet-rate-build-only');
CREATE TABLE synthetic_test_fixture_proofs (
  actor_oid TEXT PRIMARY KEY,
  fixture_sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
