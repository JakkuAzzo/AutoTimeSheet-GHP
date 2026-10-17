# Estimate Drafting, Archive and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the authenticated estimate workflow from preview through protected filing and administrator-only delivery, with searchable message and attachment associations and explicit delivery status.

**Architecture:** Keep document rendering in the portal, archive payloads in the Worker and SharePoint, and email delivery behind the existing approved Flow endpoint. Keep the full estimate archive, app archive filing, estimate index, and client delivery administrator-only; preserve the current protected-record read rules and document the UI/role mismatch for Identity/Permissions.

**Tech Stack:** Browser JavaScript, Cloudflare Worker modules, D1 migrations, Node.js contract tests, Playwright browser tests.

**Spec:** `docs/estimate-workflow-contract.md` and `docs/integrations/estimate-mail-sharepoint-flow.md`, plus the coordinator's estimate workflow request.

## Global Constraints

- Use synthetic estimate data and `accounts@gmt-services.co.uk` for controlled send-path checks.
- Never contact customers or ordinary staff; do not make Xero financial writes.
- Do not deploy or change provider configuration; the coordinator runs the integrated release gate.
- Preserve current Worker record-read and archive role checks; document any mismatch for the Identity/Permissions workstream.
- Keep client delivery administrator-only, require a matching protected estimate record and archive item, and do not retry uncertain deliveries automatically.

## Review Focus

- Missing or wrong-tenant identity must not read archive data or files; cover with the existing 401 route checks.
- Archive/search must remain inside the current protected role boundary and redact provider details; cover administrator access and non-admin denial in `tests/estimate-archive.test.mjs`.
- An authenticated user may not archive another user's estimate; add an owner-mismatch check in `tests/estimate-archive.test.mjs`.
- A non-admin must not trigger the delivery Flow, even with a valid delegated Flow token; cover in `tests/estimate-send.test.mjs`.
- A missing or ambiguous Flow result must remain visibly unresolved and must not be retried automatically; retain the existing send status behavior and exercise the success path in the browser test.

---

### Task 1: Make estimate contract checks portable and policy-specific

**Files:**
- Modify: `tests/estimate-archive.test.mjs`
- Modify: `tests/estimate-send.test.mjs`

**Interfaces:**
- Consumes: Existing Worker routes `/api/archive/estimates`, `/api/archive/estimates/app`, `/api/estimates/send`, and `/api/estimates/index`.
- Produces: Tests that distinguish the current archive role policy from administrator-only delivery, use the approved internal synthetic recipient, and work from checkout paths containing spaces.

- [x] Update the send fixture to an Accounts administrator and assert a separately signed non-admin request gets 403 without reaching the Flow.
- [x] Run `npm run test:estimate-send` and confirm the administrator request passes while the non-admin denial is covered.
- [x] Set the archive route fixture to its configured administrator, add a separate non-admin denial check, and preserve provider-field redaction assertions.

### Task 2: Preserve protected estimate access and validate app ownership

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Modify: `tests/estimate-archive.test.mjs`
- Modify: `docs/estimate-workflow-contract.md`
- Modify: `docs/integrations/estimate-mail-sharepoint-flow.md`

**Interfaces:**
- Consumes: Signed-in tenant identity and existing `records`, `archive_messages`, and `archive_attachments` stores.
- Produces: App archive filing limited to the caller's own protected estimate record, plus a documented integration finding for existing estimate read-role behavior.

- [x] Add a test that app filing with a missing or foreign protected record is rejected before SharePoint upload.
- [x] Validate `source_record_id` belongs to the authenticated caller and is an estimate before uploading the app archive attachment; leave read-role checks unchanged.
- [x] Document the exact `requireEstimateArchiveAccess`, `canAccessRecord`, `canReadHistoryRecord`, and `listRecords` role behavior as an Identity/Permissions integration finding.
- [x] Run the archive contract and record the existing role boundary, file redaction, message association, and ownership results.

### Task 3: Verify the browser estimate workflow and delivery status

**Files:**
- Modify: `tests/estimate-archive-browser-ui.mjs`
- Modify: `tools/estimates.js` only if the browser test exposes a workflow defect.

**Interfaces:**
- Consumes: Estimate form, live client preview, archive API methods, and `sendEstimate` API method.
- Produces: A browser test proving preview content, protected archive-before-send ordering, internal recipient routing, and visible confirmed-send status without external effects.

- [x] Extend the mocked browser scenario with clearly labelled GMT internal test data and `accounts@gmt-services.co.uk` as recipient.
- [x] Verify preview totals and that archive filing precedes the send call with the document attached.
- [x] Verify the user-facing status is shown only after the mocked Worker confirms the send.
- [x] Run `npm run test:estimates:archive-ui`.

### Task 4: Final verification and separate pull request

**Files:**
- Review the complete branch diff and update this plan's checkboxes.

- [x] Run all focused estimate contract and browser tests plus `git diff --check`.
- [x] Confirm production providers and deployment were not changed.
- [x] Commit the scoped changes on `codex/estimate-drafting-archive-send` and open a separate pull request against `main`.
- [x] Report the live-send blocker precisely: the connected Outlook identity is personal rather than GMT, so the live Flow path was not attempted or verified.
