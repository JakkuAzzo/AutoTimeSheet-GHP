# Canonical employee/month workbook certification evidence

Captured: 17 September 2026 (Europe/London)
Scope: the eight supplied employee/month source pairs that remain in scope after excluding the Accounts test mailbox and Michelle's audit-only submissions.

## Certification rule

A workbook/month pair is certified only when both pieces of evidence exist for
the same canonical source record:

1. a successful **GMT Portal - Timesheet Intake** Power Automate run whose
   Excel Online **Run script** action names the intended company-owned workbook
   and returns a successful upsert result; and
2. a direct workbook read-back showing the expected daily rows, source record
   IDs, dates, clock values and totals.

An Outlook sent item, a SharePoint list item, a manually repaired workbook, or
an HTTP 200 response without a matching run-history record is useful evidence,
but does not satisfy the replay requirement by itself.

## Current evidence matrix

| Employee / source week | Company-owned workbook | Canonical source record | Power Automate replay evidence | Direct read-back | State |
| --- | --- | --- | --- | --- | --- |
| Ainsley, 2026-06-22 to 2026-06-28 | `/Timesheets/2026/06/Ainsley/GMT Timesheet - Ainsley - 2026-06.xlsx` | `reconcile-timesheet-ainsley-2026-06-22-c52554fb9f7c` | Latest direct resend `08584120050151333980982907777CU15` reached the intake path, but **Filter array 2 returned `[]`**; no child Excel action is evidenced. | [Ainsley June CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Ainsley%20-%202026-06(Sheet1).csv): five 22–26 June rows. | **Not certified** |
| Ainsley, 2026-08-24 to 2026-08-30 | `/Timesheets/2026/08/Ainsley/GMT Timesheet - Ainsley - 2026-08.xlsx` | `reconcile-timesheet-ainsley-2026-08-24-3a06ed774581` | Run `08584120217925704863378177180CU00` succeeded with `created: 5`, but the historical source-date variant was written before the canonical workbook was corrected. | [Ainsley August CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Ainsley%20-%202026-08(Timesheet%20Events)-2.csv): five 24–28 August rows after direct workbook correction. | **Not certified; replay must be rerun after correction** |
| Ainsley, 2026-09-07 to 2026-09-13 | `/Timesheets/2026/09/Ainsley/GMT Timesheet - Ainsley - 2026-09.xlsx` | `timesheet-ainsley-gmt-services-co-uk-2026-09-07` | Run `08584120229140679193128481403CU22` succeeded with `created: 5`, but the workbook was subsequently corrected directly to the canonical daily values. | [Ainsley September CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Ainsley%20-%202026-09(Timesheet%20Events)-2.csv): five 7–11 September rows, including the Friday overtime row. | **Not certified; replay must be rerun after correction** |
| Jason, 2026-08-24 to 2026-08-30 | `/Timesheets/2026/08/Jason/GMT Timesheet - Jason - 2026-08.xlsx` | `reconcile-timesheet-jason-2026-08-24-c917a9ca128e` | The source was transmitted and indexed, but no exact successful child Excel run ID is available in the authenticated run history. | [Jason August CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Jason%20-%202026-08(Timesheet%20Events).csv): one authoritative 29 August row, 10:30–14:30, four hours. | **Not certified** |
| Matthew, 2026-08-31 to 2026-09-06 | `/Timesheets/2026/08/Matthew/GMT Timesheet - Matthew - 2026-08.xlsx` | `reconcile-timesheet-matthew-2026-08-31-7870caed019a` | No exact successful child Excel run ID is available in the authenticated run history. | [Matthew August CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Matthew%20-%202026-08(Timesheets)-2.csv): five canonical absence rows for 31 August–4 September, stored under the declared August week-start folder. | **Not certified** |
| Matthew, 2026-09-07 to 2026-09-13 | `/Timesheets/2026/09/Matthew/GMT Timesheet - Matthew - 2026-09.xlsx` | `timesheet-matthew-gmt-services-co-uk-2026-09-07` | No exact successful child Excel run ID is available in the authenticated run history. | [Matthew September CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Matthew%20-%202026-09(Timesheets)-2.csv): five rows for 7–11 September with start/finish, break and overtime totals. | **Not certified** |
| Simon, 2026-08-24 to 2026-08-30 | `/Timesheets/2026/08/Simon/GMT Timesheet - Simon - 2026-08.xlsx` | `timesheet-simon-gmt-services-co-uk-2026-08-24` | Run `08584120344158828648667395507CU16` succeeded against the named workbook: `created: 0`, `updated: 0`, `unchanged: 7`, `flagged: 12`, `skipped: 0`, HTTP 200. | [Simon August CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Simon%20-2026-08(Timesheet%20Events)-3.csv): canonical 24–30 August rows plus the separately reconciled cross-month week. | **Replay certified for this source week; workbook still needs the second source week replay** |
| Simon, 2026-08-31 to 2026-09-06 | `/Timesheets/2026/08/Simon/GMT Timesheet - Simon - 2026-08.xlsx` | `reconcile-timesheet-simon-2026-08-31-002a04b0fa12` | No exact successful child Excel run ID is available for this cross-month source week. | Same [Simon August CSV](/Users/nathanbrown-bennett/Downloads/GMT%20Timesheet%20-%20Simon%20-2026-08(Timesheet%20Events)-3.csv): seven rows for 31 August–6 September after direct workbook repair; ISO input was used to prevent locale date inversion. | **Not certified** |

## Read-back checks

The direct exports above were read after the workbook save indicator returned
**Saved**. The canonical row counts are:

- Ainsley June 5; Ainsley August 5; Ainsley September 5.
- Jason August 1.
- Matthew August 5; Matthew September 5.
- Simon August 14 in the single August workbook: 7 rows for the 24 August
  week and 7 rows for the 31 August cross-month week.

The Simon workbook was reset to the 14 selected canonical daily rows during
this pass. That action is a direct workbook recovery and is deliberately kept
separate from the Power Automate replay evidence. It does not upgrade the
second Simon source week, or any other row, to replay-certified status.

## Why the full set is not certified

The current info-account Power Automate session cannot activate the flow
connection. The live editor and run-history pages return:

> The caller object id is `285ed781-f830-4df5-bf42-962591c902ae`. Connection
> `7e648f30-fd5b-42ef-9471-d25f9381e020` to `shared_logicflows` cannot be used
> to activate this flow … replace the connection or have the connection owner
> activate the flow.

The Amanda owner session is waiting at the Microsoft sign-in/AutoFill step;
Safari displayed the stored Amanda credential and requested Touch ID. Until
that owner session is completed, the remaining run-history records cannot be
read or replayed from the current browser session. The workbook read-backs are
therefore recovery evidence, not a substitute for the missing replay proof.

This owner-session check was repeated on 17 September 2026: selecting the
stored `amanda.bb@gmtelectservsltd.onmicrosoft.com` credential opened the
Touch ID approval sheet and did not produce an authenticated owner session.

## Live platform recheck on 17 September 2026

The current administrator session was rechecked after the owner-session
attempt:

- Power Platform admin center route
  `admin.powerplatform.microsoft.com/manage/environments/environment/b7db48c9-5976-ef8e-9438-78dfe2098742/hub`
  returned **Environment Not Found** for the environment ID in the route.
  Its request ID was `3a7aec17-89be-4eee-9d2f-b108830df55b` at 05:29:49 UTC;
  the environments list then returned “An unexpected error occurred while
  loading the environments list” after a read-only refresh.
- The info account's Power Automate **My flows** page for
  `Default-8b182d6b-6f34-4ca2-84ad-50ca712b5488` showed **You don't have any
  flows**. Its **Shared with me** page also showed no flows.
- Opening the flow editor for `GMT Portal - Timesheet Intake` failed at
  `2026-09-17T05:33:44.355Z` with the same `shared_logicflows` connection
  error. The editor supplied session ID
  `8e1f2bc0-b23e-11f1-85e4-9b8d54d37305`, client request ID
  `112eeb63-63a4-4e89-b5cb-206d77461902`, and backend correlation ID
  `d3af8c0f-8ffa-4e80-94fb-956100b694f1`.
- A further Safari recheck at `2026-09-17T05:38:41Z` selected the stored
  Amanda credential and displayed `AutoFillAuthenticationSheet`: “Touch ID to
  AutoFill your login information.” The prompt was dismissed without a
  password or token being entered, so no owner session was established.

These checks are live evidence that the info account cannot currently access
the owner connection or even resolve the configured environment. They do not
constitute a replay and do not change any workbook's certification state.

## Required final replay pass

After the Amanda owner connection is activated, replay each not-certified
source JSON separately, then record the run ID, target workbook path, action
status and returned `created/updated/unchanged/flagged/skipped` counters. Refresh
the direct workbook read-back after each run and certify only the pair whose
source ID and daily rows match. Do not replay the Accounts test mailbox or
Michelle's audit-only rows.
