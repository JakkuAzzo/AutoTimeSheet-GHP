# GMT Timesheet Audit & Reconciliation

This feature adds a browser-side audit page at `audit/index.html`.

## Purpose

The audit page lets an accounts/admin user upload a GMT timesheet archive and generate a traceable reconciliation report showing:

- each weekly employee total recalculated from source rows
- where each Basic / OT x1.5 / OT x2.0 figure came from
- comparison against the summary PDF in the archive
- optional comparison against a corrected workbook
- row-level claimed vs calculated mismatches
- extracted source text for every parsed document
- downloadable bundled audit package containing the generated report, audit data, original archive, and workbook if supplied

## GMT rules implemented

- Weekday hours count toward the weekly 40h basic threshold.
- Weekday hours above 40h are OT x1.5.
- Saturday before 13:00 is OT x1.5.
- Saturday after 13:00 is OT x2.0.
- Sunday is OT x2.0 all day.
- Hours over 50 are **not** automatically OT x2.0.
- Saturday lunch crossing 13:00 is deducted from the later segment first unless exact lunch time is supplied.

## How to use

1. Open `audit/index.html` from the deployed GitHub Pages app.
2. Upload the GMT timesheet archive zip.
3. Optionally upload a corrected totals workbook.
4. Click **Build audit**.
5. Review:
   - Weekly audit
   - Source row trace
   - Source document extracts
6. Download either:
   - the standalone interactive HTML report, or
   - the bundled audit zip package.

## Libraries used in-browser

- JSZip for archive reading/export
- Mammoth.js for `.docx` text extraction
- SheetJS for `.xlsx` workbook comparison
- PDF.js for PDF text extraction

No server-side upload is required for the audit page itself.
