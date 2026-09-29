# Estimate Mail Correlation and Invoice Context Design

## Outcome

Accounts users opening an invoice can see the related GMT estimate, job card, and saved estimate email conversation. Revised or multiple Xero invoice numbers can remain associated with one piece of work without creating duplicate GMT records. Estimates created in the app and received by email enter the same searchable SharePoint index.

The invoice editor also remains usable at desktop and mobile widths. Its form, preview, invoice lines, and related-record controls must not overlap or obscure one another.

## Scope and access

The workflow is Accounts-only. The mailbox source is `info@gmt-services.co.uk`; the SharePoint destination is the existing GMT site and estimate/document area. The web app reads correlation results only through the authenticated backend. Staff users do not receive mailbox contents or Accounts invoice controls.

The preferred transport is Power Automate using the tenant’s existing Microsoft 365 authentication. It avoids storing mailbox credentials in the Cloudflare Worker. A future direct Graph integration remains possible, but is outside this first implementation.

## Mail intake and SharePoint index

A mailbox-triggered flow identifies estimate messages and attachments, extracts estimate number, client, sender, message date, job/reference terms, and Outlook message ID, then stores the original message URL and attachment in the protected SharePoint estimate location. The flow upserts a canonical estimate index row keyed by a stable record ID.

The index stores canonical number, known number aliases, client identity, job/reference terms, estimate date, source (`email` or `app`), SharePoint item URL, Outlook message URL/message ID, attachment URL, created/updated timestamps, and correlation status. It retains aliases rather than overwriting history when an estimate number changes.

App-created estimates submit the same fields and use the same upsert contract. The flow is idempotent on Outlook message ID, attachment hash, and canonical record ID.

## Correlation rules

Matching is ordered and explainable:

1. exact invoice, estimate, or job-card number;
2. known number alias;
3. explicit stored invoice/job/estimate link;
4. job or reference number plus client identity;
5. client identity plus a bounded date window.

Only exact or explicit matches are auto-linked. Lower-confidence candidates are displayed for Accounts review and require a manual link. Every link records who created it, when, and which rule or manual action produced it.

## Invoice experience

Opening an invoice loads its Xero details and related GMT index rows. The context panel shows each related estimate/job card, client, date/status, SharePoint record link, and saved Outlook message link. It also shows when several invoice numbers refer to the same GMT record. If no match exists, it says so and offers the Accounts link workflow. Full mailbox search is not exposed until the protected index is available.

## Editor layout repair

The invoice editor uses a two-column CSS grid at wide widths: controls on the left and preview on the right. The grid uses `minmax(0, 1fr)` tracks, `min-width: 0` on children, normal document flow, and bounded text wrapping. Invoice-line controls use a responsive grid that collapses to one column on narrow screens. The preview becomes a normal-flow panel below the form on small screens. Related-record search and selected chips wrap within their panel. No control may rely on absolute positioning or fixed viewport widths.

The connection banner remains compact and separate from the editor. Lookup failures are shown in the editor status area with a retry action; they must not change the layout or replace the preview with misleading connection text.

## Error handling and audit

Mailbox, SharePoint, and correlation failures are visible as actionable Accounts status messages. The flow retries transient provider errors, deduplicates repeated deliveries, and records failed items for review. No estimate or invoice is silently discarded.

## Verification

Verification must cover: a real estimate email from `info@gmt-services.co.uk`; an attached estimate document; a revised estimate number; multiple invoice numbers linked to one record; an app-created estimate; SharePoint persistence; Outlook message links; Accounts-only visibility; no-match and ambiguous-match handling; desktop layout; narrow mobile layout; and a long invoice list with partial provider responses.

The release is complete only when a fresh mailbox-to-SharePoint-to-web-app chain is evidenced and the invoice editor is visually checked at desktop and mobile widths.
