# Portal Request Approval Flow

## Purpose

The GMT portal lets authenticated staff request tasks and calendar events. It
does not grant unlicensed users direct access to Microsoft Lists or Outlook.
Microsoft Lists remains the authoritative task record.

`Amanda.BB@gmt-services.co.uk` owns the `GMT Operational Calendar` and is the
recommended Power Automate Outlook connection owner.

## Calendar Request Path

1. A staff member signs in to the portal through Entra.
2. The portal submits the calendar request through the existing structured
   FormSubmit envelope with requester identity and `Pending approval` status.
3. Power Automate creates or updates a company-owned Microsoft List record.
4. A licensed Accounts user approves or rejects the request in Microsoft 365.
5. For an approved calendar request, Power Automate creates the Outlook event
   in `GMT Operational Calendar` and records its Outlook event ID on the List
   row.
6. The requester receives the resulting status notification.

## Task Workflow Contract

Task requests use the authenticated Worker API, not FormSubmit. The browser
sends `POST /api/tasks` with stable `taskId` and `actionId` values, title, job
reference, requested assignee UPN, due date, and priority. The Worker derives
requester identity and `Pending approval` status from the signed Entra token.
`GET /api/tasks` returns only tasks the signed-in requester or assignee may
read; Accounts and Operations can read the task register.

Accounts and Operations use `POST /api/tasks/{taskId}/actions` to approve,
reject, assign, reschedule, cancel, or move work through a valid lifecycle
transition. Requesters can cancel their own pending requests. The assignee or a
manager can move approved tasks from `To-Do` to `In-Progress` and then
`Completed`. `GET /api/tasks/{taskId}/history` returns the protected activity
record to currently authorized viewers. A retry reuses the original action ID.

The Worker calls the protected Power Automate endpoint held in the
`TASK_WORKFLOW_URL` Worker secret. The flow upserts the company-owned `Tasks`
List row by `Task ID`, checks the action's expected current values, uses the
SharePoint row ETag to reject concurrent stale updates, and deduplicates each
`Action ID` in a `Task Workflow Actions` list. Only a confirmed flow response
is shown as synchronized. The Worker D1 outbox and activity table are protected
mirrors and retry/audit support; Microsoft Lists remains authoritative.

The Task Calendar flow creates an Outlook event only for an approved, dated
task, stores the resulting `Outlook Event ID` on the List row, and updates that
event when scheduling fields change. Completed and cancelled tasks retain their
calendar event. This is the required integration contract; it does not assert
that the flow or Worker secret has been configured or deployed.

## Permission Model

| Role | Portal access | Task actions | Direct List / calendar write |
| --- | --- | --- | --- |
| Staff member | Entra-gated portal | Submit requests and read authorized tasks | No |
| Requester | Entra-gated portal | Cancel own pending request | No |
| Assigned staff member | Entra-gated portal | Progress assigned work through valid statuses | No |
| Accounts / Operations | Entra-gated portal | Approve, reject, assign, schedule, and cancel tasks | Through controlled flow |
| Amanda | Calendar owner / flow owner | As assigned by Accounts / Operations role | Flow connection owner |

## Technical Boundary

- Calendar request intake remains on its separate FormSubmit path until its
  approved Microsoft 365 workflow changes. The portal saves a protected
  history record and then attempts the structured FormSubmit submission;
  an attempted email is not proof of delivery or processing.
- Task controls follow Worker-returned role and ownership metadata. The Worker
  repeats every role check against the signed Entra identity; browser fields
  cannot approve, assign, or progress tasks.
- The Microsoft List task row is authoritative. D1 is a protected mirror and
  idempotent retry/activity store, not an approval authority.
- The task HTTP flow must deduplicate action IDs and use List ETags so
  concurrent or retried updates cannot overwrite a newer List state.
- The client-side portal does not approve requests or change task statuses.
  Accounts performs those actions in Microsoft Lists or an approved flow.
- The dashboard calendar preview reads the published event feed only. It does
  not merge browser-local requests or protected request history into shared
  events, and it exposes retry when the published feed cannot be loaded.
- Browser code never writes directly to Graph, SharePoint, or Outlook.
- Timesheet absence events are separate: the Timesheet Intake flow may publish
  them directly to the shared calendar after a valid timesheet submission.
- The authoritative request status is the Microsoft List row maintained by its
  approved flow; a protected portal mirror or hidden-form submission alone is
  not evidence that Microsoft 365 processed a request.

## Release Checklist

- Create the `Tasks` and `Calendar Requests` Lists with the fields in
  `power-automate-build-runbook.md`.
- Build the protected Worker-to-Power-Automate Task upsert flow with unique
  Task ID and Action ID handling, then store its endpoint in the Worker secret
  `TASK_WORKFLOW_URL`.
- Confirm delegated Flow Service consent and the approved staff directory
  before enabling assignment controls.
- Keep calendar request FormSubmit routing separate from the task Worker API.
- Build the calendar approval flows under Amanda's connection and add a second
  licensed Accounts co-owner.
- Test with an approved internal identity. Do not claim SharePoint or Outlook
  completion from a browser dialog, local mirror, or HTTP health response.
