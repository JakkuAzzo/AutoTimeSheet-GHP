# GMT responsive public site and Staff Portal design

Date: 2026-10-15
Status: Design approved in conversation; awaiting written-spec review.

## Purpose

Make the public GMT website and Staff Portal comfortable to use on phones, tablets, laptops, large monitors, and short viewports. Content should stay readable and complete, fit the available width, and move naturally between meaningful sections. Smooth scrolling, gentle section snapping, and restrained entrance animations should support navigation without forcing long forms or records into viewport-sized boxes.

## Agreed scope

Apply the presentation and navigation contract to:

- Public marketing pages that use `public-site.css`: the home page, service directory and service detail pages, and repair-process directory and guide pages.
- Staff Portal pages that use `styles.css` and/or `portal.css`: dashboard, timesheets, submissions/history, account, user management, jobs, tasks, tools, calendar, training, and audit screens.

The previously approved “How to reach out” text and image alignment remains part of the work. Its copy must remain complete; layout and type may adapt to fit the image height, but the text must not be truncated.

This is a front-end layout and interaction change. It does not change authentication, permissions, submitted records, form payloads, APIs, or business content.

## Design principles

### Responsive, content-first sizing

- Use fluid type, flexible grids, intrinsic image sizing, and `min-width: 0` so content can shrink and wrap at narrow widths.
- Treat viewport fit as a minimum layout target for suitable presentation sections, not a fixed height. Sections may grow when text, controls, validation messages, or user-selected content need more room.
- Never clip essential copy, controls, calendar details, form results, or focus outlines to make a section match the viewport.
- Keep page-level horizontal overflow out of the design. Existing deliberately scrollable tables and horizontal carousels may retain their own contained scrolling where needed.
- Keep the navigation and anchor targets clear of sticky headers and portal tabs using appropriate scroll offsets.

### Scrolling and section snapping

- Retain smooth in-page navigation where supported, and return to native immediate scrolling when the visitor requests reduced motion.
- Use vertical `proximity` snapping for major public marketing sections. A multi-panel horizontal carousel counts as one vertical destination; do not snap vertically between its individual tabs or cards.
- Use the same gentle snapping only for the Staff Portal dashboard’s top-level overview sections. Do not apply section snapping within timesheet entry, calendars, submission history, user management, tools, jobs, tasks, training, or audit workflows.
- Keep normal scrolling available at every point. Avoid mandatory snap points, fixed-height scroll containers, and nested vertical scroll areas.
- Allow anchor links and keyboard focus to reach their intended section without a snap overriding the target.

### Scroll-triggered animation

- Use restrained, short opacity/position reveals when public sections and portal section/content groups enter view, including on workflow routes.
- Apply motion at section or card-group level rather than to each form field, table row, calendar cell, or live status update. Operational content must not jump as records load or change.
- Keep content visible if JavaScript, `IntersectionObserver`, or animation support is unavailable. Reveal behavior is progressive enhancement and never a prerequisite for reading or using the page.
- Honor `prefers-reduced-motion`: disable reveal transitions and smooth scrolling, and avoid large-distance movement.
- Keep animation independent from the home page’s existing carousel, map, and other page-specific interactions.

## Surface behavior

### Public pages

The shared public stylesheet remains responsible for responsive layout, scroll offsets, and snap points across all marketing templates. The home page’s hero, section groups, and wide content carousels should remain coherent as single destinations. Service and process pages should group related detail cards so snapping does not stop between tightly connected cards. Their content remains naturally scrollable when it exceeds the viewport.

### Staff Portal

The shared portal styles apply responsive width, text, card, and control rules across all portal routes. Section/content-group reveals can run throughout the portal; only the dashboard receives overview-level snap points. Workflow pages use natural page scrolling, with contained horizontal scrolling only for wide tables or similar data views. Responsive changes must not alter the order or availability of controls for any role.

### Previously approved workshop panel

Keep the “How to reach out” introduction and adjacent workshop photo aligned at both ends where the layout allows. On smaller screens, use responsive type and a content-driven row so longer copy expands the row and the image follows it. Preserve all copy and the existing guide/enquiry content below.

## Accessibility and failure behavior

- Preserve semantic section landmarks, heading hierarchy, skip links, keyboard navigation, visible focus, and existing carousel controls.
- Do not rely on animation or snapping to communicate state or make controls usable.
- Preserve browser zoom and text enlargement; layout may become taller and scroll normally.
- If motion or observer code fails, the page remains readable and operable.

## Acceptance criteria

1. All in-scope public and portal pages adapt without essential content being clipped at narrow widths, landscape orientations, short viewports, or 200% browser zoom.
2. Text and controls wrap or reflow without page-level horizontal overflow. Any retained horizontal scrolling is limited to its intended table or carousel container.
3. No essential section, form, preview, calendar, notification, or status region is forced into a fixed viewport height.
4. Public marketing sections and portal dashboard sections use gentle proximity snapping, with normal manual scrolling always available. Portal workflow pages do not snap.
5. Same-page navigation lands below sticky navigation and remains usable with keyboard focus.
6. Reveals work when supported, do not animate individual data rows or form controls, and fail open with all content visible when unsupported.
7. Reduced-motion settings disable smooth scroll and reveal movement.
8. The “How to reach out” copy remains complete and aligned with its adjacent image across responsive widths.
9. No authentication, permissions, data, or form-submission behavior changes as part of this presentation work.

## Validation approach

During implementation, inspect representative public and portal routes at 320×568, 390×844, 768×1024, 1280×720, and 1440×900, including a short landscape viewport and 200% zoom. Check reduced-motion behavior, keyboard navigation, anchor offsets, content loading, and the absence of clipping or page-level horizontal overflow. This specification records the validation expectations; no browser or automated checks have been run for it.

## Approaches considered

1. **Mandatory full-screen snapping and fixed viewport heights everywhere:** rejected because it can clip long copy and disrupt timesheet, calendar, submission, and administrative workflows.
2. **No snapping or shared reveal behavior:** rejected because it does not deliver the requested transitions consistently across the public site and dashboard.
3. **Content-first responsive sizing with proximity snapping on presentation sections and the portal dashboard:** selected. It provides the requested guided movement while retaining natural scrolling for long and interactive work.
