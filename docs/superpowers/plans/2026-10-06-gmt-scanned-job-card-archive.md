# GMT Scanned Job Card Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store this year's scanned job cards in GMT SharePoint, make individual cards searchable and reviewable in the protected web app, and link those records to Xero invoices.

**Architecture:** Keep the 13 source bundles unchanged in SharePoint and create one PDF derivative and one searchable index row per source page. The archive row points to its SharePoint derivative and source batch; a matching protected `records` row of kind `job-cards` supplies the stable ID required by the existing invoice-link API. IDs derive from the source PDF SHA-256 and one-based page number. Each record stores the source filename/page, derivative SHA-256, OCR candidates and confidence separately from Accounts-confirmed fields, and a review state. The matching `records` payload uses `action='archive_import'` and `status='Archived'` so existing revision controls can hide edits to historical scans. A local preparation tool uses Poppler and Tesseract, while the Accounts-gated Job Cards UI uploads the manifest and documents through short-lived Microsoft Graph upload sessions and authenticated Worker routes.

**Tech Stack:** Cloudflare Workers and D1 (SQLite FTS5), Microsoft Graph SharePoint drive API, existing GMT vanilla-JS portal and Playwright browser tests, local Poppler and Tesseract command-line tools.

**Spec:** `docs/superpowers/specs/2026-10-06-gmt-timesheet-jobcard-archive-design.md`

## Global Constraints

- Preserve all 13 input PDFs unchanged in SharePoint and keep source file name and page number on every page record.
- Reconcile every page in the 559-page input inventory; report blank, duplicate, or ambiguous pages instead of silently dropping them.
- Give each page record a stable ID and content hash; unchanged retries must reuse existing records.
- Keep OCR candidates and confidence separate from confirmed or corrected values; raw OCR remains searchable.
- Only authorized Accounts identities may confirm or correct OCR fields; corrections record actor and timestamp.
- Use stable job-card record IDs and preserve one-to-many invoice relationships.
- Do not change SharePoint permissions or create/rotate provider secrets; use only the already configured authorized application identity.
- Do not expose SharePoint credentials, private file URLs, or SharePoint item IDs to public routes.

## Review Focus

- Empty or unreadable pages must not become silent missing records; test and report them in Task 1.
- Retrying a partially completed import must not duplicate the file or record; exercise a repeated page import in Task 2.
- A Graph upload failure must not leave a searchable record with missing content; assert upload-before-index ordering in Task 2.
- Employee identities may search and view shared job cards but cannot import or alter confirmed metadata; test both roles in Tasks 2 and 4.
- Searches with more than 500 matching records must paginate without skipping or repeating results; test cursors and page boundaries in Task 2.
- Shared employees can search and preview job cards, while invoice relationship access continues to follow the existing protected invoice-link policy; verify Accounts can query imported IDs without broadening invoice data to all staff.

---

## File Structure

- Create `tools/prepare-job-card-import.mjs` for local page splitting, OCR, hashing, and manifest generation.
- Create `tools/job-card-import.html` and `tools/job-card-import.js` for Accounts-only upload, progress, retry, and re-import controls.
- Create `cloudflare-worker/migrations/0010_job_card_archive.sql` for batch, searchable page, upload-session metadata, and metadata-review audit tables plus the FTS5 index. Persist only the Accounts actor, server-derived SharePoint path, expected file size/hash, purpose, and expiry for each upload session; never persist its preauthenticated `uploadUrl`.
- Create `cloudflare-worker/src/job-card-archive.js` for deterministic IDs, row normalization, idempotent upserts, and parameterized search.
- Modify `cloudflare-worker/src/index.js` to add role-checked Graph upload-session, import, search, review, and content routes. Reuse the SharePoint Graph authentication established by the reconciliation task.
- Modify `portal-api.js` with the typed search, import, review, and protected-content request wrappers.
- Modify `jobs/index.html`, `portal.js`, and `portal.css` to add archive search, page preview, Accounts review, invoice display, and the importer entry point.
- Create `tests/job-card-import-prepare.mjs`, `tests/job-card-archive.test.mjs`, and `tests/job-card-archive-ui.mjs`; add package scripts for them.

## Integration Precondition

Before implementation, wait for **GMT Pay Month Reconciliation & Portal Completion** to finish its current SharePoint archive edits and commit or otherwise expose a reviewable source revision. Bring that revision into this isolated branch first, preserving this spec and both plans. Use its reviewed Graph credential, upload, content-proxy, and deployment configuration; do not edit its active dirty worktree or duplicate an existing helper. If its interfaces differ from this plan, update this plan and return it for review before coding.

### Task 1: Prepare and reconcile the scanned pages locally

**Files:**
- Create: `tools/prepare-job-card-import.mjs`
- Test: `tests/job-card-import-prepare.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 13 source paths; Poppler commands `pdfinfo`, `pdfseparate`, and `pdftoppm`; Tesseract `eng`.
- Produces: `tmp/job-card-import/manifest.json`, 13 unchanged-source upload entries, and one derivative PDF plus OCR entry per source page. Manifest records `batchId`, source file/SHA-256/QuickXorHash, source page, derivative file/SHA-256/QuickXorHash, card type, candidate card number/date/customer/order number/site/engineer/report/amount, OCR text, mean OCR confidence, and review state.

- [ ] **Step 1: Write failing preparation tests**

Test deterministic page IDs from source SHA-256 plus one-based page number; reject a page with a missing renderer output; record blank OCR as `review_state: "needs-review"`; preserve each original source path and byte-identifying SHA-256 and compute QuickXorHash for source and derivative verification; and produce an inventory whose page total must equal 559 for this input set.

- [ ] **Step 2: Run `node tests/job-card-import-prepare.mjs` and confirm RED**

Expected: FAIL because the preparation module and manifest validation do not exist.

- [ ] **Step 3: Implement `prepareImport(sources, outputDir)`**

Use `pdfinfo` for page counts, `pdfseparate` for one-page PDFs, `pdftoppm` for OCR images, and `tesseract` TSV/text output. Do not alter input PDFs. Compute SHA-256 as the stable content identity and compute Microsoft's QuickXorHash for both source and derivative bytes to compare with SharePoint's returned file hash when available. Preserve raw OCR and mark low-confidence or missing anchor fields for review. Fail preflight if a required binary is missing or a page cannot be rendered.

- [ ] **Step 4: Run the preparation tests and confirm GREEN**

Run: `node tests/job-card-import-prepare.mjs`

Expected: PASS, including stable IDs and explicit missing/blank-page results.

- [ ] **Step 5: Prepare the supplied PDFs and reconcile the local manifest**

Run: `npm run prepare:job-cards -- --source-dir "/Users/nathanbrown-bennett/Documents/GMT Job Cards" --output-dir tmp/job-card-import`

Expected: 13 source entries, 559 page entries, matching source hashes, and a list of any blank, duplicate, ambiguous, or low-confidence records for Accounts review. Do not discard any such page.

- [ ] **Step 6: Commit the tested preparation tool**

```bash
git add tools/prepare-job-card-import.mjs tests/job-card-import-prepare.mjs package.json
git commit -m "feat: prepare scanned job cards for import"
```

### Task 2: Add protected SharePoint storage, D1 indexing, and search APIs

**Files:**
- Create: `cloudflare-worker/migrations/0010_job_card_archive.sql`
- Create: `cloudflare-worker/src/job-card-archive.js`
- Modify: `cloudflare-worker/src/index.js`
- Test: `tests/job-card-archive.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `POST /api/admin/job-card-upload-sessions` accepts `{fileName, sizeBytes, sha256, purpose, recordId?}` and returns `{sessionId, uploadUrl, expirationDateTime}` only to an authenticated Accounts identity. The server derives the destination path from the validated purpose and manifest identity; clients cannot choose arbitrary SharePoint paths.
- Upload-session bytes use sequential `PUT` ranges of 10 MiB (or the remaining final range); each non-final range is a multiple of 320 KiB and below 60 MiB. Keep the preauthenticated upload URL in browser memory only; never persist it, include it in other responses, or write it to application logs. Microsoft Graph expires inactive sessions and requires the next fragment or commit before the expiry time ([upload session documentation](https://learn.microsoft.com/graph/api/driveitem-createuploadsession)).
- `POST /api/admin/job-card-batches/complete` accepts `{sessionId, pageCount, sourceSha256, sourceQuickXorHash}` after a source-bundle upload and verifies completed SharePoint size and returned QuickXorHash before upserting the batch row.
- `POST /api/admin/job-cards/import` accepts `{sessionId, manifestEntry}` after a page upload; it verifies completed SharePoint size and returned QuickXorHash against the manifest, then atomically upserts the `records` row and `job_card_archive` row. Graph does not support `sha256Hash`, so retain the local SHA-256 as the stable content identity and do not claim it was independently verified remotely ([Graph hash properties](https://learn.microsoft.com/graph/api/resources/hashes?view=graph-rest-1.0)).
- `GET /api/job-cards/archive/search?q=&cardType=&from=&to=&cursor=&limit=` returns at most 100 protected records per page, with a stable cursor and no provider IDs/URLs.
- `GET /api/job-cards/archive/:recordId/content` checks the authenticated record policy and streams the one-page PDF from SharePoint.
- `PATCH /api/job-cards/archive/:recordId/review` accepts Accounts-confirmed fields and a review note, writes an audit entry with actor/time, and leaves OCR candidate values intact.
- D1 `job_card_archive.record_id` references a `records.record_id` row with `kind='job-cards'`; `xero_invoice_links` continues to use that record ID unchanged.

- [ ] **Step 1: Write failing D1 and Worker contract tests**

Cover migration columns and indexes, role-restricted session creation/import, upload-failure-before-index ordering, deterministic retries, content-access checks, FTS search, and cursor paging over at least 560 matching records. Assert the Accounts-only session response contains only its one-time `uploadUrl` plus opaque session metadata; other authenticated responses and every employee/unauthenticated response contain no SharePoint item IDs, private URLs, or upload URLs. Assert upload URLs have no D1 column and are never logged.

- [ ] **Step 2: Run `node tests/job-card-archive.test.mjs` and confirm RED**

Expected: FAIL because the migration, module, and routes are absent.

- [ ] **Step 3: Implement the D1 archive/index module and migration**

Create `job_card_import_batches`, `job_card_archive`, a contentful `job_card_archive_fts` FTS5 table using the trigram tokenizer, upload-session metadata without upload URLs, and `job_card_archive_review_audit`. Store raw OCR and separate candidate/confirmed JSON. Add parameterized type/date filters, three-character-or-longer text search, and keyset pagination. Use the trigram tokenizer only for queries of at least three consecutive characters, as required by its substring behavior ([D1 index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/)).

- [ ] **Step 4: Implement protected upload, import, search, review, and content routes**

Restrict upload-session creation, batch completion, page import, and review mutations to `identity.isAdmin || identity.isJobCardAdmin`. Store original bundles under `Shared Documents/JobCards/Source Batches/` and page PDFs under `Shared Documents/JobCards/Records/`, using deterministic names derived from validated IDs. Never accept a client-supplied SharePoint path. Only write/upsert D1 after Graph confirms the deterministic item path and size; compare returned `quickXorHash` to the manifest value and clearly distinguish this from the retained local SHA-256. Stream content through the Worker without returning item IDs or provider URLs. Expire and clear upload-session metadata after completion or expiry; the preauthenticated URL is never stored. Keep invoice-link reads and mutations on their existing record/Accounts access policy; do not broaden invoice data visibility while adding shared job-card search.

- [ ] **Step 5: Run Worker archive, access-policy, and invoice-link tests**

Run:

```bash
node tests/job-card-archive.test.mjs
node tests/job-card-access-policy.mjs
node tests/xero-integration-contract.mjs
```

Expected: all pass; an ordinary employee can search and preview shared cards but cannot import or correct them, and an authorized Accounts identity can query imported IDs through the existing invoice relationship API without changing its access policy.

- [ ] **Step 6: Commit the protected archive API**

```bash
git add cloudflare-worker/migrations/0010_job_card_archive.sql cloudflare-worker/src/job-card-archive.js cloudflare-worker/src/index.js tests/job-card-archive.test.mjs package.json
git commit -m "feat: add searchable scanned job card archive"
```

### Task 3: Add the Accounts importer and searchable Job Cards history

**Files:**
- Create: `tools/job-card-import.html`
- Create: `tools/job-card-import.js`
- Modify: `portal-api.js`
- Modify: `jobs/index.html`
- Modify: `portal.js`
- Modify: `portal.css`
- Test: `tests/job-card-archive-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- `GMTPortalApi.searchJobCards(filters)` calls the paged archive search route.
- `GMTPortalApi.beginJobCardUpload(file)` requests an Accounts-only upload session; `GMTPortalApi.completeJobCardBatch(sessionId, batchEntry)` commits the verified original bundle; `GMTPortalApi.importJobCardPage(sessionId, manifestEntry)` commits the verified page record.
- `GMTPortalApi.getJobCardContent(recordId)` returns an authenticated PDF `Blob` for an in-page object URL; the viewer selects the page record itself because each derivative is one page.
- `GMTPortalApi.reviewJobCard(recordId, correctedFields)` saves Accounts-confirmed metadata and an audit entry.

- [ ] **Step 1: Write failing Playwright UI tests**

Cover search by card number, customer, date range, order number, engineer, and OCR text; cursor paging; empty and low-confidence results; Accounts-only correction/import controls; one-page PDF preview; and preservation of existing invoice display.

- [ ] **Step 2: Run `node tests/job-card-archive-ui.mjs` and confirm RED**

Expected: FAIL because the archive controls and API wrappers do not exist.

- [ ] **Step 3: Add portal API wrappers and protected search/detail UI**

Show at most 100 results per page with next/previous controls. Escape OCR-derived values before rendering. Keep page preview in a Blob URL created from the authenticated Worker response and revoke it when selection changes. Use the existing `/api/records/job-cards/:recordId/invoices` UI and relationship endpoints, preserving their current Accounts/record access checks. For historical imported records (`action='archive_import'`), hide revision/edit controls while retaining authorized invoice relationship controls and read-only detail behavior.

- [ ] **Step 4: Add the resumable Accounts import flow**

Accept the prepared manifest and matching source/page files. Upload the 13 originals and 559 page PDFs using sequential Graph upload ranges, report each file/page and total progress, retry transient failures with the same deterministic path, and allow a rerun to skip verified records. Complete each original bundle before creating its batch entry; complete each page file before its archive/`records` upsert. Never mark a page imported until its SharePoint content metadata and D1 record both verify. Upload URLs stay in memory and must not appear in logs, saved browser storage, or error reports.

- [ ] **Step 5: Run importer UI, job-card, and invoice UI tests**

Run:

```bash
node tests/job-card-archive-ui.mjs
node tests/job-card-access-policy.mjs
node tests/xero-invoice-ui.mjs
```

Expected: all pass; Accounts can correct OCR candidates and manage invoice links, employees cannot edit them, and existing invoice permissions remain intact.

- [ ] **Step 6: Review the search and import UI visually at 320, 375, 768, 1024, and 1440 pixels**

Confirm search filters, progress/errors, one-page preview, and review form fit without clipping; confirm keyboard focus and touch targets.

- [ ] **Step 7: Commit the portal archive and importer UI**

```bash
git add tools/job-card-import.html tools/job-card-import.js portal-api.js jobs/index.html portal.js portal.css tests/job-card-archive-ui.mjs package.json
git commit -m "feat: add job card archive search and import UI"
```

### Task 4: Import and verify all supplied job cards

**Files:**
- No source changes unless the verified import reveals a defect; any fix returns to its owning task and test.
- Provider output: 13 source PDFs and page-level card documents in the GMT Web-App SharePoint library.

**Interfaces:**
- Consumes: verified local manifest from Task 1, reviewed Worker/API implementation from Tasks 2-3, existing Accounts identity and Graph app configuration.
- Produces: provider evidence for each source bundle and page record, aggregate counts, failure/review report, and invoice-linkable job-card record IDs.

- [ ] **Step 1: Verify deployment and Accounts access to the intended GMT Web-App SharePoint site**

Confirm the already configured Graph application identity can create upload sessions and write only to the approved existing library/folders. If permissions are missing, stop and report the exact blocker; do not change permissions or secrets.

- [ ] **Step 2: Upload one representative EC and one MTA record and verify end to end**

Use the authorized importer. Confirm source and page files in SharePoint, protected search results, authenticated one-page preview, OCR review state, and record-to-invoice lookup. Do not create or send an invoice.

- [ ] **Step 3: Import the remaining bundles with idempotent retries**

Run the Accounts importer for all 13 source PDFs and all page records. Retry only failed records with the same stable IDs. Preserve and report blank, duplicate, ambiguous, or low-confidence pages for Accounts review.

- [ ] **Step 4: Reconcile imported provider state to the input inventory**

Verify all 13 unchanged source bundles and exactly 559 page-level file/index records, including blank, duplicate, or ambiguous pages with their review states. Compare sizes and QuickXorHash values returned by Graph; retain SHA-256 values as local content identities and report that SharePoint does not independently return them. Search several EC and MTA cards by number, customer, date, and OCR text; correct sampled fields as Accounts and verify the audit trail. Query invoice relationships for imported record IDs without changing Xero.

- [ ] **Step 5: Record import evidence and prepare the integration handoff**

Save counts, hashes, SharePoint item verification results, search examples, review exceptions, and test output in `docs/superpowers/reports/`. Do not push, merge, or deploy from this feature branch; hand the verified branch to **GMT Pay Month Reconciliation & Portal Completion** for its requested integration gate.
