# Post-reconciliation Power Automate replay evidence

Captured: 16 September 2026 (Europe/London)  
Scope: live GMT tenant, authenticated as the GMT Electrical Services Ltd administrator.

## Result

A post-reconciliation replay of **GMT Portal - Timesheet Intake** completed successfully and reached both the company-owned SharePoint intake list and the company-owned Excel workbook.

The reconciliation export was loaded into the protected portal D1 store at **2026-09-16T09:00:00Z**. The replay's Excel action returned an HTTP 200 response at **2026-09-16T15:28:01Z**, so this run occurred after the reconciliation load.

## Power Automate run

- Flow: **GMT Portal - Timesheet Intake**
- Flow ID: `7e648f30-fd5b-42ef-9471-d25f9381e020`
- Run ID: `08584120344158828648667395507CU16`
- Run-history start: **16 September 2026, 16:27 Europe/London**
- Duration: **13 seconds**
- Overall status: **Succeeded**
- Live run page: [Power Automate run history](https://make.powerautomate.com/environments/Default-8b182d6b-6f34-4ca2-84ad-50ca712b5488/flows/7e648f30-fd5b-42ef-9471-d25f9381e020/runs/08584120344158828648667395507CU16)

The live run canvas showed green/succeeded results for the Outlook trigger, SharePoint create, both attachment filters, both apply-to-each branches, SharePoint update actions and Excel Run script.

## SharePoint intake result

The replay created a company-owned item in the **GMT Web-App / Timesheet Submissions** list:

- Site: `https://gmtelectservsltd.sharepoint.com/sites/GMTWeb-App`
- List ID: `daab3602-e197-46ba-9329-e96220518527`
- List item: **ID 55**
- Title: `FW: [GMT][TIMESHEET][SUBMISSION] Simon | Week 2026-08-24`
- Employee: **Simon**
- Week: **2026-08-24 to 2026-08-30**
- Status: **Submitted**
- Submitted at (source metadata): **2026-09-15T13:44:38Z**
- SharePoint create response: **HTTP 201**
- Created/modified by the run: **2026-09-16T15:27:50Z**
- Direct item view: [SharePoint item 55](https://gmtelectservsltd.sharepoint.com/sites/GMTWeb-App/Lists/Timesheet%20Submissions/DispForm.aspx?ID=55)

I opened the item directly in SharePoint after the run. Its Issue field contained the structured daily source payload, including the daily dates, start/finish values, worked/basic hours, notes and submission metadata.

## Excel workbook result

The run's **Run script** action targeted the company-owned workbook:

`/Timesheets/2026/08/Simon/GMT Timesheet - Simon - 2026-08.xlsx`

Action evidence:

- Workbook drive: GMT Web-App SharePoint document library
- Script action: **Succeeded**
- Action start: **16:27:53**
- Action end: **16:28:02**
- Response: **HTTP 200**
- Result: `created: 0`, `updated: 0`, `unchanged: 7`, `flagged: 12`, `skipped: 0`

The seven unchanged rows are the idempotent confirmation that the replay found the existing source records in the workbook. The flagged rows are retained review variants; no source row was skipped.

I opened the workbook directly in Excel for the web. It showed **Saved**, with the **Timesheet Events** worksheet selected and populated Simon daily rows for 24–30 August, including start/finish times and worked-hour values (9.5, 10.5, 10.5, 10.5, 9.5, 9.0 and 9.0), alongside the additional audit/review rows.

## Reconciliation inputs

- [Reconciliation README](README.md)
- [Source manifest](source-manifest.json)
- [Reconciled records](records.json)
- [Operational build status](../../operational-build-status.md)

The reconciliation set contains 32 supplied Accounts bundles, 113 attachment records, 114 parsed daily rows and 14 source-preserving timesheet variants. Synthetic Accounts test rows remain excluded from completion counts.

## Boundary

This is live end-to-end evidence for the Simon August company workbook. The replay is idempotent (`unchanged: 7`), so it proves the post-reconciliation path and existing workbook population without fabricating new rows. A separate successful replay for each remaining employee/month workbook is still needed before claiming that every company workbook has been individually certified.

The current per-workbook evidence matrix is maintained in
[canonical-workbook-certification-evidence.md](canonical-workbook-certification-evidence.md).
It records direct workbook read-backs separately from Power Automate run proof;
the workbook set remains uncertified until each remaining source pair has its
own successful child Excel action.

On 17 September 2026 the live owner/admin path was rechecked. The info account
could not resolve the configured Power Platform environment, showed no owned or
shared flows, and the flow editor returned the `shared_logicflows` connection
error with no run history. The exact request, session and correlation IDs and
the environment-list error are recorded in the [canonical workbook
certification evidence](canonical-workbook-certification-evidence.md). This
recheck leaves the Simon run as the only replay-certified source week.
