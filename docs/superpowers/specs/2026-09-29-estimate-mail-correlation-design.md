# Estimate Mail Correlation and Invoice Context Design

## Outcome

Accounts users opening an invoice can see the related GMT estimate, job card, and saved estimate email conversation. Revised or multiple Xero invoice numbers can remain associated with one piece of work without creating duplicate GMT records. Estimates created in the app and received by email enter the same searchable SharePoint index.

The invoice editor also remains usable at desktop and mobile widths. Its form, preview, invoice lines, and related-record controls must not overlap or obscure one another.

## Scope and access

The archive is readable to every authenticated GMT portal user, including estimate messages, client conversations, and their attachments. Xero invoice controls and manual financial record linking remain Accounts-only. The mailbox sources are `info@gmt-services.co.uk` and `accounts@gmt-services.co.uk`; `acc.gmtelect@outlook.com` is excluded because it cannot be accessed through Amanda's work account. Archive data is served through the authenticated portal backend. Keep the SharePoint source library service-restricted and expose archived content only through backend requests that validate the portal tenant identity. Do not create public or anonymous SharePoint links.

The preferred transport is Power Automate using the tenant’s existing Microsoft 365 authentication. It avoids storing mailbox credentials in the Cloudflare Worker. A future direct Graph integration remains possible, but is outside this first implementation.

## Mail intake and SharePoint index

A mailbox-triggered flow identifies sent customer estimates and the related client conversation, extracts estimate number, client, direction, sender, recipients, message date, job/reference terms, Outlook message ID, Internet Message-ID, and conversation ID, then stores the original MIME `.eml`, attachments, and a searchable manifest in the protected SharePoint estimate location. Only messages classified as customer-estimate or demonstrably related conversation are archived; keyword matches alone are not sufficient. Supplier quotations and unrelated attachments are excluded or left in a review queue. The flow upserts a canonical estimate index row keyed by a stable record ID.

The index stores canonical number, known number aliases, client identity, job/reference terms, estimate date, source (`email` or `app`), SharePoint item URL, Outlook message URL/message ID, attachment URL, created/updated timestamps, and correlation status. It retains aliases rather than overwriting history when an estimate number changes.

App-created estimates submit the same fields and use the same upsert contract. The flow is idempotent on Internet Message-ID (or mailbox plus provider message ID), attachment hash, and canonical record ID. Historical backfill covers Inbox and Sent Items with a persisted page/delta cursor and per-mailbox scanned, archived, duplicate, excluded, needs-review, and failed counts. Intake never moves, marks, categorizes, or deletes source mail.

## Correlation rules

Matching is ordered and explainable:

1. exact invoice, estimate, or job-card number;
2. known number alias;
3. explicit stored invoice/job/estimate link;
4. job or reference number plus client identity;
5. client identity plus a bounded date window.

Only exact or explicit matches are auto-linked. Lower-confidence candidates are displayed for Accounts review and require a manual link. Every link records who created it, when, and which rule or manual action produced it.

## Invoice experience

Authenticated portal users can search archived estimates and open related job cards, client conversation messages, and attachment downloads through the Worker. The Worker authenticates every list, detail, and content request and retrieves file bytes from SharePoint without exposing provider IDs or broad SharePoint links. Opening an invoice additionally loads its Xero details and related GMT index rows in the Accounts interface. It shows when several invoice numbers refer to one GMT record; uncertain matches remain candidates for Accounts review.

## Editor layout repair

The invoice editor uses a two-column CSS grid at wide widths: controls on the left and preview on the right. The grid uses `minmax(0, 1fr)` tracks, `min-width: 0` on children, normal document flow, and bounded text wrapping. Invoice-line controls use a responsive grid that collapses to one column on narrow screens. The preview becomes a normal-flow panel below the form on small screens. Related-record search and selected chips wrap within their panel. No control may rely on absolute positioning or fixed viewport widths.

The connection banner remains compact and separate from the editor. Lookup failures are shown in the editor status area with a retry action; they must not change the layout or replace the preview with misleading connection text.

## Error handling and audit

Mailbox, SharePoint, and correlation failures are visible as actionable archive status messages. The flow retries transient provider errors, deduplicates repeated deliveries, and records failed items for review. No estimate or message is silently discarded.

## Verification

Verification must cover: representative estimate messages and attachments from all three mailboxes; duplicate copies across mailboxes; sent and received messages in one conversation; a revised estimate number; multiple invoice numbers linked to one record; an app-created estimate; SharePoint persistence; authenticated portal visibility and content download; denied anonymous/wrong-tenant requests; no-match and ambiguous-match handling; desktop layout; narrow mobile layout; and a long invoice list with partial provider responses.

The release is complete only when a fresh mailbox-to-SharePoint-to-web-app chain is evidenced and the invoice editor is visually checked at desktop and mobile widths.
