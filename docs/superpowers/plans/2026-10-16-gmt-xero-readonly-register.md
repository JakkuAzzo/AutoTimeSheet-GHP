# GMT Xero Read-Only Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make the Accounts Xero register's connection identity, page provenance and freshness, completion state, and GMT job-card lookup reliable and explicit.

**Architecture:** The protected Worker status route will validate each saved Xero tenant through the existing encrypted refresh-token flow and Xero Connections API. Invoice page responses will retain SharePoint/Xero provenance and timestamps, while the browser distinguishes a complete saved snapshot from a partial current walk. GMT record lookup will search server-side with bounded pagination so older job cards remain findable beyond the current 500-record window.

**Tech Stack:** Cloudflare Workers, D1, Microsoft Graph Drive API, Xero Accounting API, browser JavaScript, Node tests.

**Spec:** `docs/superpowers/plans/2026-10-12-xero-sharepoint-invoice-cache.md` plus the delegated task: OAuth connection and tenant identity, token-refresh health, invoice pagination, SharePoint cache freshness/source labeling, archive behavior, and job-card lookup.

## Global Constraints

- Keep Xero status, invoice reads, archive reads, and GMT record search behind the existing Accounts administrator check.
- Do not create, edit, send, void, or pay Xero invoices. Do not add or broaden Xero scopes.
- Keep OAuth secrets and tokens server-side; use the existing encrypted rotating refresh-token storage.
- Keep SharePoint pages tenant/page/status isolated. Explicit refresh remains the only path that fetches an already archived page from Xero.
- Do not call a partial browser register complete or overwrite a previous complete local snapshot with a failed walk.
- Do not invent an automatic cache expiry threshold; display the saved page timestamps and leave refresh explicit.
- Live provider validation stays read-only and requires the authenticated GMT Accounts identity; use fixtures when that identity is unavailable.

## Review Focus

- A stored connection row exists but refresh or tenant identity validation fails: show the exact per-tenant health without exposing tokens or mislabeling a transient service error as reauthentication.
- Two tenants are connected: each health result and browser cache must remain bound to its tenant ID.
- A cached page is old: show its `cached_at` source timestamp and explicit refresh path without silently treating it as current Xero data.
- A page walk fails after some pages or reaches the hard page limit: keep visible rows labelled partial and preserve the prior complete snapshot.
- A job card falls outside the newest 500 records or a broad search has more than one page: server-side search must find it and pagination must not repeat records.
- Existing callers without optional search/page parameters remain compatible; no invoice mutation or scope configuration is added.

---

### Task 1: Xero connection and tenant health

**Files:**
- Modify: `cloudflare-worker/src/index.js`, `tools/invoices.js`
- Test: `tests/xero-status-health.test.mjs`, `tests/xero-integration-contract.mjs`

**Interfaces:**
- `xeroStatus(env, identity, origin, fetchImpl)` returns each saved tenant's ID, live verified name when available, `refresh_health` (`healthy`, `reconnect_required`, `unavailable`, or `not_configured`), `identity_status` (`verified`, `mismatch`, or `unverified`), `checked_at`, and a safe error summary. It verifies stored tenant and connection IDs against Xero `GET /connections` using the existing encrypted refresh flow. It never returns tokens.
- `tools/invoices.js` renders verification and reconnect state from those fields.

- [x] Fix URL-to-path resolution in the Xero contract tests so focused checks run from a checkout whose path contains spaces.
- [x] Add `reports_healthy_status_only_for_a_live_matching_tenant`, `reports_reconnect_required_after_invalid_grant`, `keeps_transient_connections_failure_distinct_from_reconnect`, `reports_tenant_mismatch`, and `never_returns_token_material` in `tests/xero-status-health.test.mjs`.
- [x] Run `node tests/xero-status-health.test.mjs`; expect each new assertion to fail against the current saved-row-only status route.
- [x] Implement live connection verification and the four `refresh_health`/three `identity_status` values; render them in the Accounts connection panel.
- [x] Run `node tests/xero-status-health.test.mjs` and `npm run test:xero:integration-contract`; expect both to pass.
- [x] Commit as `feat: verify GMT Xero connection health`.

### Task 2: Invoice page freshness and complete pagination

**Files:**
- Modify: `cloudflare-worker/src/index.js`, `tools/invoices.html`, `tools/invoices.js`
- Create: `tools/invoice-register-state.js`
- Test: `tests/xero-invoice-archive.test.mjs`, `tests/xero-sharepoint-cache-ui.mjs`, `tests/xero-invoice-register-state.test.mjs`

**Interfaces:**
- `listXeroInvoices(env, tenantId, options)` continues to return `archive.source`, `archive.stored`, and `archive.cached_at`, plus `pagination.page_limit` and `pagination.has_more`.
- `GMTInvoiceRegisterState` summarizes page sources/timestamps and accepts only complete snapshots for storage, keyed to a tenant ID. Stored shape is `{ tenant_id, saved_at, complete, source_counts, invoices }`.
- `tools/invoices.js` displays source counts and oldest/newest timestamps; partial rows never replace the prior complete snapshot.

- [x] Add assertions for invalid pages, page 1000 full-page completion metadata, snapshot tenant binding, exact source timestamp summaries, and partial-save rejection.
- [x] Run `node tests/xero-invoice-archive.test.mjs` and `node tests/xero-invoice-register-state.test.mjs`; expect the new assertions to fail.
- [x] Implement page validation/limit metadata and the browser snapshot state helper; show source counts and saved timestamp ranges without adding a TTL.
- [x] Run `node tests/xero-invoice-archive.test.mjs`, `node tests/xero-invoice-register-state.test.mjs`, `node tests/xero-sharepoint-cache-ui.mjs`, and `npm run test:xero:integration-contract`; expect all to pass.
- [ ] Commit as `fix: label complete and partial Xero register snapshots`.

### Task 3: Searchable GMT record lookup

**Files:**
- Modify: `cloudflare-worker/src/index.js`, `portal-api.js`, `tools/invoices.html`, `tools/invoices.js`
- Test: `tests/xero-record-lookup.test.mjs`, `tests/xero-invoice-ui.mjs`

**Interfaces:**
- `xeroInvoiceRecords(request, env, identity, origin)` serves `GET /api/xero/records?q=&limit=&offset=`, searching record IDs, job/estimate references, confirmed/candidate metadata, and job-card OCR text. It returns `{ records, pagination: { has_more, next_offset } }`.
- `GMTPortalApi.xeroRecords(query, limit, offset)` sends the optional search/page parameters. The Accounts UI searches remotely and loads further matches while retaining selected records.

- [x] Add `finds_job_cards_outside_the_recent_500_and_paginates_without_duplicates` using SQLite fixtures and a remote-search UI contract assertion.
- [x] Run `node tests/xero-record-lookup.test.mjs` and `node tests/xero-invoice-ui.mjs`; expect the new lookup assertions to fail.
- [x] Implement `GET /api/xero/records?q=&limit=&offset=` and remote search/continuation while retaining selections.
- [x] Run `node tests/xero-record-lookup.test.mjs`, `node tests/xero-invoice-ui.mjs`, `npm run test:jobs:archive`, `npm run test:jobs:access-policy`, and `npm run test:xero:integration-contract`; expect all to pass.
- [ ] Commit as `feat: search archived job cards from invoice register`.

### Task 4: Operator guidance and release evidence

**Files:**
- Modify: `cloudflare-worker/README.md`
- Verify: focused Xero/job-card checks, Worker deployment workflow check, `git diff --check`, and Worker dry-run/build.

- [ ] Document the health fields, tenant verification, page freshness labels, partial-load behavior, job-card search, unchanged scopes, and the no-financial-write boundary.
- [ ] Run all focused suites, `npm run test:worker:deployment-workflow`, `npx wrangler deploy --dry-run --outdir /tmp/gmt-xero-worker-dry-run`, and `git diff --check`; inspect the diff for financial write calls, scope changes, and SharePoint deletes.
- [ ] Record live-check boundaries accurately. Do not deploy, merge, or alter provider data; commit and open a separate pull request for the coordinator's release gate.
