# GMT Staff Portal Task-First Redesign Implementation Plan

**Goal:** Reorder the shared staff portal around daily staff tasks and make its tool routes easier to navigate without changing role permissions or provider workflows.

**Architecture:** Retain the existing native HTML, CSS and JavaScript surfaces. Replace the dashboard carousel with a visible task-first sequence, keep current data loading and personal statistics, and group existing role-gated tool links by task area.

**Tech Stack:** Native HTML/CSS/JavaScript, existing portal API and Playwright tests.

**Spec:** `docs/superpowers/specs/2026-10-26-gmt-portal-task-first-redesign-design.md`

## Global Constraints

- Keep current forms, history pages, deep links and provider integrations available from an obvious route.
- Do not broaden access or create role-specific navigation semantics.
- Use existing authorized profile and history responses; add no statistics endpoint or protected local storage.
- Phones and tablets remain responsive and content-sized; laptops and desktops retain normal document flow.

## Review Focus

- Task and quick-action content stays visible without carousel interaction or JavaScript success.
- Role-gated tools remain hidden while access is unknown and visible only for authorized roles.
- Personal statistics remain filtered to the signed-in identity and keep unavailable distinct from empty.
- Existing routes and deep links still resolve.
- Large calendars and tool lists remain readable without desktop fixed-height or clipping behavior.

---

### Task 1: Task-first dashboard

**Files:** `portal/index.html`, `portal/dashboard-updates.js`, `portal.css`, `tests/dashboard-tools-navigation.browser.mjs`, `tests/dashboard-updates-smoke.mjs`.

- [x] Add browser assertions for page order: Today, Quick actions, My work, My statistics, Shared calendar; assert no carousel controls or hidden task/stat panels.
- [x] Replace carousel markup with visible sections while preserving the existing clock form, task board, notifications and statistics IDs consumed by scripts.
- [x] Remove slide-navigation behavior while retaining protected data loading, retry controls, access checks and accessible announcements.
- [x] Move the calendar preview below My work and make it compact, retaining its full dedicated route and filters.
- [x] Re-run `npm run test:portal:navigation`, `npm run test:dashboard-updates` and `npm run test:viewport-fit`.

### Task 2: Group Tools by staff workflow

**Files:** `tools/index.html`, `portal.css`, `tests/dashboard-tools-navigation.browser.mjs`.

- [x] Add checks that tool cards are grouped under Time and attendance, Workshop work, and Accounts.
- [x] Keep existing tool-card selectors and access-controller behavior inside their relevant groups; add links only to existing routes.
- [x] Verify internal routes resolve and role access remains unchanged with `npm run test:portal:navigation`.

