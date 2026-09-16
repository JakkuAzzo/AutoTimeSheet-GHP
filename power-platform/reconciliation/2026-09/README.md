# GMT historical timesheet reconciliation

Generated 2026-09-16 from the supplied Accounts mailbox bundle copies. `source-manifest.json` retains every bundle attachment hash and parser outcome; `records.json` contains the reconciled records loaded into the protected D1 history store. `seed.sql` is idempotent and is applied only to the GMT portal D1 database.

Selection rules:

- CSV/structured JSON rows are accepted; security placeholder XLSX attachments are retained as `ignored-placeholder` and never treated as payroll data.
- Exact duplicate payloads are grouped in the source manifest.
- Every materially different version is retained as a source variant.
- Calendar and totals use the richest valid daily version; invalid intervals remain viewable for audit and are excluded from totals.
- Dates are aligned to the declared week when row order and weekday evidence support the correction; each original date is retained as `sourceDate`.
- No values are fabricated for a header-only or missing source row.
