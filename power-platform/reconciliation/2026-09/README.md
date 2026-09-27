# GMT historical timesheet reconciliation

Generated 2026-09-16 from the supplied Accounts mailbox bundle copies. `source-manifest.json` retains every bundle attachment hash and parser outcome; `records.json` contains the reconciled records loaded into the protected D1 history store. `seed.sql` is idempotent and is applied only to the GMT portal D1 database.

Selection rules:

- CSV/structured JSON rows are accepted; security placeholder XLSX attachments are retained as `ignored-placeholder` and never treated as payroll data.
- Exact duplicate payloads are grouped in the source manifest.
- Every materially different version is retained as a source variant.
- Calendar and totals use the richest valid daily version; invalid intervals remain viewable for audit and are excluded from totals.
- This historical seed aligned some dates to the declared week. Each original Date column value was retained as `sourceDate`; current portal projections restore that value and preserve the old week-aligned date for audit. Do not use the declared week to invent or move a work date in a new reconciliation.
- No values are fabricated for a header-only or missing source row.
