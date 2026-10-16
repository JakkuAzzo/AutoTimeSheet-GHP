# GMT Job Card Attachments Design

## Purpose

Retain files submitted with a new EC or MTA job card in the protected job-card history. Attachments belong to one immutable revision, can be opened from protected history, and remain behind the existing GMT portal identity and role checks.

## Existing behavior

The portal already creates protected job-card records with stable record IDs, links revisions through `previousRecordId`, preserves prior record versions, and supports Accounts-managed invoice and Xero references. Scanned job cards already use resumable SharePoint uploads, D1 indexing, separate OCR candidate and confirmed fields, Accounts review audit, and authenticated content streaming. The job-card form currently sends its optional image only through FormSubmit; it does not retain that file alongside the protected record.

## Chosen design

Reuse the existing SharePoint Graph app identity and resumable upload-session pattern. The browser asks the Worker to create an upload session for a validated file and protected job-card record. The Worker derives the SharePoint path under `JobCards/Attachments/<record-id>/`, stores only session metadata, and returns the preauthenticated upload URL once. The browser uploads directly to that URL, then asks the Worker to complete the session. The Worker checks the SharePoint file size and QuickXorHash before inserting attachment metadata and an audit event in D1.

The upload URL is never stored, logged, or returned after session creation. SharePoint item IDs and paths remain server-side. The Worker streams attachment bytes through an authenticated content route. The browser receives only safe file metadata and a Blob URL created from the authenticated response.

## Access policy

- Attachment listing and content access use the existing shared job-card history read policy for authenticated GMT portal users.
- Upload-session creation and completion use the existing `canAccessRecord` policy: the record owner or an already-authorized administrator for that record can upload.
- Archive import and OCR review keep their existing Accounts/job-card-admin restrictions.
- Xero controls keep their current Accounts/Xero role checks. This feature does not call Xero or change invoice relationships.
- The existing SharePoint application identity and library permissions are unchanged. No public or anonymous SharePoint links are created.

## Record and revision behavior

Attachment metadata references the exact protected `record_id`, which is unique for each submitted card revision. A later revision therefore gets its own attachment list and cannot replace attachments on an earlier revision. Files are immutable after upload; an incorrect file is corrected by uploading a new attachment. Upload completion records the actor, stable attachment ID, file hash, and timestamp. Existing record version snapshots continue to audit changes to card fields.

## API contract

- `POST /api/records/:recordId/attachments` accepts a filename, allowed content type, byte size, SHA-256, and QuickXorHash; it returns an opaque attachment/session ID and one-time upload URL.
- `POST /api/records/:recordId/attachments/:attachmentId/complete` verifies the uploaded SharePoint item, then commits metadata and an upload audit row. Repeating completion is idempotent.
- `GET /api/records/:recordId/attachments` returns safe attachment metadata only.
- `GET /api/records/:recordId/attachments/:attachmentId/content` streams the file through the Worker after record and attachment authorization checks.

Accept image and PDF files, with bounded per-file, per-record count, and aggregate sizes. Validate identifiers, MIME types, filenames, hashes, and ownership on the Worker; never accept a client-selected SharePoint path. Incomplete or mismatched uploads are not listed as attachments. Expired sessions can be retried without changing the job-card record.

## Portal behavior

The create form accepts multiple image or PDF files. It first saves the protected job-card record, then completes each attachment upload, and only then submits the existing internal notification route. If an upload fails, keep the saved record and form state available for retry and do not report that the attachment was archived. The history preview lists attachments for the selected revision and downloads them through the authenticated Worker API.

## Verification and release boundary

Use local D1 and mocked Microsoft Graph fixtures to cover successful upload, duplicate retry, expired and mismatched sessions, authenticated downloads, role denial, and revision isolation. Keep existing job-card archive/OCR, access-policy, invoice-link, and Xero contract tests as regressions. Do not run an archive import against production, change production archive rows, send email to customers or ordinary staff, write to Xero, change provider permissions or secrets, deploy, or merge. Open a separate reviewable PR after focused local checks pass.
