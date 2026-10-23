# Staff Portal Training Videos

The signed-in Staff Portal has seven separate, paced walkthroughs at `/training/`.
Each video is silent and has burned-in on-screen prompts. The same steps are
available as an expandable text transcript beside the player.

| Video | Current workflow |
| --- | --- |
| Using your portal profile | GMT sign-in identity, display name and optional email for copies at `/portal/account.html` |
| Clock, lunch, absence and whole day | Dashboard clock card, event selection, absence, full-day times and notes at `/portal/` |
| Weekly timesheet | Generated weekday cards, actual times, breaks, absence and calculated totals at `/timesheets/create.html` |
| Job card | EC/MTA choice, reference, customer, site, engineer, date, optional photo, description and live preview at `/jobs/` |
| Task request | Title, job reference, owner, due date, priority and Accounts approval at `/tasks/` |
| Calendar request | Dashboard date actions and pending request form at `/portal/` |
| Timesheet audit | Weekly-entry analysis link, supported source types, decision-first review and exports at `/audit/` |

All seven walkthroughs are available to signed-in staff. The weekly entry page
links to the audit checker for signed-in staff. Administrator-only user
management is not part of the training page and remains controlled by the
protected Accounts role response on the Dashboard.

The recordings use the synthetic identity `demo.employee@example.invalid` and
training-only values. The audit recording uses one in-memory CSV row labelled
`TRAINING ONLY`; it is not payroll history. The recorder serves a sanitized local
config, has no portal API or FormSubmit endpoint, and blocks network requests
except read-only library downloads from the audit page's existing CDNs. It never
activates any form submission, download or approval control.

## Regenerate

```bash
node tools/record-staff-walkthrough.mjs all
```

Generate one video when changing a single workflow:

```bash
node tools/record-staff-walkthrough.mjs clock-record
node tools/record-staff-walkthrough.mjs weekly-timesheet
```

Generated video and poster assets are held in `training/media/`. The recorder
starts a local temporary server and disables Entra only for synthetic local
recording; the production page still uses the shared Microsoft Entra sign-in
gate. Run the contract check with `npm run test:training` to verify the seven
cards, transcripts, local video/poster assets, recorder routes and existing
Accounts-only Dashboard visibility.
