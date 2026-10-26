# GMT Staff Portal Task-First Redesign — Design

## Intent

Make the shared staff portal easier to use by surfacing frequent day-to-day staff actions first while preserving existing accounts, role boundaries, tool routes, and provider workflows.

## Selected approach

Use one shared task-first portal for all roles, with day-to-day staff tasks as the priority. Keep the existing native HTML, CSS, and JavaScript design system. Separate role-specific home pages were considered but would duplicate dashboard flows; a light tidy-up would leave important actions spread across slides, cards, and a large dashboard calendar.

## Dashboard structure

Replace the three-slide carousel with a clear page in this order:

1. **Today:** signed-in staff identity, clock status, and daily clock-in/out actions.
2. **Quick actions:** weekly timesheets, off-site shifts, submitted documents, calendar/time-off, and assigned work.
3. **My work:** task board and recent protected updates or notifications, with clear pending/error states.
4. **My statistics:** retain the existing personal pay-month activity view as a secondary section.
5. **Shared calendar:** compact current-month preview and a direct link to the full calendar route.

Keep the full shared calendar on its existing dedicated route. Avoid presenting the full month grid as the first dashboard content.

## Navigation and Tools

- Standardise the portal header/navigation labels and destinations across existing routes, without removing or renaming URLs.
- Organise the Tools page into Time and attendance, Workshop work, and Accounts groups.
- Continue to show each tool, HR control, user-management link, and Accounts action only when the existing access check permits it. Do not broaden access or create role-specific navigation semantics.
- Keep all current forms, history pages, deep links, and provider integrations available from an obvious route.

## Responsive and accessible behavior

- Follow the already-approved viewport behavior: on phones and tablets, keep each dashboard section contained within the available width and use smooth transitions/section snapping where it fits content; on laptops and desktops use normal document flow without forced section-height snapping.
- Do not clip tall or variable content. Forms, tables, cards, calendars, and dialogs must remain usable at phone, tablet, laptop, and desktop sizes.
- Preserve keyboard navigation, focus visibility, semantic headings, and accessible labels for all navigation and action controls.

## Data and access boundaries

Reuse existing authorized profile and history responses. Keep the signed-in identity filter for personal statistics even when Accounts can see multiple employees. Do not add a statistics endpoint, alter source records, change Worker/API contracts, or use localStorage/static data for protected timesheets, tasks, or holiday information.

## Verification

- Verify task-first order and links through the dashboard and Tools hub, including accessible keyboard operation.
- Verify role-gated tool cards and controls still match the existing Worker access policy.
- Verify personal statistics remain scoped to the signed-in identity and distinguish unavailable data from a successful empty result.
- Check phone, tablet, laptop, and desktop viewports for readable content, no horizontal overflow, and no clipping on dashboard and Tools routes.
- Verify each existing deep link and tool route still loads after navigation changes.

## Out of scope

No new identities or roles, no changes to timesheet or holiday rules, no public-site redesign, no new backend routes, and no replacement of the existing provider integrations.
