# GMT Portal Identity and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the verified Worker role configuration, preserve the existing Entra administrator group path, and prove that saved profile names flow into clock-in and weekly timesheet forms.

**Architecture:** Keep full administrator access in the Worker identity configuration and group-claim check. Keep HR and Xero grants separate from full administrator access, and keep account display names in the existing profile service and form prefill events.

**Tech Stack:** Cloudflare Worker, vanilla JavaScript, Node.js, Playwright.

**Spec:** Delegated task prompt in Codex task `01a10d71-8e6e-7571-baa7-b57b32d8288b`; there is no repository-local spec file.

## Global Constraints

- Verify identity mappings from the existing Worker or Entra configuration before changing access.
- Preserve existing `ADMIN_UPNS`, `ADMIN_OIDS`, and `ADMIN_GROUP_IDS` authorization paths.
- Faith, Amanda, and configured Accounts identities require full administrator access; Michelle and Lidia require HR and Xero access without full administrator access; other staff retain least privilege.
- Keep shared Worker authorization code unchanged while the Estimates workstream owns that surface; report any required shared-policy change for integration.
- D1 role assignments may grant only `hr`, `xero`, `operations`, and `job-card`.
- Do not place sensitive UPNs or secrets in public client assets.
- Use only synthetic identities and records in local checks; do not make production writes, send messages, merge, or deploy.

## Review Focus

- An HR or Xero assignment must not imply full administrator access; cover API and UI allow/deny paths.
- A matching Entra administrator group claim must continue to grant full administrator access.
- Full administrators and existing Operations users can read shared estimate-history records; HR/Xero-only users and ordinary staff cannot read other employees' estimates.
- The estimate archive endpoint remains full-admin-only; call out any need to widen that shared policy separately.
- Identity names must not be used as a substitute for verifying an exact Worker/Entra identity mapping.
- Late profile hydration must update blank or default clock and timesheet fields without replacing a protected employee identity in an administrative edit.
- Saved display names and role allowlists must remain out of the public client bundle.

### Task 1: Worker role matrix and access gates

**Files:**
- Modify: `cloudflare-worker/wrangler.toml`
- Create: `tests/portal-role-access.mjs`
- Test: `tests/portal-role-access.mjs`

**Interfaces:**
- Consumes: `tokenIdentity`, `canViewAllRecords`, `canReadHistoryRecord`, and `listRecords` from the Worker plus the current `portal/users.js` / `tools/access-ui.js` role gates.
- Produces: A role matrix covering full admin, HR, Xero, Operations, ordinary staff, shared estimate-history reads, and full-admin-only user-management/archive gates.

- [x] **Step 1: Write the role matrix and API-scope tests.** Assert Faith and the existing Worker-configured Accounts identity are full admins; model Amanda and the second Accounts identity with synthetic group/config claims; assert Michelle and Lidia have HR plus Xero and no full admin; assert ordinary staff have no elevated roles; assert full admins and Operations can read shared estimate history while HR/Xero-only and ordinary staff cannot; assert the archive API and admin-user API remain full-admin-only and Xero API handlers remain Xero-gated.
- [x] **Step 2: Run the role test before changing configuration.** It failed because Faith was missing from the Worker admin allowlist.
- [x] **Step 3: Add Faith's already-verified Worker directory identity to the additional Worker admin allowlist while retaining the configured Accounts identity; do not edit the shared Worker authorization implementation or group configuration.**
- [x] **Step 4: Extend the same test to exercise the user-management, estimate archive, and Xero API allow/deny states; exercise the user-management and Xero UI states; and verify role configuration remains absent from public client assets.**
- [x] **Step 5: Run `node tests/portal-role-access.mjs`, `node tests/job-card-access-policy.mjs`, `node tests/xero-integration-contract.mjs`, `node tests/timesheet-admin-completion.mjs`, and `node tests/timesheet-admin-ui.mjs`; record the results.**

### Task 2: Saved profile name propagation

**Files:**
- Create: `tests/portal-profile-prefill.mjs`
- Modify: `timesheet-clock.js` or `script.js` only if the new coverage finds a real propagation defect

**Interfaces:**
- Consumes: The saved `gmt.portal.profile.v1` record and the existing `gmtportalidentity` / `gmtportalprofile` events.
- Produces: Clock-in and weekly timesheet forms prefilled from the saved display name, while protected employee edits keep their record identity.

- [x] **Step 1: Write a browser check that loads a synthetic saved profile and verifies its display name fills both clock-in and weekly timesheet fields, including a late profile event and a protected edit.**
- [x] **Step 2: Run `node tests/portal-profile-prefill.mjs`; the existing form propagation and protected edit guard passed, so no production form changes were needed.**
- [x] **Step 3: Preserve the existing profile prefill path and protected-record edit guard.**
- [x] **Step 4: Run `node tests/portal-profile-prefill.mjs`, `node tests/profile-settings.mjs`, and `node tests/timesheet-clock-routing.mjs`; record the results.**
