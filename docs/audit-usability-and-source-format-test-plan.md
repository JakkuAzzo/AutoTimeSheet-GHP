# Audit Usability and Source Format Test Plan

## Goal

The audit page should answer the admin question first:

- Is this upload clean?
- If not, what needs reviewing?
- Can accounts download or submit the corrected audit safely?

Technical row evidence should remain available, but it should not be the first thing the user has to interpret.

## Supported Source Formats

The audit checker should support:

- `.docx`
- `.docm` as read-only Word OpenXML with no macro execution
- `.xlsx`
- `.csv` where feasible
- `.zip` containing any mix of supported formats

Source type labels:

- Word timesheet
- App-generated XLSX
- CSV
- Mixed ZIP

## Required Regression Cases

### Ainsley Clean Word Case

Source:

```text
AINSLEY TIMESHEET GMT WEEK 1st June 2026 (2).docx
```

Expected:

- 5 source rows.
- Week beginning 1 June 2026.
- Employee: Ainsley Williams.
- Monday-Friday 8.00am to 17.00pm.
- 1hr lunch.
- 8h actual/basic per day.
- Weekly basic: 40h.
- OT x1.5: 0h.
- OT x2.0: 0h.
- Warnings: 0.
- Parse errors: 0.

Plain English result:

```text
No issues found.
This timesheet matches the calculated result.
No corrections are needed.
```

### Jason Issue ZIP Case

Expected:

- 4 Word files.
- 20 source rows.
- 3 warnings/mismatches.
- 0 parse errors.
- 1 matching week.
- 3 weeks needing review.

Plain English result:

```text
3 issues need review.
The upload was parsed successfully, but some source totals differ from calculated results.
```

Issue cards:

1. Wednes 3rd source OT total differs.
2. Friday 12th likely `7:00pm` typo.
3. Monday 15th source OT total differs.

### App-Generated XLSX Clean Case

Expected:

- Preferred sheet: `All`.
- Metadata fallback from `Totals`.
- 5 normal weekday rows.
- 40h actual/basic.
- OT x1.5: 0h.
- OT x2.0: 0h.
- Warnings: 0.
- Parse errors: 0.
- Source type: App-generated XLSX.

### Mixed ZIP Case

Expected:

- ZIP can contain Word and app-generated XLSX sources.
- Each source keeps its own employee/week grouping.
- Source types are visible in the Files section.
- No default OT values are invented.

## XLSX Column Support

Read app-generated columns such as:

- Employee
- Employee email
- Week start
- Week end
- Date
- Weekday
- Start
- Finish
- Break
- Absence reason
- Worked hours
- Basic hours
- Paid Basic hours
- OT x1.5 hours
- OT x2.0 hours
- Status
- Note

Blank OT cells mean `0`.

Break labels should parse:

- No break
- 30 minutes
- 1 hour

Status labels should be preserved where present:

- Recorded
- Absent
- Check

## UI Hierarchy

Top:

- Plain English admin decision.

Middle:

- Correction actions.

Bottom:

- Detailed evidence and technical breakdown.

Tabs:

- Summary
- Issues
- Rows
- Files
- Exports

## Summary Copy

Clean upload:

```text
No issues found.
This timesheet matches the calculated result.
No corrections are needed.
```

Issue upload:

```text
3 issues need review.
The upload was parsed successfully, but some source totals differ from calculated results.
```

## Issue Card Requirements

Each issue card should show:

- Date.
- Problem.
- Source value.
- Calculated value.
- Likely action.
- Impact.
- Source file.

Example:

```text
Friday 12th
Problem: Start time appears later than finish time.
Source says: 7:00pm to 6:00pm.
Likely action: Check whether start should be 7:00am.
Impact: Current source creates an overnight shift.
```

## Mobile Requirements

- Ainsley clean upload can be understood in under 10 seconds.
- Jason issue upload can be understood in under 10 seconds.
- Normal review should not require horizontal scrolling.
- Raw row data should be collapsed by default.
- Export actions should be discoverable but not crowd the first result.

## Validation Matrix

Run:

```text
npm run test:audit:fixtures
AUDIT_ZIP_PATH=... npm run test:audit:jason-zip
npm run test:timesheets:daily-calculation
npm run test:timesheets:email-routing
npm run test:jobs:email-routing
git diff --check
```

Manual release gates:

- Real iPhone Safari upload.
- Real FormSubmit audit delivery.
- Open generated Excel export.
- Confirm Outlook/Power Automate routing after business mailbox migration.
