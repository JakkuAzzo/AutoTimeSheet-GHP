# GMT Timesheet Audit Mobile UX And Fixture Validation

Date: 2026-06-27

## What changed

- Reworked the audit results page into a mobile-first flow:
  - compact source upload panel that collapses after parsing
  - top audit status banner
  - Action required admin correction cards before long detail views
  - Summary, Issues, Rows, Files, and Exports tabs
  - mobile row-check cards with raw data collapsed by default
  - desktop table view retained for combined totals and source row checks
- Moved Excel/JSON downloads into the Exports section.
- Kept Submit corrected audit to accounts in the Exports flow with FormSubmit hidden form creation only at submit time.
- Removed hardcoded employee-name inference from audit parsing logic. Employee names now come from document text first, then a generic filename cleanup fallback.
- Removed the browser-side hardcoded audit pay-rate map. Pay estimates only use optional configured `window.GMT_APP_CONFIG.auditPayRates`.
- Expanded audit JSON export metadata:
  - parser version
  - policy version
  - calculation policy
  - generated timestamp
  - row count
  - totals
  - source files
  - source hashes
  - warnings
  - parse errors
  - whether corrections were manually submitted

## Screenshot Artifacts

Synthetic fixture data was used for committed screenshots so no private source ZIP contents are committed.

- `docs/reports/artifacts/audit-mobile-ux/mobile-upload-state.png`
- `docs/reports/artifacts/audit-mobile-ux/mobile-parsed-summary.png`
- `docs/reports/artifacts/audit-mobile-ux/mobile-admin-corrections.png`
- `docs/reports/artifacts/audit-mobile-ux/mobile-row-check-cards.png`
- `docs/reports/artifacts/audit-mobile-ux/mobile-exports-section.png`
- `docs/reports/artifacts/audit-mobile-ux/desktop-parsed-summary.png`
- `docs/reports/artifacts/audit-mobile-ux/desktop-row-check-table.png`

## Fixture Matrix Tested

The generated fixture matrix creates temporary ZIP files during the test run. Fixture ZIPs are not committed.

| Fixture | Expected result |
| --- | --- |
| Jason attached baseline, via `AUDIT_ZIP_PATH` | 20 rows, 4 combined lines, 3 issues, 0 parse errors |
| `.docx` only clean week | 5 rows, 40h actual, 40h basic, 0 issues |
| `.docm` only clean week | 5 rows, 40h actual, 40h basic, 0 issues |
| mixed `.docx` + `.docm` | 10 rows, 2 combined lines, 80h basic |
| multiple employees | 10 rows, 2 employees, 2 combined lines |
| clean week no warnings | 5 rows, 0 issues |
| weekday OT x1.5 | 9h30m actual, 8h basic, 1h30m OT x1.5 |
| Saturday before/after 13:00 | 5h actual, 3h OT x1.5, 2h OT x2.0 |
| Sunday OT x2.0 | 4h actual, 4h OT x2.0 |
| overnight typo | 22h30m actual, overnight warning, 1 issue |
| unsupported file included | valid rows still parse, unsupported file yields 1 parse error |
| duplicate week/file scenario | 10 rows, 1 combined line, no crash |

## Validation Results

Commands run:

```sh
npm run test:audit:fixtures
AUDIT_ZIP_PATH="/tmp/codex-remote-attachments/019f039e-fc5f-76c1-8bd0-c3139147a1ea/A4885FD6-2643-4FF6-82CF-0326555F8A4C/1-Jason-June-26-Time-Sheets.zip" npm run test:audit:jason-zip
AUDIT_ZIP_PATH="/tmp/codex-remote-attachments/019f039e-fc5f-76c1-8bd0-c3139147a1ea/A4885FD6-2643-4FF6-82CF-0326555F8A4C/1-Jason-June-26-Time-Sheets.zip" npm run test:audit:fixtures
```

Pass summary:

- Generated fixture matrix: passed.
- Jason ZIP regression: passed.
- Fixture matrix with Jason baseline included: passed.
- Inline audit script syntax check: passed.
- Mobile 390px fixture checks: passed with no normal-flow horizontal page overflow.

## Hardcoded Assumption Check

Searches were run for Jason-specific names, known filenames, and release hashes. Production audit logic no longer contains Jason-specific name matching or known-file assumptions. Jason references remain only in regression tests and documentation for the private attached fixture.

The app still computes generic duplicate-source warnings using file hashes, but no exact fixture hash is hardcoded.

## Remaining Known Limitations

- Real iPhone Safari upload and FormSubmit delivery remain manual release gates.
- The parser still reads Word OpenXML tables from `word/document.xml`; binary legacy `.doc` remains unsupported and should be converted to `.docx` or `.docm`.
- Duplicate week/file scenarios are grouped into one combined employee-week line. The current test verifies this does not crash or silently corrupt totals, but no business rule has been added to reject duplicates automatically.
