# GMT Task Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the authenticated task request and board lifecycle with Accounts approval, assignee progress, durable history, and an idempotent Microsoft 365 synchronization boundary.

**Architecture:** The Cloudflare Worker owns role checks, task transitions, activity history, and an idempotent outbox. It synchronizes the same stable task ID to the company-owned Microsoft List through a protected Power Automate workflow; the Task Calendar flow creates one all-day event for an approved dated task and updates that event by its stored Outlook event ID. The browser renders only Worker-confirmed task state and uses a mock flow in tests.

**Tech Stack:** Cloudflare Worker, D1, browser JavaScript, Playwright, Power Automate / SharePoint / Outlook.

**Spec:** `docs/portal-request-approval-flow.md`, `power-platform/submission-envelope-contract.json`, and `power-platform/calendar-automation-contract.json`.

## Task lifecycle contract

- Statuses are `Pending approval`, `To-Do`, `In-Progress`, `Completed`, and `Cancelled`.
- `POST /api/tasks` accepts a stable `taskId` and `actionId`, title, job reference, requested assignee UPN, due date, and priority. The Worker derives requester identity and initial status from the signed token.
- `POST /api/tasks/{taskId}/actions` accepts a stable `actionId` plus `approve`, `reject`, `assign`, `schedule`, `transition`, `cancel`, or `retry`. Approval creates `To-Do`; rejection creates `Cancelled`; assignee progress is `To-Do` → `In-Progress` → `Completed`.
- `GET /api/tasks/{taskId}/history` returns append-only actor, action, timestamp, and status/assignment/schedule changes to authorized viewers.
- `TASK_WORKFLOW_URL` receives `{taskId, actionId, action, task}` and must upsert the SharePoint `Tasks` row by `Task ID`. Success replies include `{success:true, taskId, sharePointItemId, status, outlookEventId, calendarSyncStatus}`. Repeating an action ID returns its original outcome. An uncertain or failed response remains retryable with the same IDs and is never shown as synced.
- Only an approved task with a due date can create a calendar event. The flow reuses the row’s `Outlook Event ID` on updates and retains the event when a task is completed or cancelled.

## Global Constraints

- Microsoft Lists remains authoritative for approved operational task state; the portal never writes directly to Graph, SharePoint, or Outlook.
- Task request IDs and update operation IDs remain stable across retries; the Power Automate upsert key is the task ID.
- Only Accounts/Operations can approve or reject, assign, and change due date or priority; only the requester can cancel a pending request; only the assignee or Accounts/Operations can move approved work through valid status transitions.
- Calendar events are created only for approved tasks with a due date, updated by the stored Outlook event ID, and retained on completion/cancellation until the documented retention policy changes.
- Do not deploy, configure provider secrets, or write live provider data in this task. Use mocks. Live validation requires a named approved internal test identity; none is specified in the request.

## Review Focus

- An employee cannot approve, assign, or change another employee’s task by editing the request body; verify role checks use the signed Entra identity.
- Repeating a request or an uncertain flow update with the same key does not create another Microsoft List row, history event, or Outlook event.
- Missing flow configuration, token consent, malformed replies, and flow failures remain visible and do not present a mutation as synced.
- Requesters, assignees, and Accounts receive only their authorized task records and history.
- Empty and populated task boards retain clear status, controls, and history at desktop and narrow browser widths.

---

### Task 1: Add the protected task lifecycle and Microsoft 365 sync boundary

**Files:**
- Create: `cloudflare-worker/src/task-workflow.js`
- Create: `cloudflare-worker/migrations/0019_task_workflows.sql`
- Modify: `cloudflare-worker/src/index.js`
- Test: `tests/task-workflow.mjs`

**Interfaces:**
- Consumes: verified Worker identity (`oid`, `upn`, `name`, `isAdmin`, `isOperationsAdmin`) and existing `records` table.
- Produces: `normalizeTaskRequest`, `applyTaskAction`, protected `GET/POST /api/tasks`, `POST /api/tasks/{taskId}/actions`, `GET /api/tasks/{taskId}/history`, `task_activity` audit, and `task_workflow_outbox` keyed by stable task/action IDs. A configured `TASK_WORKFLOW_URL` receives the lifecycle contract above and must return an explicit success result before the browser reports Microsoft 365 synchronization.

- [x] Write focused policy and API tests for requester tampering, manager approval, assignee progress, scoped history, duplicate IDs, retries, stale ownership and interrupted outbox leases.
- [x] Run `node tests/task-workflow.mjs` and verify each failure names the absent task behavior.
- [x] Implement validation and state transitions in `cloudflare-worker/src/task-workflow.js`, then connect the routes and migration in `cloudflare-worker/src/index.js`.
- [x] Rerun `node tests/task-workflow.mjs`; the task lifecycle and error/retry cases pass.

### Task 2: Connect the task page to the protected lifecycle

**Files:**
- Modify: `portal-api.js`
- Modify: `portal.js`
- Modify: `tasks/index.html`
- Modify: `portal.css`
- Test: `tests/task-board-browser.mjs`

**Interfaces:**
- Consumes: Task API routes and role/action metadata from Task 1.
- Produces: a board showing Pending approval, To-Do, In-Progress, Completed, and Cancelled tasks; request, approval/rejection, assignment, due-date/priority edits, valid assignee transitions, task history, and sync/retry feedback. No task status is mutated in local storage.

- [x] Write browser tests for an empty board, a populated board with mixed roles/statuses, successful submission/action/history, and failed or disconnected Worker responses.
- [x] Run `node tests/task-board-browser.mjs` and verify failures identify missing user-visible behavior.
- [x] Implement the Worker-backed board and keep task-specific controls hidden unless the returned role allows them. Flow Service consent is optional during load and user-started from the task page.
- [x] Rerun `node tests/task-board-browser.mjs`; empty/populated and 390px viewport states pass.

### Task 3: Align the Microsoft 365 contracts and release boundary

**Files:**
- Modify: `docs/portal-request-approval-flow.md`
- Modify: `power-platform/submission-envelope-contract.json`
- Modify: `power-platform/calendar-automation-contract.json`
- Modify: `cloudflare-worker/README.md`
- Test: `tests/task-workflow.mjs`

- [x] Define the task upsert request/response, SharePoint Task ID uniqueness, authorized approval/status actions, retry outcome, and Calendar Event ID behavior in the existing contracts.
- [x] Extend the task contract test to check API behavior against the flow result fixture, including duplicate retry, event reuse and retention.
- [x] Run `node tests/task-workflow.mjs`; the documented contract cases pass.

### Task 4: Verify the integrated change and prepare a separate PR

**Files:**
- Test: `tests/task-workflow.mjs`
- Test: `tests/task-board-browser.mjs`
- Review: all files changed by Tasks 1–3

- [x] Run both focused tests and syntax checks for `portal.js`, `portal-api.js`, `cloudflare-worker/src/index.js`, and `cloudflare-worker/src/task-workflow.js`.
- [x] Review the diff for role bypasses, local-only success states, unstable retry keys, and any provider or customer writes. Review findings were fixed: failed retries now require current action authorization; task views preserve confirmed records and show pending sync failures; calendar sync status survives normalization; approval notes are sent and retained in history; and explicit Unassigned approval clears the requester's suggestion.
- [x] Run task workflow and browser acceptance checks, dashboard task preview checks, portal request routing checks, JSON contract parsing, D1 migration syntax, JavaScript syntax checks, and `git diff --check`.
- [x] Commit the scoped changes on `codex/gmt-task-workflows` and open a separate PR. Do not merge or deploy.

## Expected live gate

At task start, the 2026-10-16 read-only inspection found no dedicated `taskFormSubmitEndpoint`; the Worker health route was reachable, while protected routes required authentication. The repository's last recorded operational build status said the Task Calendar flow was disabled. No current provider verification was done in this implementation. Do not create a live task or claim SharePoint/Outlook completion until an approved internal test identity, delegated Flow Service consent, and the configured task workflow are available.

Integration note: the active calendar/request lifecycle branch changes these same seven paths in its branch or current worktree: `cloudflare-worker/src/index.js`, `docs/portal-request-approval-flow.md`, `portal.js`, `portal/index.html`, `power-platform/submission-envelope-contract.json`, `tasks/index.html`, and `tests/portal-request-routing.mjs`. Review the combined hunks when those branches are integrated. Mainline uses `0017_timesheet_delivery_receipts.sql`, and the separate user-management work reserves `0018_portal_access_restrictions.sql`. Task workflows use `0019_task_workflows.sql`; verify production migration state before applying either pending migration. Apply migrations in order and rerun migration checks before release.
