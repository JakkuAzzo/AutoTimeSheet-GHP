# GMT shared static data

This folder is the no-database shared data layer for the GitHub Pages portal.

The public site can safely read these files, but it must not write to them directly because a browser-based write token would be exposed.

## Current workflow

1. Staff create timesheets, job cards, tasks, or calendar events in the portal.
2. The portal stores local drafts in the browser and sends FormSubmit emails to the admin/accounts inbox.
3. Admin reviews the received submissions.
4. Admin publishes approved records by committing updates to this folder or by using the manual GitHub Actions workflow.
5. GitHub Pages reads these files as the shared approved record source.

## Files

- `job-cards/job-cards.json` and `.csv`: approved job cards.
- `tasks/tasks.json` and `.csv`: approved/shared tasks.
- `calendar/events.json`: approved calendar event source.
- `calendar/gmt-calendar.ics`: published calendar feed/import file.
- `uploads/job-cards/`: intended location for approved job-card images/photos later.

## Security note

Do not add GitHub tokens or secrets to the public website. Repository writes should happen only via admin GitHub access, GitHub Actions, or a future serverless write gateway.
