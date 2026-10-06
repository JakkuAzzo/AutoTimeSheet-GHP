# GMT Staff Timesheet Responsive Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily timesheet entry readable at desktop sizes and usable on mobile without horizontal scrolling inside a day row.

**Architecture:** Keep the existing dynamic day-card markup, `data-field` selectors, calculations, validation, draft behavior, and submission payload. Rebuild the layout in `styles.css` as a single vertical list of full-width day cards whose input grid reflows from one desktop row to two mobile columns.

**Tech Stack:** Static HTML, CSS, existing vanilla JavaScript, Playwright browser regression scripts.

**Spec:** `docs/superpowers/specs/2026-10-06-gmt-timesheet-jobcard-archive-design.md`

## Global Constraints

- Keep the existing timesheet calculation, validation, draft, absence, and submission behavior.
- Keep the existing form fields and `data-field` selectors.
- Do not add an independently scrolling region to each row.
- Preserve keyboard access, explicit input labels, visible focus, and touch targets of at least 40 CSS pixels.
- Verify visually at 320, 375, 768, 1024, and 1440 CSS pixel widths.

## Review Focus

- At 320 CSS pixels, native date/time inputs must stay inside the card; test every input bounding box against the viewport in Task 1.
- At 375 CSS pixels, two-column mobile controls must remain labeled and not overlap; test label/input geometry in Task 1.
- At 768 and 1024 CSS pixels, rows must wrap before text or actions become clipped; test the layout at both widths in Task 1.
- At 1440 CSS pixels, each date/start/finish/break/status/action group must be legible in the full-width list; test minimum label and control widths in Task 1.
- Collapse, remove, and disabled absence fields must remain operable after reflow; retain and run the existing daily calculation and future-date browser tests in Task 2.

---

### Task 1: Pin the responsive layout with a browser test

**Files:**
- Create: `tests/timesheet-entry-responsive.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `/timesheets/create.html`, its existing `.day-card` markup, and the existing Playwright installation.
- Produces: `npm run test:timesheets:responsive-entry`, which launches the form with test authentication disabled and checks the layout at five viewport widths.

- [x] **Step 1: Write the failing test**

Create Playwright viewport cases at 320, 375, 768, 960, 1024, and 1440 pixels. Generate a five-day week and assert that `.timesheet-grid` and each `.day-card` have no horizontal overflow, every `[data-field]` input/select and action button stays within the viewport, label text remains visible without overlapping its control, and the desktop date/time controls have at least 96 CSS pixels of width.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:timesheets:responsive-entry`

Expected: FAIL at 320 or 375 pixels because the existing 57.5rem grid exceeds the viewport.

---

### Task 2: Reflow day cards and verify the existing timesheet contract

**Files:**
- Modify: `styles.css`
- Test: `tests/timesheet-entry-responsive.mjs`
- Regression tests: `tests/timesheet-daily-calculation.mjs`, `tests/timesheet-future-ui.mjs`, `tests/timesheet-long-break.mjs`, `tests/timesheet-email-routing.mjs`

**Interfaces:**
- Consumes: the `.day-card`, `.day-card-header`, `.day-card-body`, `.day-grid`, `.additional-fields`, `.day-result`, and `.days-container` structure created by `script.js`.
- Produces: a full-width, one-day-per-row layout at desktop widths; a wrapping two-column controls grid on mobile; no horizontal scrolling on `.timesheet-grid` or `.days-container`.

- [x] **Step 1: Implement the minimum responsive CSS**

Remove the 57.5rem minimum widths and horizontal overflow from the timesheet grid. Override the old `display: contents` layout so day-card header/body are actual grid children. Use one `.day-card` per `.days-container` row, with date/start/finish/break/absence controls on one desktop line where space allows. At 640 CSS pixels and below, place controls in two columns, switching to one column only when the available card width cannot fit two 40-pixel-high controls. Keep the result and optional notes on full-width rows.

- [x] **Step 2: Run the responsive browser test and confirm GREEN**

Run: `npm run test:timesheets:responsive-entry`

Expected: PASS at all six viewport widths with no horizontal overflow, including the 960px breakpoint check.

- [x] **Step 3: Run calculation, absence, break, and submission regressions**

Run:

```bash
node tests/timesheet-daily-calculation.mjs
node tests/timesheet-future-ui.mjs
node tests/timesheet-long-break.mjs
node tests/timesheet-email-routing.mjs
```

Expected: all four scripts pass with the existing calculation totals and submission fields unchanged.

- [x] **Step 4: Review the page visually at all required widths**

Capture the timesheet form at 320, 375, 768, 960, 1024, and 1440 CSS pixels. Confirm labels, controls, status/result, collapse/remove actions, and totals are legible, aligned, and not clipped. Fix any defects and rerun the focused plus regression tests.

- [x] **Step 5: Commit the verified UI change**

```bash
git add styles.css tests/timesheet-entry-responsive.mjs package.json
git commit -m "fix: make timesheet entry responsive"
```
