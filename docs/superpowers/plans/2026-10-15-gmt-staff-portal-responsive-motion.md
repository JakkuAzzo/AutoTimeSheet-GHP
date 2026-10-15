# GMT Staff Portal Responsive Layout and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all Staff Portal routes responsive and content-complete, add reduced-motion-aware section reveals, and provide gentle section snapping on the dashboard only.

**Architecture:** Reuse `viewport-effects.js` from the public-site plan for progressive section reveals. Keep portal layout rules in `styles.css`, `portal.css`, and `responsive-tables.css`; apply snap points only to dashboard overview sections. Long workflows retain ordinary page scrolling and their existing record, role, and submission behavior.

**Tech Stack:** Static HTML, CSS, and browser JavaScript; shared `viewport-effects.js`; native CSS scroll snap and `IntersectionObserver`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-gmt-responsive-public-site-and-staff-portal-design.md`

**Dependency:** Implement after Task 1 of `docs/superpowers/plans/2026-10-15-gmt-public-site-responsive-motion.md`, which creates `viewport-effects.js` and its public reveal contract.

## Global Constraints

- Sections use content-driven sizing and may grow when text, controls, validation messages, or user-selected content need more room.
- Essential text, controls, calendar details, focus outlines, form results, and records are never clipped to match the viewport.
- Page-level horizontal overflow is removed; only intended table/data containers may scroll horizontally.
- Use proximity snapping only on the Staff Portal dashboard. Forms, calendars, history, tools, jobs, tasks, and audit screens keep normal scrolling.
- Reveal motion is limited to sections or card groups, never individual fields, table rows, calendar cells, or live status updates.
- Reveals are progressive enhancement, respect `prefers-reduced-motion`, and leave all content visible if JavaScript or `IntersectionObserver` is unavailable.
- Do not change authentication, permissions, record visibility, submitted data, form payloads, or application workflows.

## Review Focus

- Long records, wrapped labels, and validation messages must grow their panels instead of clipping. Check on timesheet entry and submissions in Task 2.
- Short landscape screens must keep controls reachable without viewport-locked forms. Check at 667×375 in Task 2.
- The dashboard carousel must remain one snap destination; its individual slides must not become vertical snap targets. Check in Task 3.
- Auth-hidden portal content must reveal correctly after sign-in; the login state and protected content must remain unchanged. Check after sign-in in Tasks 1 and 4.
- Reduced motion, 200% zoom, and very narrow screens must retain every essential control and record. Check in Task 4.

---

## Scope Inventory

Modify these staff-facing pages, whether they currently use shared styles or have a custom layout:

- Shared portal: `portal/index.html`, `portal/account.html`, `portal/history-frame.html`, `portal/submissions.html`, `portal/timesheets.html`, `portal/users.html`.
- Timesheet routes: `timesheets.html`, `timesheets/create.html`, `timesheets/index.html`, `timesheets/submit-success.html`.
- Other work routes: `account.html`, `audit/index.html`, `calendar/index.html`, `jobs/index.html`, `tasks/index.html`, `tools/estimates.html`, `tools/index.html`, `tools/invoices.html`, `tools/job-card-import.html`, `training/index.html`.

### Task 1: Integrate shared progressive reveals across portal routes

**Files:**
- Consume: `viewport-effects.js` from the public-site plan
- Modify: `portal.css`
- Modify: every HTML file in Scope Inventory
- Modify: `audit/index.html` inline styles only for reveal-compatible visibility and motion rules

**Interface consumed:** `window.GMTViewportEffects.init(root?: ParentNode): void`, with idempotent observation of `[data-scroll-reveal]`, `.is-visible` on entry, and visible fallback for reduced motion or unavailable observation.

- [x] **Step 1: Mark static portal section groups** in each page in Scope Inventory with `data-scroll-reveal`. Keep interactive fields, data rows, calendar cells, and live status messages outside the reveal target list.
- [x] **Step 2: Load the shared reveal helper** with the root-relative asset URL and `defer` on each portal page. Keep the existing Entra sign-in and protected-main reveal sequence intact; after a successful sign-in reveals the protected main, call the helper's idempotent `init(main)` so initially hidden targets are observed in their visible state.
- [x] **Step 3: Add portal reveal styling** to `portal.css` and the audit page’s custom CSS. Keep content visible by default and honor the helper readiness attribute and reduced-motion preference.
- [ ] **Step 4: Check the signed-in transition** on a protected route: after the main content is revealed, confirm every marked section appears and remains accessible; confirm no signed-out or permission state changes.
- [x] **Step 5: Commit** the portal reveal integration as `Add Staff Portal section reveals`.

### Task 2: Make portal workflows responsive and content-safe

**Files:**
- Modify: `styles.css`
- Modify: `portal.css`
- Modify: `responsive-tables.css`
- Modify: `audit/index.html`
- Modify: all workflow and utility pages in Scope Inventory where markup needs a responsive hook

- [x] **Step 1: Review shared shell sizing** in `styles.css`: header, brand block, page width, controls, cards, and mobile breakpoints. Replace fixed content heights with intrinsic sizing or a safe minimum.
- [x] **Step 2: Review workflow layouts** in `portal.css`: timesheet forms and calendars, submissions/history previews, user management, tools, job/task pages, and dashboard content. Reflow columns and controls without changing their order or permissions; give any anchor targets sufficient scroll margin below sticky `.portal-tabs`.
- [x] **Step 3: Keep data access usable** in `responsive-tables.css`: remove page-level overflow while preserving only intentionally contained horizontal scrolling; keep mobile labeled-row behavior intact.
- [x] **Step 4: Make the audit checker and timesheet success page follow the same contract.** Keep audit-specific behavior and styles scoped; add shared portal styles only where they do not conflict with its inline rules. Keep the submission success message complete and visible.
- [ ] **Step 5: Visually review** the dashboard, timesheet entry and history, submissions, user management, audit, tools, and calendar at 320×568, 390×844, 667×375, 768×1024, 1280×720, and 1440×900, including 200% zoom. Correct clipped controls, content, and page-level horizontal overflow.
- [x] **Step 6: Commit** the portal responsive-layout changes as `Improve Staff Portal viewport fit`.

### Task 3: Add gentle snapping to dashboard overview sections only

**Files:**
- Modify: `portal/index.html`
- Modify: `portal.css`

- [x] **Step 1: Identify the dashboard root** with an explicit class on the document element; add `data-scroll-snap` only to the clock-in overview, quick actions, and shared calendar sections.
- [x] **Step 2: Add root-scroller proximity snapping** in `portal.css` for the dashboard document class. Keep each dashboard carousel (clock-in; updates/work board) as one vertical destination and do not add snap points inside a slide. Set dashboard scroll padding and section margins so headers and focused targets remain visible.
- [x] **Step 3: Respect viewport changes and reduced motion** by keeping dashboard sections content-sized, disabling snap/reveal movement when reduced motion is requested, and retaining normal scroll gestures.
- [ ] **Step 4: Check dashboard navigation** by touch, wheel, keyboard, carousel controls, and same-page links at phone, desktop, and short landscape sizes. Confirm no snap can trap the user between overview sections.
- [x] **Step 5: Commit** the dashboard snap behavior with the integrated responsive update.

### Task 4: Update portal asset versions and review the final diff

**Files:**
- Modify: all portal HTML files in Scope Inventory
- Review: `styles.css`, `portal.css`, `responsive-tables.css`, `viewport-effects.js`, and portal HTML changes

- [x] **Step 1: Update version query parameters** for the shared portal CSS, responsive table assets, and reveal helper wherever loaded.
- [x] **Step 2: Review the final diff** for all routes in Scope Inventory, accidental changes to protected workflows, hidden content when motion is disabled, and snap rules leaking onto workflow pages.
- [x] **Step 3: Commit** the portal asset-version updates with the integrated responsive update.

## Delivery Boundary

This plan ends with a locally reviewed implementation. It does not merge or deploy the Staff Portal; deployment requires a separate explicit release step.

The protected dashboard and workflows redirect to Microsoft Entra in the local preview, so authenticated visual checks in Tasks 1–3 remain open. No account, permissions, records, or workflows were changed.
