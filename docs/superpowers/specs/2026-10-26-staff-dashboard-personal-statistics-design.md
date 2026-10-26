# Staff Dashboard Personal Statistics — Design

## Intent

Add a third carousel slide that gives each staff member a useful view of their activity for a selected GMT pay month.

## Selected approach

Use the existing signed-in portal history. The dashboard already reads authorized history, and the Worker supports a bounded history limit of up to 500 records. Pass that limit through the existing API wrapper and reuse the returned records; do not add a statistics endpoint or write/alter any records. The alternative—a new server aggregation endpoint—would add backend scope without being necessary for this first view.

## Slide and measures

Add slide 3, “My statistics”, with a pay-month selector defaulting to the current configured pay month. Offer previous months present in the available history, using the existing GMT pay-period helper for month boundaries.

Show distinct worked days and holiday days from the signed-in user’s timesheet daily rows, plus their estimates written, job cards raised and tasks completed for the selected month. Count only dates and completed states supported by source fields. Use explicit work, estimate, task-completion or record dates where present; use the submission date only when a record has no activity date. Exclude pending tasks from the completed count.

## Access and data limits

Match records to the signed-in identity (owner OID/UPN) even when an administrator can see records from other staff. The history request remains subject to the existing Worker authorization. Show an unavailable state when history fails and a “based on records currently available to your account” note; distinguish that from a successful zero count. Do not infer missing daily rows, holiday approvals, or task completion dates.

## Constraints and non-goals

Keep the dashboard carousel controls accessible and responsive. Do not change payroll records, add a new backend route, expose other employees’ metrics, calculate remaining holiday entitlement, or treat estimates/job cards as payroll data. This change will be prepared as a reviewable branch/PR; production deployment is a separate release step.
