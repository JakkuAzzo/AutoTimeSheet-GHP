# Staff Portal Training Videos

The Staff Portal now has separate, paced videos rather than one rapid overview.
They are available to signed-in staff at `/training/`.

| Video | Covers |
| --- | --- |
| Using your portal profile | Microsoft sign-in, profile and reused identity |
| Clock, lunch, absence and whole day | Quick record buttons, date/time, absence, full day and optional note |
| Weekly timesheet | Week dates, daily cards, breaks, absences and calculated results |
| Job card | Reference, client, site, engineer, photo and work description |
| Task request | Title, job reference, owner, due date, priority and approval |
| Calendar request | Event details and accounts approval before Outlook publication |
| Timesheet audit | Supported source files, calculation/check and decision-first review |

Every recording:

- uses `Demo Employee` and training-only data;
- includes a visible moving cursor and highlighted next control;
- never clicks a real submit button;
- is paced for employees to follow one action at a time.

## Regenerate

```bash
node tools/record-staff-walkthrough.mjs all
```

Generate one video when changing a single workflow:

```bash
node tools/record-staff-walkthrough.mjs clock-record
node tools/record-staff-walkthrough.mjs weekly-timesheet
```

Generated video and poster assets are held in `training/media/` so GitHub Pages can serve the authenticated training page. The recorder starts a local temporary server that disables Entra only for recording; production pages still require Microsoft Entra sign-in.
