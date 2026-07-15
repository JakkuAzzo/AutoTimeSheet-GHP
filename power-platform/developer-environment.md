# GMT Portal Development Environment

## Purpose

This is the free, non-production Power Apps Developer Plan environment used to
prove GMT's authenticated staff portal before purchasing any Power Apps or
Dataverse production licences.

| Property | Value |
| --- | --- |
| Display name | `GMT Portal Development` |
| Type | Developer, non-production |
| Region | Europe |
| Dataverse URL | `https://gmt-portal-dev.crm4.dynamics.com/` |
| Solution | `GMTWebAppSolution` |
| Publisher prefix | `gmt` |
| Staff portal app | `GMT Staff Portal` (`a4628a8c-2480-f111-ab0e-0022489d3844`) |

The environment was created on 15 July 2026 through PAC and is connected to the
local `GMT-Default` authentication profile. The profile is stored on the Mac,
not in this repository.

## Current proof state

The environment now contains a published, authenticated model-driven app shell
named `GMT Staff Portal` and six custom proof tables:

| Display name | Current logical name | Intended production logical name |
| --- | --- | --- |
| Timesheet Submission | `crbf9_timesheetsubmission` | `gmt_timesheetsubmission` |
| Clock Event | `crbf9_clockevent` | `gmt_clockevent` |
| Audit Submission | `crbf9_auditsubmission` | `gmt_auditsubmission` |
| Job Card | `crbf9_jobcard` | `gmt_jobcard` |
| Task | `crbf9_task` | `gmt_task` |
| Calendar Event | `crbf9_calendarevent` | `gmt_calendarevent` |

These were created through the maker workspace and have been added to
`GMTWebAppSolution`, so they are included in the local solution export. The
`crbf9_` prefix is acceptable for the disposable proof, but not for a promoted
company schema. Do not delete or recreate the current tables during testing.
Before promotion, create a controlled `gmt_` schema in `GMTWebAppSolution`,
migrate only approved sample data, and rewire the app and flows.

## Target data model

The production solution will contain these tables, with every custom table and
column using the `gmt_` prefix:

| Table | Primary purpose | Minimum fields |
| --- | --- | --- |
| `gmt_timesheetsubmission` | Index an employee weekly submission | employee, employee email, week start/end, worked/basic/OT totals, status, submitted at, SharePoint folder link |
| `gmt_auditsubmission` | Index an audit export | audit name, source count, row count, warnings, parse errors, submitted at, workbook links |
| `gmt_jobcard` | Track a job from new through completed | job reference, client, site, engineer, planned date, status, attachment folder link |
| `gmt_task` | Staff task workflow | title, owner, job reference, priority, due date, status, created/updated at |
| `gmt_clockevent` | Capture clock/lunch events | employee, event type, event time, submitted at, source reference |
| `gmt_calendarevent` | Store the operational calendar link | source type/id, Outlook event id, event date, status, last synchronised |

The first app is an internal model-driven app. Its target navigation is
Timesheets, Clock events, Audit, Job Cards, Tasks, and Calendar. It must use
Dataverse roles and Microsoft Entra sign-in, never a password field or custom
frontend token.

## Calendar and flow scope

The proof will use one shared Outlook calendar owned by the Accounts shared
mailbox: `GMT Operational Calendar`. Job Cards and Tasks will create, update or
cancel all-day events in that calendar. Each source row must retain its Outlook
event ID and the calendar flow must retain the originating Dataverse row ID.
Timesheets, clock events and audits do not create calendar events.

Do not create a personal-calendar fallback. Use Power Automate connection
references and environment variables for the shared mailbox and calendar IDs;
do not place Microsoft credentials or IDs in the public website.

## Integration boundary

- The current GitHub Pages app remains a guest-facing submission UI during the
  trial.
- Existing FormSubmit -> shared mailbox -> Power Automate -> SharePoint/Lists
  automation remains the operational baseline.
- The Developer environment is for proving data model, internal views and
  delegated connections only.
- Do not move live payroll data, employee PII, files, or production flows into
  this environment without accounts approval.
- Do not enable Azure pay-as-you-go or add a paid capacity add-on here.

## Promotion gate

Move the solution to a paid production environment only after:

1. The portal app is tested with non-sensitive sample data.
2. At least two GMT administrators are assigned as solution/flow owners.
3. Dataverse table security roles are reviewed.
4. The shared Outlook calendar and all email ingestion flows have manual test
   evidence.
5. GMT approves the number of Premium licenses and any required capacity.
