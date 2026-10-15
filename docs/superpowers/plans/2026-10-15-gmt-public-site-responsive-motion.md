# GMT Public Site Responsive Layout and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make every public marketing page responsive and content-complete, with smooth in-page navigation, gentle section snapping, and reduced-motion-aware section reveals.

**Architecture:** Keep page layout and snapping in the existing shared `public-site.css`. Add a small progressive-enhancement helper, `viewport-effects.js`, to reveal explicitly marked sections; retain `public-site-mapfix-20260928.js` for homepage-only carousel and map behavior. Public pages identify snap and reveal targets in markup; content stays visible if the helper cannot run.

**Tech Stack:** Static HTML, CSS, and browser JavaScript; native CSS scroll snap and `IntersectionObserver`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-gmt-responsive-public-site-and-staff-portal-design.md`

## Global Constraints

- Sections use content-driven sizing and may grow when text, controls, or validation messages need more room.
- Essential text, controls, focus outlines, and images are never clipped to match the viewport.
- Page-level horizontal overflow is removed; only intended table or carousel containers may scroll horizontally.
- Use proximity snapping, keep normal scrolling available, and do not use fixed-height scroll containers or mandatory snap points.
- Reveal motion is limited to sections or card groups, is progressive enhancement, and respects `prefers-reduced-motion`.
- The “How to reach out” copy remains complete and aligned with its adjacent image.
- Do not change application logic, APIs, form payloads, authentication, permissions, records, or public copy.

## Review Focus

- Narrow screens and long headings must wrap without clipping or page-level horizontal overflow. Check at 320×568 and 390×844 in Task 3.
- Short landscape viewports must retain natural vertical scrolling and usable snap stops. Check at 667×375 in Task 2.
- Disabled `IntersectionObserver` and reduced-motion settings must leave all content visible. Check in Task 1.
- Sticky navigation must not cover anchor or snap targets. Check same-page links and direct hash loads in Task 2.
- Switching the existing horizontal carousels must not create nested vertical snap points or hide active content. Check in Task 2.

---

## Scope Inventory

Modify the shared public stylesheet `public-site.css` and these public HTML templates:

- Home: `index.html`.
- Service directory: `services/index.html`.
- Service details: `services/ac-motor-rewinding-uk/index.html`, `services/balancing/index.html`, `services/breakdown-enquiries/index.html`, `services/component-manufacturing/index.html`, `services/dc-motor-rewinding-london/index.html`, `services/electric-motor-rewinds-croydon/index.html`, `services/electrical-motor-repair/index.html`, `services/extractor-fan-repairs-restaurants/index.html`, `services/fan-repairs-croydon/index.html`, `services/gearbox-repairs-south-london/index.html`, `services/on-site-engineering/index.html`, `services/pump-repairs-london/index.html`, `services/testing-diagnostics/index.html`.
- Repair-process directory: `process/index.html`.
- Repair-process guides: `process/electric-motor-repair/index.html`, `process/fan-extractor-servicing/index.html`, `process/gearbox-refurbishment/index.html`, `process/pump-repair/index.html`.

### Task 1: Add progressive section reveals

**Files:**
- Create: `viewport-effects.js`
- Modify: `public-site.css`
- Modify: `public-site-mapfix-20260928.js` to remove its legacy homepage-only reveal observer after shared reveal targets are marked
- Modify: `index.html`
- Modify: `tools/generate-public-marketing-pages.mjs` and regenerate the service and process pages in the Scope Inventory
- Modify: `tools/build-cloudflare-pages.mjs` to include the shared helper in the deployment bundle

**Interface:**
- `window.GMTViewportEffects.init(root?: ParentNode): void`
- Watches `[data-scroll-reveal]` within `root`, adding `.is-visible` once a target enters view. A `defer` script auto-initializes after parsing; `init(root)` remains available for later content and repeated calls do not duplicate observations.
- Measures the sticky `.site-nav-bar` height into `--gmt-scroll-offset`, updating it when the bar resizes; public CSS has a safe fallback when measurement is unavailable.
- When reduced motion is requested or `IntersectionObserver` is unavailable, targets remain visible without movement.
- The readiness attribute that enables initial reveal styling is added only after initialization succeeds; pages without JavaScript keep their content visible.

- [x] **Step 1: Implement the shared reveal helper** in `viewport-effects.js` with the interface above, one-time observation, null-safe root handling, visible fallback behavior, and sticky-nav offset measurement where `.site-nav-bar` exists. Remove the old `initRevealAnimations` observer and its call from `public-site-mapfix-20260928.js` so the shared helper owns homepage reveal behavior.
- [x] **Step 2: Add progressive reveal styling** to `public-site.css`; keep targets visible by default and animate only explicitly marked sections/card groups after helper readiness.
- [x] **Step 3: Mark home-page section groups and the two complete content-carousel wrappers** in `index.html`; update the service/process page generator to mark each page hero, grouped details, related content, and CTA, then regenerate those pages. Load the helper with `defer` on every public page. Do not mark individual form controls, table rows, or carousel panels/tabs.
- [x] **Step 4: Include the shared helper in the Cloudflare Pages bundle** by adding it to the explicit asset list in `tools/build-cloudflare-pages.mjs`; confirm the generated bundle contains it and all public pages reference it.
- [x] **Step 5: Review fallback behavior** by checking pages with reduced motion enabled and with `IntersectionObserver` unavailable; confirm content remains visible and usable.
- [x] **Step 6: Commit** the helper and public integration as `Add public page section reveals`.

### Task 2: Add smooth section navigation and proximity snapping

**Files:**
- Modify: `public-site.css`
- Modify: `index.html`
- Modify: `services/index.html` and service detail pages listed above
- Modify: `process/index.html` and process guide pages listed above

- [x] **Step 1: Mark major vertical snap targets** in public markup: the hero, top-level section groups, and each complete horizontal content carousel as one target. For detail pages, mark the hero, grouped details, related content, and CTA.
- [x] **Step 2: Add the public scroll contract** in `public-site.css`: smooth scrolling, `y proximity` snap on the document scroller, target alignment, and sticky-navigation-aware offsets. Do not add snap points to nested carousel panels.
- [x] **Step 3: Keep hash navigation and focus in view** by using `--gmt-scroll-offset` for document scroll padding and target scroll margin; preserve the existing sticky-nav behavior.
- [x] **Step 4: Check anchors, snap stops, and carousel changes** at desktop, phone, and short landscape sizes. Confirm normal wheel, touch, and keyboard scrolling can pass every snap point.
- [x] **Step 5: Commit** the public snapping changes as `Add public section proximity snapping`.

### Task 3: Complete responsive sizing and align the workshop panel

**Files:**
- Modify: `public-site.css`
- Modify: `index.html` (preserve the existing cache-busting update)
- Modify: the public HTML templates in Scope Inventory only if markup needs a targeted responsive hook

- [x] **Step 1: Review fixed dimensions and overflow rules** used by the hero, navigation, service/process cards, contact section, maps, story panel, and workshop panel. Replace viewport-locked content dimensions with intrinsic sizing or a content-safe minimum; keep intentional image crops and bounded media panels.
- [x] **Step 2: Preserve the approved workshop text/image alignment** already present in the working tree. Adjust fluid type and row sizing only where needed so the complete intro copy and photo remain aligned without truncation on narrow screens.
- [x] **Step 3: Reflow navigation, grids, cards, and image/caption pairs** at narrow widths and short landscape heights; verify focus rings and sticky navigation remain visible.
- [x] **Step 4: Visually review** representative home, service-directory, service-detail, process-directory, and process-guide pages at 320×568, 390×844, 667×375, 768×1024, 1280×720, and 1440×900, including 200% zoom and reduced motion. Record and fix any clipping or page-level overflow.
- [x] **Step 5: Commit** the responsive sizing changes as `Improve public page viewport fit`.

### Task 4: Update public asset versions and review the final diff

**Files:**
- Modify: public HTML files in Scope Inventory
- Modify: `tools/generate-public-marketing-pages.mjs`
- Review: `public-site.css`, `viewport-effects.js`, and the public HTML changes

- [x] **Step 1: Update version query parameters** for the shared public CSS and reveal helper in `index.html` and the page generator, regenerate generated pages, and confirm each page references the current assets.
- [x] **Step 2: Review the final diff** for missed public templates, unintended content edits, duplicate reveal selectors, mandatory snapping, and changes outside the approved presentation scope.
- [x] **Step 3: Commit** the cache-version updates as `Refresh public responsive asset versions`.

## Delivery Boundary

This plan ends with a locally reviewed implementation. It does not merge or deploy the public site; deployment requires a separate explicit release step.
