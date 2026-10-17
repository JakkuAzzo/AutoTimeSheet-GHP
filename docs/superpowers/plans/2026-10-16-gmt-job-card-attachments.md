# GMT Job Card Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist files submitted with EC/MTA job cards in revision-specific protected history, with role-checked SharePoint storage and authenticated downloads.

**Architecture:** Reuse the Worker’s existing Microsoft Graph app identity and resumable upload protocol behind an authenticated, bounded Worker proxy. D1 atomically reserves per-revision quota and stores attachment metadata, upload-session state, and immutable upload audit events. The Worker counts and hashes the complete browser body before creating a transient Graph session, uploads bounded chunks, and verifies SharePoint size and QuickXorHash before completing an attachment. Portal creation and history UI use the existing protected-record identity and role policy.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Microsoft Graph SharePoint upload sessions, GMT vanilla JavaScript portal, Node fixture tests, existing Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-10-16-gmt-job-card-attachments-design.md`

## Global Constraints

- Attachment reads follow the existing shared authenticated job-card history policy.
- Attachment writes use the existing record-owner and administrator checks; archive import and OCR review stay Accounts/job-card-admin restricted.
- Keep SharePoint upload URLs inside Worker memory and never expose them, item IDs, or private paths to clients.
- Do not alter SharePoint library permissions, provider secrets, production archive data, or Xero data; do not deploy or merge.
- Use synthetic record IDs and mocked Graph responses for tests; do not send email to customers or ordinary staff.
- Attachments remain attached to their exact revision record ID and are immutable after completion.

## Review Focus

- Mismatched size or QuickXorHash must not produce a listable attachment; test both completion failures in Task 1.
- The actual bytes must have a recognizable signature for the declared image/PDF type; reject a correctly hashed mislabeled body before Graph access.
- A file preseeded at the reservation's server-derived path must not be adopted based only on provider name/size/QuickXorHash; verify replacement with the validated body and fail closed on non-file collisions.
- If concurrent exact uploads create an unindexed provider object, remove it; retain enough server-side state to retry cleanup if Graph is temporarily unavailable.
- Retrying a completed upload must not create a second attachment or audit event; cover repeated completion and same-file retries in Task 1.
- An employee may read shared attachments but may not attach a file to another employee's record; test read/write separation in Task 1.
- A file from one revision must never appear on another revision; test two record IDs sharing a reference in Task 1 and the portal fixture in Task 2.
- Unsupported MIME types, unsafe filenames, count/size limits, and expired upload sessions must fail without indexing a file; cover validation and expiry in Task 1.

---

### Task 1: Add verified protected attachment storage and routes

**Files:**
- Create: `cloudflare-worker/migrations/0014_job_card_attachments.sql`
- Create: `cloudflare-worker/src/job-card-attachments.js`
- Modify: `cloudflare-worker/src/index.js`
- Test: `tests/job-card-attachments.test.mjs`

**Interfaces:**
- `POST /api/records/:recordId/attachments` accepts `{fileName, contentType, sizeBytes, sha256, quickXorHash}`, atomically reserves revision quota, and returns `{attachmentId, expirationDateTime}` for a new upload or safe existing metadata for an exact completed duplicate.
- `PUT /api/records/:recordId/attachments/:attachmentId/content` accepts the file body; the Worker checks actual byte count and SHA-256 before any Graph upload, then proxies bounded Graph chunks and commits verified metadata plus one `uploaded` audit event.
- `POST /api/records/:recordId/attachments/:attachmentId/complete` returns already-completed metadata idempotently; provider verification occurs in the bounded content route.
- `GET /api/records/:recordId/attachments` returns only completed file metadata.
- `GET /api/records/:recordId/attachments/:attachmentId/content` streams bytes through the Worker after the existing record-read policy passes.
- Allow at most 10 image/PDF files per revision, 20 MiB per file, and 100 MiB total. Use the server-derived path `JobCards/Attachments/<record-id>/<attachment-id>-<sanitized-name>`.

- [x] **Step 1: Write fixture tests for attachment validation, upload, completion, and authorization**

Use an in-memory SQLite database with `schema.sql` and migrations, synthetic Entra tokens, and mocked Graph token/session/file responses. Assert that successful upload lists safe metadata and adds exactly one upload audit row; repeated completion and exact-file retry are idempotent; bad size/hash/signature and expired sessions are not listable; employees can read shared records but cannot upload to another owner's record; concurrent reservations remain within count and aggregate limits; actual oversize/short bodies and mislabeled file signatures are rejected before Graph access; duplicate provider objects are cleaned or retained for cleanup retry; no upload URL is returned or stored; content is streamed without exposing Graph item IDs; and same-reference revision records have independent attachment lists.

- [x] **Step 2: Run `node tests/job-card-attachments.test.mjs` and confirm RED**

Expected: FAIL because the new migration/module/routes do not exist.

- [x] **Step 3: Add the D1 metadata/session/audit tables and attachment module**

Persist only validated file metadata, expected SharePoint path, actor, expiry, provider item pointer, duplicate-cleanup pointer, status, and event evidence. Never persist the Graph upload URL. Verify actual request signatures for supported file types before Graph access. Expired sessions remain non-listable; an exact completed retry returns the original metadata.

- [x] **Step 4: Add Worker reservation, upload, completion, list, and content routes**

Authorize all routes against the referenced `records` row. Use `canAccessRecord` for upload reservation and content upload, `canReadHistoryRecord` for list and content download so visibility matches shared job-card history, reject scanned `archive_import` rows, and keep SharePoint paths server-derived. Atomically reserve count/size quota before provider access, bound and hash the actual request stream before Graph, keep the transient Graph URL in Worker memory, and commit completed metadata plus its audit event atomically after provider verification. Preserve the existing archive import and OCR review policies.

- [x] **Step 5: Run the attachment fixture and access-policy tests**

Run: `node tests/job-card-attachments.test.mjs` and `node tests/job-card-access-policy.mjs`

Expected: both PASS, with no production provider calls.

### Task 2: Add multi-file upload and revision history access in the portal

**Files:**
- Modify: `portal-api.js`
- Modify: `jobs/index.html`
- Modify: `portal.js`
- Modify: `portal.css`
- Test: `tests/job-card-attachments-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Add `GMTPortalApi.startJobCardRecordAttachment(recordId, metadata)`, `uploadJobCardRecordAttachment(recordId, attachmentId, file)`, `completeJobCardRecordAttachment(recordId, attachmentId)`, `jobCardRecordAttachments(recordId)`, and `fetchJobCardRecordAttachment(recordId, attachmentId)`.
- Send file bytes to the authenticated Worker content route; keep `job-${reference}-${id}` as the unique parent record ID.

- [x] **Step 1: Write a UI fixture test for upload-before-notification and revision isolation**

Stub the protected API and Worker content route. Assert the protected record is created once, each selected file is hashed/uploaded/completed before the existing FormSubmit notification is submitted, a failed upload leaves a retryable saved record and does not send the notification, retry reuses the reservation, and the selected revision preview lists/downloads only that revision's attachments without receiving a Graph URL.

- [x] **Step 2: Run `node tests/job-card-attachments-ui.mjs` and confirm RED**

Expected: FAIL because the upload/list/download wrappers and history UI are absent.

- [x] **Step 3: Add authenticated portal API wrappers and file hashing**

Compute SHA-256 and QuickXorHash from selected browser files, request an atomic Worker reservation, send raw bytes through the authenticated Worker content route, and complete idempotently via the Worker. Handle an exact duplicate by reusing its safe metadata without uploading again.

- [x] **Step 4: Update job-card submission and history UI**

Accept multiple image/PDF files. Save the protected card first, then upload attachments before sending the existing internal notification. Preserve a pending submission and selected files on upload failure so retry reuses its record ID. Add a selected-revision attachment list and authenticated download buttons. Keep existing EC/MTA revision creation, preview, invoice links, and OCR archive controls intact.

- [x] **Step 5: Run the UI fixture and focused existing job-card browser checks**

Run: `node tests/job-card-attachments-ui.mjs` and `npm run test:jobs:archive-ui`.

Expected: both PASS using local fixtures; no customer/staff messages or production upload.

### Task 3: Run regression checks and prepare the PR

**Files:**
- Modify: `cloudflare-worker/README.md`
- Check: existing job-card, archive/OCR, access, and Xero contract tests

- [x] **Step 1: Document the attachment endpoints, limits, storage path, and existing access policy**

- [x] **Step 2: Run focused regressions**

Run `node tests/job-card-archive.test.mjs`, `node tests/job-card-access-policy.mjs`, `node tests/job-card-attachments.test.mjs`, `NODE_PATH=<bundled node_modules> node tests/job-card-attachments-ui.mjs`, `NODE_PATH=<bundled node_modules> node tests/job-card-email-routing.mjs`, `NODE_PATH=<bundled node_modules> node tests/job-card-archive-ui.mjs`, `npm run test:xero:invoice-order`, the Xero contract through the temporary no-space symlink if needed, and `git diff --check`.

- [x] **Step 3: Review the final diff and verify no provider state changed**

Confirm only task-scoped source, migration, tests, and docs changed; no live SharePoint, Xero, email, secret, permission, import, deployment, or merge operation was performed.

- [x] **Step 4: Commit, push the feature branch, and open a separate PR**

Use a PR description that states the new protected attachment workflow, role boundary, test evidence, and the explicit no-deploy/no-provider-write release boundary.
