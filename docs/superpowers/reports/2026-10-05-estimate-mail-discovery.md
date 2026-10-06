# GMT estimate-mail discovery (read-only)

Inspection date: 2026-10-05 (Europe/London). Searches were run in the visible Microsoft Outlook web UI while signed in as Amanda Brown-Bennett. No message was marked, moved, categorized, modified, or exported. This is a bounded discovery sample, not a complete mailbox census.

## Mailbox and folder coverage

| Source | Access observed | Folder totals shown by Outlook | Date/pagination coverage | Distinct customer estimates |
|---|---|---|---|---|
| `info@gmt-services.co.uk` | Opened through Outlook's “Open another mailbox” under Amanda's work session | Inbox 18,510; Sent Items 11,514; Drafts 5; Deleted Items 77; Junk 13 | Full folders not enumerated. Outlook search was scoped to All folders, but its result pane showed relevance/top-result groups without a stable total or exhaustive pagination proof. One reviewed conversation spans 2025-04-15 through 2026-08-25. | Unknown; no defensible complete count from this UI sample |
| `accounts@gmt-services.co.uk` | The Accounts mailbox was mounted in Amanda's Outlook; its tenant mailbox name was `Accounts@GMTElectServsLtd.onmicrosoft.com` | Inbox 6; Sent Items 0; Drafts, Deleted, Junk, and Archive each showed 0 | Folder access visible; no full date range, query pagination, or message-by-message classification completed | Unknown; no defensible count |
| `acc.gmtelect@outlook.com` | Not opened in the current signed-in work Outlook session. References to it in messages do not prove access to that Outlook.com mailbox. | Not available | Inaccessible in this session; mailbox contents and date range unknown | Unknown |

Folder badges are mailbox item totals, not estimate counts; they may include non-estimate messages, conversations, and duplicate copies. Outlook did not provide a reproducible total for the broad search results viewed. Do not interpret the visible “Top results” or “All results” preview rows as a count of matches.

## Search and reviewed examples

Search scope for the `info` mailbox was **All folders**. Queries were `[GMT][ESTIMATE][CLIENT]`, `estimate`, `quotation`, and `quote`. The structured marker search did not settle to a reliable result set in the UI; its output is not used as a count or classification rule.

- `estimate` returned actual GMT-sent customer estimates with attachments, customer replies, purchase-order follow-ups, and unrelated results. A manually opened customer conversation contained 9 messages between 2025-04-15 and 2026-08-25. The same conversation contained multiple separately dated outbound estimates with attachment indicators and later customer correspondence/PO references. These must remain separate messages and attachment/version records while sharing one conversation/job association.
- `quotation` returned external supplier quotations and a customer quotation request alongside GMT correspondence. Word match alone is not evidence of a GMT customer estimate.
- `quote` returned supplier quote documents, quote-chase mail, customer quote requests, and service correspondence. It is a high-noise discovery term.
- Customer replies such as “please proceed” or “please see attached PO” can be part of an estimate/job conversation, but are not estimate sends themselves.

Raw subject lines, customer names/addresses, mailbox-local IDs, and message bodies are intentionally omitted from this repository report. Git/remotes are not an approved destination for customer correspondence identifiers. The archive manifest stored in the restricted SharePoint destination must retain original source mailbox and provider IDs for dedupe and audit.

## Classification rules for the archive flow

1. **High-confidence sent estimate:** source mailbox is one of the three approved sources; message direction is GMT-to-external-customer; content explicitly presents GMT's estimate/cost/quotation for requested work; and it has an estimate document or a clear estimate reference. Preserve the original message and all attachments as a distinct revision.
2. **Related conversation, not estimate:** inbound customer request, approval, question, PO, scheduling, or follow-up tied by Outlook conversation ID and corroborated job/customer/reference. Archive as a separate message connected to the conversation; do not count it as a sent estimate.
3. **Supplier/procurement false positive:** quote/quotation/pro forma from an external supplier, or a GMT request/order/payments response about a supplier document. Exclude from the customer-estimate class; keep as review-needed only when evidence links it to a customer job.
4. **Ambiguous:** missing direction, sender, reference, attachment, or customer/job evidence; retain as `candidate`/`needs-review`, never confirmed by keyword alone.
5. **Deduplication/versioning:** prefer Internet Message-ID across mailboxes; fall back to mailbox-local message ID plus source mailbox. Keep source occurrences for duplicate copies. Similar subject/body or repeated estimate number alone must not merge revisions. Use Outlook conversation ID to group correspondence, but attach exact job/invoice edges only from explicit references or reviewer confirmation.

## Reproducibility and next evidence required

Repeat each query in Outlook with mailbox identity and **All folders** visible. To produce qualifying totals, the Power Automate backfill must enumerate each approved folder with a persisted page/delta cursor, emit per-mailbox scanned/qualifying/excluded/duplicate/review/failed counts, and reconcile each completed source message ID to its SharePoint EML, attachment hashes, manifest, and D1 source occurrence. Until that pass is complete, counts for all three mailboxes remain **unknown**, and this report makes no completeness claim.

## Live Power Automate inspection

On 2026-10-05 the existing `GMT Portal - Estimate Mail Index` flow was inspected in Safari. The flow details page showed it **On**, with multiple failed/canceled runs. Its current trigger is only for `info@gmt-services.co.uk`; it does not cover the other approved mailboxes or establish Sent Items coverage. In the editor, `Get email` has a Message Id token and the `Foreach` iterates Attachments into a SharePoint `Create file` action. That action points at `https://GMTWeb-App.sharepoint.com/sites/GMTWeb-App` and `/Shared Documents/Estimates`, rather than the observed GMT tenant host and `/Shared Documents/Estimates/Incoming`. It runs before any estimate classification. The `Extract estimate metadata` and `Upsert estimate index` scopes contain no actions. Flow checker showed zero errors and warnings, which does not establish functional logic. No save, test, trigger, or mail/file modification was performed during this inspection.

The flow must not be enabled with this ordering: it would attempt to archive every attachment from every triggered message, including unrelated correspondence. First add a reliable estimate/conversation classification gate, ensure attachment creation occurs only after the gate, correct the SharePoint destination, implement the manifest/index upsert and retry path, then validate one controlled test without changing source mail. Historical ingestion still requires a separate paged backfill across all approved folders and mailboxes.
## GMT Worker configuration check

Read-only inspection of the production `gmt-portal-api` Worker settings in the Info Cloudflare account confirmed that the encrypted secret name `ESTIMATE_MAIL_INGEST_KEY` is already configured; its value was not opened or copied. The Worker settings list did not contain `SHAREPOINT_GRAPH_CLIENT_ID`, `SHAREPOINT_GRAPH_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, or `SHAREPOINT_DRIVE_ID`. The current deployment therefore has the intake-key prerequisite in place, but lacks the app-only SharePoint configuration required for authenticated portal file retrieval. No Cloudflare configuration was changed.
