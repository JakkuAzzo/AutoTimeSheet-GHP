# GMT Timesheet Entry and Scanned Job Card Archive

## Status

Design approved by the user on 2026-10-06. Timesheet implementation and visual checks are underway on an isolated branch; no SharePoint files or provider configuration have been changed for this request.

## User goals

1. Make the staff portal timesheet entry section legible on desktop and usable on mobile without horizontal scrolling within each daily row.
2. Ingest this year's scanned EC and MTA job cards into SharePoint so the staff web app can search records and link cards to invoices.
3. Incorporate the verified changes into **GMT Pay Month Reconciliation & Portal Completion** before that task pushes, merges, or deploys.

## Evidence and current implementation

- Timesheet entry is rendered from `timesheets/create.html` and `script.js`; its existing input and payload contract includes dates, start/finish, break, absence, and calculated rows.
- `styles.css` gives `.timesheet-grid` horizontal scrolling and sets the heading and day container to a `57.5rem` minimum width. This forces narrow viewports to scroll across a wide grid.
- The request supplied 13 A4 PDF bundles containing 559 pages and 1,070,024,383 bytes in total. The sample EC and MTA pages are image scans with handwritten values and different form layouts. They require OCR; recognized identifiers and business fields must remain correctable.
- Job card history and invoice-link UI already exist in `jobs/index.html` and `portal.js`. The portal API exposes invoice-link and record-to-invoice calls. The ongoing reconciliation task is implementing a protected SharePoint archive and has uncommitted changes in its worktree, so this work must integrate with that implementation rather than overwrite it.

## Design

### Responsive timesheet entry

- Retain the existing timesheet calculation, validation, draft, absence, and submission behavior.
- Replace the wide, horizontally scrolling day grid with responsive daily-entry cards using the same form fields and `data-field` selectors.
- On desktop, show one compact, clearly labeled day row with adequate widths for date, start, finish, break, status, and actions. Allow the description and calculated result to use a second full-width line where necessary.
- On mobile, render each day as a vertically flowing card. Put the date/day and remove or collapse action in its heading, then lay out start, finish, break, and status controls in a readable two-column arrangement that becomes one column only at the narrowest viewport. Use natural page scrolling; do not add an independently scrolling region to each row.
- Preserve keyboard access, explicit input labels, visible focus, and touch targets of at least 40 CSS pixels. Summary totals remain visible after the list.

### Job card ingestion and search

- Preserve all 13 input PDFs unchanged in a SharePoint source-batch location.
- Create a page-level record for each scanned card page and a single-page PDF derivative for direct preview and invoice linkage. Keep source file name and page number on every derivative/index record. Reconcile actual page/card counts during ingestion; do not assume a filename range or OCR value is correct.
- Give each page record a stable ID derived from the source batch identity and page identity, with a content hash for integrity and idempotent reruns. Reimporting an unchanged source must update/reuse existing records instead of creating duplicates.
- Extract searchable OCR text and candidate fields: card type, card number, date, customer, order number, job/site address, engineer, report/description, and amount where present. Store OCR candidates and confidence separately from confirmed/corrected values. Uncertain fields remain marked for Accounts review; raw OCR text remains searchable even when structured fields are uncertain.
- Store PDFs in SharePoint and expose protected search/record/content operations through the existing Worker and portal API boundary. Reuse the protected archive/index components being completed by the reconciliation task where their contracts fit. Keep SharePoint as the document store and the protected database index as the query and relationship layer; every index record points back to its SharePoint document.
- Add a protected job-card archive search and detail view to the existing Job Cards history. Search supports card number, customer, date range, order number, engineer, and OCR text. Detail view opens the one-page PDF, shows provenance/review status, and retains existing account controls. Only authorized Accounts identities can confirm or correct OCR fields; corrections record actor and timestamp.

### Invoice relationships

- Use stable job-card record IDs with the existing record-to-invoice relationship API, not invoice number strings as record identity.
- Preserve one-to-many relationships: one scanned job card may be linked to more than one Xero invoice, and links remain attached if an invoice number changes.
- Show linked invoices in the job-card detail view and retain the existing authenticated Accounts controls.

## Data handling and access

- Keep all source PDFs unchanged and preserve source batch, page number, hash, SharePoint item identity, OCR text, extraction confidence, confirmed metadata, review state, and timestamps.
- Make ingestion and indexing idempotent and fail closed when the protected SharePoint/API configuration is unavailable. Do not expose SharePoint credentials, private download URLs, or unfiltered job-card data to public routes.
- Do not change SharePoint permissions or create/rotate provider secrets as part of the implementation. Use only the already configured authorized application identity and report any missing permission or configuration as a blocker.
- Keep originals and derivatives in GMT's private SharePoint site. The exact library/folder and existing archive API contract will be confirmed from the reconciliation task's reviewed changes before implementation.

## Verification and acceptance

### Timesheets

- Verify visually at 320, 375, 768, 1024, and 1440 CSS pixel widths.
- Confirm that each daily entry's date, start, finish, break, status, and actions are visible without horizontal scrolling, controls do not overlap, focus states are visible, and the totals summary remains readable.
- Confirm the current browser-based timesheet calculation, future-date, absence, draft, and submission-payload regressions still pass.

### Job cards and invoices

- Reconcile the 13 source PDFs and every resulting page-level record against the 559-page input inventory; report blank, duplicate, or ambiguous pages instead of silently dropping them.
- Verify that the uploaded originals are byte-identical, derivatives render correctly, metadata points to the right source/page, and OCR text/fields can be searched and corrected.
- Verify repeated import does not duplicate a record; verify search access filtering; verify a page record can be linked to and queried from multiple invoices.
- Exercise at least one EC and one MTA record end to end against the actual authorized SharePoint environment before calling provider ingestion complete.

### Integration and release boundary

- Keep implementation changes on an isolated branch until the named reconciliation task's in-progress changes are reviewed and ready to combine.
- Require all targeted tests and visual review to pass before merging into that task's branch. That task must then rerun its relevant checks and verify both public site URLs after deployment before production is reported live.
- Do not push, merge, or deploy this feature independently of the requested reconciliation integration.

## Decisions for review

1. The proposed archive keeps the unchanged source bundles in SharePoint and adds one-page derivatives plus searchable page records. This uses more storage than keeping bundles alone, but makes each card a direct, independently linkable record.
2. Handwritten OCR is treated as searchable candidate text; uncertain structured values require Accounts correction before being treated as confirmed metadata.
3. The current 13 files are treated as the complete input set for this year's scans. The import report will show exact source, page, and record counts so missing or extra records are visible.
