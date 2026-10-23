# GMT Job Card Attachments Design

## Purpose

Retain files submitted with a new EC or MTA job card in the protected job-card history. Attachments belong to one immutable revision, can be opened from protected history, and remain behind the existing GMT portal identity and role checks.

## Existing behavior

The portal already creates protected job-card records with stable record IDs, links revisions through `previousRecordId`, preserves prior record versions, and supports Accounts-managed invoice and Xero references. Scanned job cards already use resumable SharePoint uploads, D1 indexing, separate OCR candidate and confirmed fields, Accounts review audit, and authenticated content streaming. The job-card form currently sends its optional image only through FormSubmit; it does not retain that file alongside the protected record.

## Chosen design

Reuse the existing SharePoint Graph app identity and resumable upload-session protocol behind a bounded Worker proxy. The browser asks the Worker to atomically reserve revision quota and receives an attachment ID and expiry, then sends the file bytes to the authenticated Worker content route. The Worker derives the SharePoint path under `JobCards/Attachments/<record-id>/`, bounds and counts the actual request body, verifies its SHA-256 and recognizable file signature against the reservation, and only then creates a Graph upload session and forwards bounded chunks. It verifies the resulting SharePoint size and QuickXorHash before inserting attachment metadata and an audit event in D1.

The preauthenticated Graph upload URL exists only in Worker memory during the upload and is never persisted, logged, or returned to the browser. If a provider mismatch is detected, the Worker deletes the SharePoint object before expiring the reservation. SharePoint item IDs and paths remain server-side. The browser receives only safe file metadata and a Blob URL created from the authenticated response.

If a file already occupies a reservation's unique expected path, the Worker does not adopt it based on SharePoint name, size, or QuickXorHash metadata. It replaces an existing file with the newly validated request bytes and rejects unexpected non-file path collisions.

If two reservations for the same file complete concurrently, the later session is marked duplicate and its temporary SharePoint object is deleted before the duplicate is reported as settled. If deletion is unavailable, the D1 session retains the private item ID so a later retry can finish cleanup.

## Access policy

- Attachment listing and content access use the existing `canReadHistoryRecord` shared job-card history policy for authenticated GMT portal users.
- Upload reservation and content upload use the existing `canAccessRecord` policy: the record owner or an already-authorized administrator for that record can upload.
- Archive import and OCR review keep their existing Accounts/job-card-admin restrictions.
- Xero controls keep their current Accounts/Xero role checks. This feature does not call Xero or change invoice relationships.
- The existing SharePoint application identity and library permissions are unchanged. No public or anonymous SharePoint links are created.

## Record and revision behavior

Attachment metadata references the exact protected `record_id`, which is unique for each submitted card revision. A later revision therefore gets its own attachment list and cannot replace attachments on an earlier revision. Files are immutable after upload; an incorrect file is corrected by uploading a new attachment. Upload completion records the actor, stable attachment ID, file hash, and timestamp. Existing record version snapshots continue to audit changes to card fields.

## API contract

- `POST /api/records/:recordId/attachments` accepts a filename, allowed content type, byte size, SHA-256, and QuickXorHash; it atomically reserves the revision's count and total-size quota, then returns an opaque attachment ID and expiry. It does not return a SharePoint URL.
- `PUT /api/records/:recordId/attachments/:attachmentId/content` accepts the file body. The Worker checks actual body length and SHA-256 before contacting Graph, uploads with bounded Graph chunks, verifies the resulting item, then commits metadata and one audit row. Repeating the same upload after a lost response is idempotent.
- `POST /api/records/:recordId/attachments/:attachmentId/complete` returns metadata only for an already-completed or duplicate session and remains idempotent. Active sessions return `409`; only the actual-byte content route completes them.
- `GET /api/records/:recordId/attachments` returns safe attachment metadata only.
- `GET /api/records/:recordId/attachments/:attachmentId/content` streams the file through the Worker after record and attachment authorization checks.

Accept image and PDF files, with bounded per-file, per-record count, and aggregate sizes. Validate identifiers, MIME types, filenames, hashes, and ownership on the Worker; reject names containing double quotes, asterisks, colons, angle brackets, question marks, slashes, backslashes, or vertical bars, plus leading/trailing whitespace, before reserving quota. The portal applies the same filename check before saving a new protected record. Never accept a client-selected SharePoint path. Incomplete or mismatched uploads are not listed as attachments. Expired sessions can be retried without changing the job-card record.

## Portal behavior

The create form accepts multiple image or PDF files. It rejects invalid SharePoint filenames before saving the protected job-card record, then saves the record, uploads each bounded file through the Worker, and only then submits the existing internal notification route. If an upload fails, keep the saved record and form state available for retry and do not report that the attachment was archived. The history preview lists attachments for the selected revision and downloads them through the authenticated Worker API.

## Verification and release boundary

Use local D1 and mocked Microsoft Graph fixtures to cover successful upload, duplicate retry and cleanup recovery, actual-body size/hash/signature rejection before provider access, concurrent quota reservations, expired and mismatched sessions, provider-object cleanup, authenticated downloads, role denial, and revision isolation. Keep existing job-card archive/OCR, access-policy, invoice-link, and Xero contract tests as regressions. Do not run an archive import against production, change production archive rows, send email to customers or ordinary staff, write to Xero, change provider permissions or secrets, deploy, or merge. Open a separate reviewable PR after focused local checks pass.
