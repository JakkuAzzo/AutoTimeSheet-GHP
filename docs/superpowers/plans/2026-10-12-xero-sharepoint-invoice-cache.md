# Xero SharePoint Invoice Cache Implementation Plan

> **For agentic workers:** Implement this plan natively, task by task. Use test-first changes and preserve existing worktree state.

**Goal:** Persist Xero invoice register pages in the SharePoint `Invoices` folder and serve archived history to the Accounts portal without paging Xero for every old invoice on every visit.

**Architecture:** The Worker uses its existing app-only Microsoft Graph connection to upsert deterministic JSON page files under `Invoices/Xero/<tenant-id>/`. The authenticated invoice list endpoint reads a saved page first, fetches and stores it on a cache miss, and supports an explicit refresh path. Portal UI reports whether pages came from the archive or live Xero and preserves the existing invoice projection and Accounts gate.

**Tech Stack:** Cloudflare Workers, D1, Microsoft Graph Drive API, Xero Accounting API, browser JavaScript, Node tests.

**Spec:** User request on 2026-10-12 to continue the SharePoint invoice archive until complete, following the confirmed empty `Invoices` folder creation and prior request to cache old Xero invoice history.

## Global Constraints

- No deletion or voiding of source Xero invoices or archived SharePoint content.
- Keep invoice list and archive operations behind the existing authenticated Accounts administrator check.
- Use deterministic tenant/page file paths and idempotent replacement; do not expose Graph credentials or tokens to the browser.
- If SharePoint cannot be read or written, report archive state accurately and preserve the existing live-Xero fallback.
- Historical reads must use SharePoint after a page has been archived; explicit refresh may call Xero.

## Review Focus

- Cached SharePoint page belongs to a different tenant or page size: reject it and fetch the requested page.
- Graph returns missing page versus authorization/server error: only 404 is a cache miss; other failures must not masquerade as a valid cache hit.
- SharePoint upload fails after successful Xero read: return usable Xero data while marking it unarchived.
- Existing callers omit cache parameters: remain compatible and return the same invoice projection and pagination shape.
- Empty final Xero page: archive an empty page so repeated visits do not fetch it again.

---

### Task 1: Worker page archive contract

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Test: `tests/xero-invoice-archive.test.mjs`

**Interfaces:**
- Extend `listXeroInvoices(env, tenantId, options)` to return `{ tenant, invoices, page, page_size, refreshed_at, archive: { source, cached_at, stored } }`.
- Read/write `Invoices/Xero/<tenant-id>/page-<page>-<limit>.json` using existing Graph helpers.
- `options.refresh === true` bypasses the cached page; ordinary list reads use cache first.

- [ ] Add failing tests for archive hit, miss-and-store, explicit refresh, tenant/path isolation, empty-page persistence, and non-404 Graph failure.
- [ ] Run `node tests/xero-invoice-archive.test.mjs` and confirm the intended failures.
- [ ] Implement cache helpers and wire `listXeroInvoices` through them.
- [ ] Run the focused test and the existing Xero integration-contract test.

### Task 2: Accounts UI archive visibility

**Files:**
- Modify: `tools/invoices.js`, `tools/invoices.html`, `portal-api.js`
- Test: `tests/xero-invoice-ui.mjs`

**Interfaces:**
- `api.xeroInvoices(tenantId, limit, page, status, refresh)` accepts an optional refresh boolean.
- UI page-load reads display archive-source state; explicit refresh bypasses cached pages and stores refreshed pages.

- [ ] Add failing UI contract assertions for archive status messaging and explicit refresh behavior.
- [ ] Run the focused test and confirm the intended failures.
- [ ] Implement cache/source messaging and explicit refresh wiring while preserving filtering and list rendering.
- [ ] Run focused and Xero integration tests.

### Task 3: Verification and release readiness

**Files:**
- Modify: `cloudflare-worker/README.md`
- Verify: Xero invoice tests, worker tests, `git diff --check`, Worker dry-run/build.

- [ ] Document archive path, cache-miss behavior, refresh semantics, and required Worker Graph configuration.
- [ ] Run all tests appropriate to invoice and archive paths, plus Worker validation.
- [ ] Inspect the diff and confirm no Xero delete behavior or SharePoint delete call was added.
- [ ] Deploy and verify live cache behavior only after code and remote status checks pass.
