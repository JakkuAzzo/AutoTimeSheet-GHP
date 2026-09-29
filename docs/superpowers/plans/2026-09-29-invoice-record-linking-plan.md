# Invoice and GMT Record Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the protected Accounts invoice workspace easier to use and expose reliable two-way linking between Xero invoices, GMT job cards, and estimates.

**Architecture:** Keep Xero as the financial source of truth and extend the existing Cloudflare Worker/API contracts only for reverse lookup, search, and link management. Upgrade the existing invoices page and the existing job-card/estimate views without replacing their authentication or record-access gates.

**Tech Stack:** Cloudflare Worker, D1 migrations, vanilla HTML/CSS/JavaScript, existing portal API helpers, Node contract tests, Wrangler deployment checks.

**Spec:** `docs/superpowers/specs/2026-09-29-invoice-record-linking-design.md`

## Global Constraints

- Invoice create, edit, send, delete, and link changes are Accounts-administrator-only.
- Xero remains the financial source of truth; GMT stores links, projections, and audit history.
- Failed Xero mutations must not create partial GMT link state.
- Preserve existing authentication, record-access checks, and responsive portal styling.
- Keep unrelated untracked files untouched.

## Review Focus

- A non-Accounts user attempts invoice mutation or link changes: Worker returns 403 and the UI preserves the current view.
- A linked invoice is opened from a job card or estimate: the reverse lookup shows current Xero status and does not duplicate links.
- A link is removed while Xero is unavailable: GMT link state and audit behavior remain explicit and consistent.
- A large invoice register is searched or filtered on mobile: controls remain usable and rows remain legible.
- A Xero invoice has a missing number, deleted status, or no linked record: the UI renders a stable fallback and clear empty state.

### Task 1: Map current records and define reverse-link contracts

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Modify: `portal-api.js`
- Test: `tests/xero-integration-contract.mjs`

**Interfaces:**
- Produce `GET /api/xero/invoices/:invoiceId/links` returning `{ links, audit }`.
- Produce `GET /api/records/:kind/:recordId/invoices` returning `{ invoices, links }` for `estimates` and `job-cards`.
- Preserve existing `POST /api/xero/invoices/:invoiceId/links` semantics and deduplicate `(invoiceId, recordKind, recordId)`.

- [ ] Add failing contract assertions for both reverse-link routes, deduplication, and Accounts authorization.
- [ ] Run `node tests/xero-integration-contract.mjs` and confirm the new assertions fail.
- [ ] Implement the smallest Worker/API additions using the existing D1 invoice-link and audit tables.
- [ ] Run the contract test and confirm it passes.
- [ ] Commit `feat: add reverse invoice link contracts`.

### Task 2: Build the usable invoice workspace

**Files:**
- Modify: `tools/invoices.html`
- Modify: `tools/invoices.js`
- Modify: `portal.css`
- Test: `tests/xero-invoice-ui.mjs`

**Interfaces:**
- Consume the reverse-link helpers from Task 1.
- Produce a selected-invoice state with searchable register, link summary, audit panel, and mutation controls.

- [ ] Add failing static tests for search/filter controls, selected invoice detail rendering, link add/remove controls, and mobile table labels.
- [ ] Implement debounced invoice search, status/customer filters, selected-row highlighting, and explicit loading/empty/error states.
- [ ] Replace the long multi-select with a searchable record picker that groups estimates and job cards and shows existing links.
- [ ] Add linked-record chips with remove/open actions and preserve unsaved editor values on errors.
- [ ] Add responsive CSS so register and detail panes stack cleanly on narrow screens.
- [ ] Run UI contract/static tests and syntax checks.
- [ ] Commit `feat: improve protected invoice workspace`.

### Task 3: Add reverse invoice panels to job cards and estimates

**Files:**
- Modify: `tools/job-cards.html`
- Modify: `tools/job-cards.js`
- Modify: `tools/estimates.html`
- Modify: `tools/estimates.js`
- Modify: `portal.css`
- Test: `tests/xero-invoice-ui.mjs`

**Interfaces:**
- Consume `GET /api/records/:kind/:recordId/invoices` and existing link mutation helpers.
- Produce invoice link panels showing number, status, total, amount due, and invoice workspace URL.

- [ ] Add failing assertions that both record detail views render an invoice-link section and Accounts-only attach/detach controls.
- [ ] Implement shared rendering and attach/detach behavior without duplicating invoice data logic.
- [ ] Add empty, forbidden, disconnected, and duplicate-link states.
- [ ] Run the UI tests and verify existing job-card/estimate flows still pass.
- [ ] Commit `feat: expose invoice links on GMT records`.

### Task 4: End-to-end verification and release

**Files:**
- Modify: `tests/cloudflare-worker-deployment-workflow.mjs` only if deployment checks need new routes.
- Modify: `package.json` only if a focused test script is needed.

- [ ] Run `npm run test:xero:integration-contract` and the new invoice UI test.
- [ ] Run Worker syntax checks, `npx wrangler deploy --dry-run --config cloudflare-worker/wrangler.toml`, and `git diff --check`.
- [ ] Build Pages with `node tools/build-cloudflare-pages.mjs ./dist/gmt-pages` and remove only the generated directory afterward.
- [ ] Push the feature branch, open a pull request, merge to `main`, verify `origin/main`, and delete the obsolete branch while preserving unrelated work.
- [ ] Verify the Cloudflare Pages deployment, public invoice/jobs/estimate routes, protected Worker route, and authenticated Accounts link flow.
- [ ] Report any GitHub runner or provider limitation separately from code/test results.
