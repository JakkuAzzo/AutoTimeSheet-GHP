# GMT Calendar v2 Implementation Contract

Status: design contract / protected-service prerequisite. This document does
not publish sensitive data or change the production application.

## Purpose and boundary

The GitHub Pages portal is an authenticated request interface only. It must not
store or publish holiday-register records, payroll rates, employee rules,
evidence photos, source documents, or reconciliation data in static files or
browser localStorage.

Production authority:

```text
Entra-authenticated portal -> controlled request intake -> Power Automate
-> Microsoft Lists / SharePoint -> approved Outlook shared calendar
```

Any future portal read of protected data requires an approved company-owned
backend or worker with server-side Microsoft 365 access. No Graph secret,
SharePoint token, mailbox credential, or Power Automate connection belongs in
GitHub Pages JavaScript.

## User surfaces and permissions

### Shared Calendar

Displays approved, non-sensitive operational events only. It may include
approved work planning, training, and absence availability at the minimum
necessary detail. It must not expose payroll rates, evidence photos, source
wording, employee rules, private notes, or full-register exports.

### Holiday & Absence Register

Protected M365 surface only. Staff do not receive the full register. The
authoritative record is a Microsoft List or approved protected data service,
with SharePoint evidence storage and Power Automate lifecycle/audit handling.

### My Absence Requests

Staff may create and view their own requests and statuses. A request includes a
record ID, requester identity from Entra, date/range, requested absence type,
optional reason/details, submitted time, status, decision time and approver.
Evidence upload is not available to staff unless a separate approved policy
and protected upload path exists.

### Manager / approver view

Managers see only their permitted team requests, with enough information to
approve or reject. Query flags and limited evidence status may be shown where
necessary; payroll rates, full register exports and unrelated employee records
remain hidden.

### Admin reconciliation panel

Available only to an authorised admin/payroll role enforced by Microsoft 365
permissions, not a client-side role flag. It may expose roster, employee rules,
evidence photos, exact source wording, three-source reconciliation, audit
history, To Query, Other Absence Query, coverage/completeness and protected
workbook exports.

### System owner

Manages permission groups, Microsoft 365 configuration, publishing, retention,
protected backups, flow ownership and recovery. Critical Lists, libraries,
flows and the Outlook calendar require two GMT co-owners.

## Protected data model

Minimum protected records:

| Record | Required protected fields |
| --- | --- |
| Absence Request | Record ID, requester UPN, date/range, requested type, status, approver, timestamps, decision note |
| Holiday Register Entry | Employee ID, date/range, classification, source reference, source wording, confidence/query state, approved status |
| Employee Rule | Employee ID, effective dates, rule/value, approver, source and audit metadata |
| Evidence Item | Register entry ID, original file, source image/document, checksum, captured date, restricted link |
| Reconciliation Issue | Issue ID, register entry, source comparison, To Query or Other Absence Query, owner, resolution, timestamps |
| Audit Event | Actor, action, record ID, before/after summary, source, timestamp, correlation ID |

Do not use employee names alone as an idempotency key. Use a stable record ID
and preserve source references and exact wording.

## Three-source rule and query handling

The register must reconcile the approved source set without guessing:

1. Preserve each source file/image and its exact wording.
2. Compare the three source representations by employee, date/range and
   absence classification.
3. Classify an explicit annual-leave/holiday entry only when the evidence
   supports that classification under the approved register rules.
4. Put ambiguous, conflicting, non-leave or incomplete entries in To Query or
   Other Absence Query with evidence links and an assigned owner.
5. Keep unresolved items out of approved totals and the Shared Calendar.
6. Record every correction, approval and export in audit history.

## Approval lifecycle

```text
Draft -> Submitted -> Manager Review -> Approved / Rejected
                         |                 |
                         v                 v
                    To Query          Audit record
                         |
                         v
                 Resolved -> Re-review
```

Only Approved records may publish a non-sensitive calendar event. The
authoritative approval status is the protected List/flow record, not a
localStorage value or a browser button.

## Export and publishing controls

- Staff cannot export the register, evidence or payroll/rate data.
- Managers cannot export the full register unless a separate written policy
  grants it.
- Admin/payroll exports are generated from protected M365 data and logged with
  actor, scope, time, source version and checksum where practical.
- Public GitHub Pages data may contain only approved non-sensitive calendar
  events. It must never contain source images, exact private wording, rates,
  employee rules or unresolved query records.
- The final workbook must preserve the approved `Time Off Totals` sheet as the
  final totals sheet, with query/evidence sections retained separately.

## Release gates

Before Calendar v2 is connected to production:

- GMT approves the role groups and names a system owner plus second co-owner.
- Protected Lists, SharePoint roots, evidence permissions and retention are
  created and tested.
- Power Automate creates idempotent records and records failures without
  silently discarding requests.
- One staff request, one manager approval, one rejection and one query case
  are tested with synthetic data.
- Shared Calendar publication is verified to expose only approved,
  non-sensitive events.
- Admin reconciliation, evidence access, query handling and workbook export
  are tested with synthetic data.
- Real-device Safari/iPhone testing is completed for request entry and status
  viewing.
- No production release occurs while the only data source is localStorage or
  static GitHub files.
