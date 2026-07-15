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

The environment was created on 15 July 2026 through PAC and is connected to the
local `GMT-Default` authentication profile. The profile is stored on the Mac,
not in this repository.

## First data model

Create these tables in `GMTWebAppSolution`, with every custom table and column
using the `gmt_` prefix:

| Table | Primary purpose | Minimum fields |
| --- | --- | --- |
| `gmt_timesheetsubmission` | Index an employee weekly submission | employee, employee email, week start/end, worked/basic/OT totals, status, submitted at, SharePoint folder link |
| `gmt_auditsubmission` | Index an audit export | audit name, source count, row count, warnings, parse errors, submitted at, workbook links |
| `gmt_jobcard` | Track a job from new through completed | job reference, client, site, engineer, planned date, status, attachment folder link |
| `gmt_task` | Staff task workflow | title, owner, job reference, priority, due date, status, created/updated at |
| `gmt_clockevent` | Capture clock/lunch events | employee, event type, event time, submitted at, source reference |

The first app should be an internal staff canvas or model-driven app, with
navigation for Timesheets, Audit, Job Cards, Tasks, and Calendar. It must use
Dataverse roles and Microsoft Entra sign-in, never a password field or custom
frontend token.

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
