-- For a newly created, verified isolated test database only. Do not apply to
-- production or to the earlier synthetic database holding prior evidence.
CREATE TABLE synthetic_test_environment (
  marker TEXT PRIMARY KEY CHECK (marker = 'gmt-timesheet-portal-e2e-20261116')
);
INSERT INTO synthetic_test_environment (marker) VALUES ('gmt-timesheet-portal-e2e-20261116');
CREATE TABLE synthetic_test_fixture_proofs (
  actor_oid TEXT PRIMARY KEY,
  fixture_sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
