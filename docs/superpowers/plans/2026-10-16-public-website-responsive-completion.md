# Public Website Responsive Completion Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and complete responsive behavior across all public GMT marketing routes, including viewport fit, section boundaries, smooth scrolling, snap behavior where sections fit, reduced motion, overflow, and enquiry completion feedback.

**Architecture:** Keep layout and scroll behavior in the shared public stylesheet and `viewport-effects.js`, with route-specific markup generated from the existing marketing page source. Exercise the static public routes in a local browser matrix; exercise enquiry success and failure through a mocked endpoint so no message leaves the worktree.

**Tech Stack:** Static HTML/CSS, browser JavaScript, Node.js, Playwright Chromium, existing Node assertion scripts.

**Spec:** `docs/superpowers/specs/2026-10-16-public-website-responsive-completion.md`

## Global Constraints

- Cover public routes at phone portrait and landscape, tablet, laptop, and desktop sizes.
- Keep full content reachable without horizontal overflow or clipped sections.
- Respect reduced-motion preferences and use snapping only where content permits.
- Use mocked or staging submission behavior; do not send real customer enquiries.
- Do not merge or deploy; commit the feature branch and open a separate PR.

## Review Focus

- Long content and open enquiry controls remain reachable inside short landscape viewports.
- Section snapping does not obstruct anchor navigation or internal carousel movement.
- Reduced motion disables smooth scrolling, reveal transitions, and snapping.
- A provider response that reports failure never shows the success confirmation.
- A successful enquiry shows a durable, accessible confirmation after the form is hidden.

---

### Task 1: Public viewport and scroll behavior

**Files:**
- Inspect: `public-site.css`, `viewport-effects.js`, generated marketing routes.
- Test: `tests/viewport-fit-responsive.mjs`.

**Interfaces:**
- Consumes the existing public route markup and `data-scroll-snap` conventions.
- Produces verified route-by-viewport results for the existing public and portal pages.

- [x] Check the public route matrix at 320×568, 390×844, 667×375, 768×1024, 1280×720, and 1440×900; add a failing regression assertion first for each reproduced gap.
- [x] The public matrix found no viewport, smooth-scroll, snap, clipping, overflow, or reduced-motion gap, so no layout production change was needed.
- [x] Run `npm run test:public-site-responsive` and `npm run test:marketing:contract`.
- [x] Commit responsive behavior and its regression coverage.

### Task 2: Enquiry completion and confirmation

**Files:**
- Modify if needed: `public-site-mapfix-20260928.js`, `index.html`.
- Create: `tests/public-enquiry-completion.mjs`.
- Modify: `package.json` to expose the focused browser check.

**Interfaces:**
- Consumes `window.GMT_APP_CONFIG.contactFormSubmitEndpoint` and the existing enquiry status element.
- Produces accessible success/error feedback while retaining retry behavior after failure.

- [x] Write browser coverage for a successful mocked submit, an unsuccessful mocked response, and a network failure; verify the success state remains associated with the confirmation status and no production endpoint is contacted.
- [x] Run the new check and confirm explicit provider failure incorrectly showed success before implementation.
- [x] Parse the AJAX JSON response and keep the form retryable when it explicitly reports failure.
- [x] Run the new enquiry check and `npm run test:marketing:contract`.
- [x] Commit enquiry completion behavior and its regression coverage.
