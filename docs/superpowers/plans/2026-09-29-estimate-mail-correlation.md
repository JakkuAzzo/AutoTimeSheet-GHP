# Estimate Mail Correlation and Invoice Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended for native execution) to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Index estimate emails and app-created estimates in SharePoint, correlate them to invoices/job cards, and repair the invoice editor layout across desktop and mobile.

**Architecture:** Power Automate owns mailbox intake, attachment filing, and SharePoint upserts. The authenticated Cloudflare Worker exposes canonical estimate-index records and correlation results to Accounts users; the invoice UI renders them without exposing mailbox contents to staff. Existing app-created estimate records use the same index contract.

**Tech Stack:** Cloudflare Worker, D1, vanilla JavaScript/CSS, Microsoft Graph/Power Automate, SharePoint, Node contract tests, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-09-29-estimate-mail-correlation-design.md`

## Global Constraints

- All authenticated GMT portal users may read the shared estimate/job/conversation archive through the Worker; Xero invoice actions and financial linking stay Accounts-only.
- Keep the SharePoint archive restricted to its service/admin audience; do not create anonymous or public links.
- Preserve estimate-number aliases; never silently merge uncertain matches.
- Use existing Power Automate/Microsoft 365 authentication before adding Worker-held mailbox credentials.
- Invoice editor must use normal responsive flow with no absolute positioning or fixed viewport widths.
- A release requires fresh mailbox-to-SharePoint-to-web-app evidence.

## Review Focus

- Revised or multiple invoice numbers: aliases remain attached to one canonical GMT record; test in Task 2.
- Ambiguous client/date matches: candidates require manual confirmation; test in Task 2.
- Duplicate Outlook delivery or flow retry: one index row and one attachment link; test in Task 1.
- Mailbox/SharePoint provider outage: actionable status and retry without losing invoice edits; test in Tasks 1 and 4.
- Narrow mobile viewport and long labels: no overlap or clipped controls; test in Task 4.

### Task 1: SharePoint estimate index and Power Automate contract

**Files:**
- Create: `cloudflare-worker/migrations/0007_estimate_index.sql`
- Modify: `cloudflare-worker/src/index.js`
- Create: `cloudflare-worker/src/estimate-index.js`
- Test: `tests/estimate-index-contract.mjs`
- Create: `docs/integrations/estimate-mail-sharepoint-flow.md`

**Interfaces:**
- Produces `upsertEstimateIndex(env, input)`, `listEstimateIndex(env, identity, query)`, and `correlateEstimateRecords(indexRows, invoice, records)`.
- Input fields: `canonical_id`, `estimate_number`, `number_aliases`, `client`, `client_email`, `reference`, `estimate_date`, `source`, `outlook_message_id`, `outlook_url`, `sharepoint_url`, `attachment_url`, `correlation_status`.

- [ ] Write failing contract tests for idempotent message IDs, alias preservation, Accounts-only access, and retry-safe upsert payloads.
- [ ] Add the D1 table/indexes for canonical estimate rows, aliases, Outlook IDs, and SharePoint URLs.
- [ ] Implement bounded Worker endpoints for protected index upsert/list and correlation; reject non-Accounts identities.
- [ ] Document the Power Automate trigger, extraction fields, SharePoint upsert, duplicate guard, retry, and failed-item review path.
- [ ] Run `node tests/estimate-index-contract.mjs` and commit.

### Task 2: Invoice correlation and related-record API

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Modify: `cloudflare-worker/src/estimate-index.js`
- Test: `tests/xero-integration-contract.mjs`

**Interfaces:**
- `correlateEstimateRecords()` returns `{ matches, candidates, explanation }`; matches require exact/alias/explicit rules, candidates remain unlinked.
- Invoice detail returns `related_estimates`, `related_job_cards`, and `email_threads` with source rule and URLs.

- [ ] Add failing tests for exact number, alias, explicit link, client/reference match, ambiguous candidate, and multiple invoices for one canonical record.
- [ ] Implement deterministic correlation order and bounded result projection.
- [ ] Extend invoice detail without regressing existing Xero mutations or saved link behavior.
- [ ] Run the Xero UI/integration contracts and commit.

### Task 3: App-created estimate indexing

**Files:**
- Modify: `tools/estimates.js`
- Modify: `portal-api.js`
- Test: `tests/estimate-index-contract.mjs`

**Interfaces:**
- App-created estimate submission sends the Task 1 index payload and retains `canonical_id`/aliases.

- [ ] Add a failing test proving an app estimate and an email estimate with the same canonical number converge on one index row.
- [ ] Submit the protected index event after estimate save/send, preserving the existing client email flow.
- [ ] Show index/link status and retry guidance without blocking local estimate preview.
- [ ] Run tests and commit.

### Task 4: Invoice editor layout and lookup resilience

**Files:**
- Modify: `tools/invoices.html`
- Modify: `tools/invoices.js`
- Modify: `portal.css`
- Test: `tests/xero-invoice-ui.mjs`

**Interfaces:**
- `renderRelatedRecords()` consumes the Task 2 projection.
- Lookup failures expose an actionable status and preserve entered form values.

- [ ] Add failing UI assertions for desktop two-column layout, mobile stacking, wrapped related-record chips, and no overlap in invoice-line controls.
- [ ] Implement responsive grid/flex rules with `minmax(0, 1fr)`, `min-width: 0`, normal flow, and mobile stacking.
- [ ] Render provider lookup errors separately from connection status and keep the preview usable.
- [ ] Add related estimate/job/email sections to the invoice detail panel.
- [ ] Run UI contracts and inspect at desktop and narrow viewport sizes; commit.

### Task 5: Provider setup, replay, and release verification

**Files:**
- Modify: `docs/integrations/estimate-mail-sharepoint-flow.md`
- Modify: `cloudflare-worker/wrangler.toml` only if a new non-secret endpoint setting is required
- Test: `tests/provider-estimate-replay.mjs`

- [ ] Configure idempotent estimate and related-conversation intake for Inbox and Sent Items across `info@gmt-services.co.uk` and `accounts@gmt-services.co.uk`; exclude `acc.gmtelect@outlook.com`, preserve `.eml` originals and attachment versions, and leave source mail untouched.
- [ ] Backfill all approved folders with persisted pagination and reconcile per-mailbox counts for scanned, archived, duplicates, excluded, review, and failed records.
- [ ] Keep SharePoint source files restricted and verify authenticated portal users can retrieve them through the protected Worker; verify anonymous and wrong-tenant access is denied.
- [ ] Replay one real estimate email and verify message ID, attachment, index row, and web-app match.
- [ ] Verify a revised estimate number and a second invoice both resolve to the same canonical record.
- [ ] Verify an app-created estimate enters the same index.
- [ ] Run the full test set, build Pages, deploy Worker and Pages, and capture fresh production evidence.
- [ ] Commit release notes and merge the feature branch into `main`.
