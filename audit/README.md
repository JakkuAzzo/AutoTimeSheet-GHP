# GMT Timesheet Audit & Reconciliation

This feature adds a browser-side audit page at `audit/index.html`.

## Purpose

The audit page lets an accounts/admin user upload a GMT timesheet archive and generate a traceable reconciliation report showing:

- each weekly employee total recalculated from source rows
- where each Basic / OT x1.5 / OT x2.0 figure came from
- row-level claimed vs calculated mismatches
- extracted source text for every parsed document
- file-level parse status separate from audit mismatch warnings
- row categories for worked rows, bank holidays, ignored empty weekends, month markers, total rows, and footer rows
- downloadable combined audit workbook and JSON

## GMT rules implemented

- Weekdays pay up to 8h basic per day.
- Weekday hours above 8h per day are OT x1.5.
- Saturday before 13:00 is OT x1.5.
- Saturday after 13:00 is OT x2.0.
- Sunday is OT x2.0 all day.
- Hours over 50 are **not** automatically OT x2.0.
- Saturday lunch crossing 13:00 is deducted from the later segment first unless exact lunch time is supplied.
- Holiday rows are paid as 8h basic if recorded.
- Suspicious overnight spans are flagged for review, not silently corrected.

## Word document handling

- `.docx` and `.docm` files are treated as read-only Word OpenXML packages.
- The parser reads only `word/document.xml` table content.
- Macro parts in `.docm` files are not inspected or executed.
- Legacy binary `.doc` files should be converted to `.docx` or `.docm` before automatic checking.

## How to use

1. Open `audit/index.html` from the deployed GitHub Pages app.
2. Upload the GMT timesheet archive zip.
3. Click **Calculate and check sources**.
4. Review:
   - parsed row count and parse error count
   - audit warnings for source/calculation mismatches
   - combined totals
   - source row checks
   - parsed file details and ignored row categories
5. Download either:
   - the combined Excel audit workbook
   - the audit JSON

## Libraries used in-browser

- JSZip for archive reading/export
- Mammoth.js remains available for Word text fallback
- SheetJS for `.xlsx` workbook comparison
- PDF.js for PDF text extraction

No server-side upload is required for the audit page itself.

## Regression test

The Jason June 26 ZIP contains employee data and should not be committed to the repo. Run the regression test against a local copy:

```bash
AUDIT_ZIP_PATH="/path/to/Jason June 26 Time Sheets.zip" npm run test:audit:jason-zip
```

Expected assertions include 4 Word files parsed, 2 `.docx`, 2 `.docm`, 20 source rows, 4 combined total lines, 0 file-level parse errors, 3 audit mismatches, 1 suspicious overnight warning, and exported sheets `Combined Totals`, `Source Row Checks`, and `Sources`.
