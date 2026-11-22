# GMT Power Platform Workspace

This directory keeps the company-owned Power Platform assets under source
control. It is separate from the public GitHub Pages app: browser code must
never contain a Microsoft password, Graph token, SharePoint token, connection
string, client secret, or Dataverse service principal secret.

## Current state

- PAC CLI is installed locally and has an interactive profile for the GMT
  tenant.
- The local `GMTWebAppSolution` solution has publisher prefix `gmt`.
- The free `GMT Portal Development` Dataverse environment is provisioned in the
  Europe region.
- The `GMTWebAppSolution` contains the published `GMT Staff Portal`
  model-driven app shell. Its navigation is being populated as the proof is
  completed.
- The developer environment contains six proof tables: Timesheet Submission,
  Clock Event, Audit Submission, Job Card, Task and Calendar Event. They have
  been added to `GMTWebAppSolution` and are captured by its export. They use
  the environment prefix (`crbf9_`), not the intended production `gmt_`
  prefix, so they must be rebuilt or formally migrated before promotion. This
  is deliberate technical debt recorded in `developer-environment.md`, not a
  production schema decision.
- Existing SharePoint Lists and the active Timesheet Intake Power Automate flow
  remain the operational baseline. This workspace does not replace them yet.

## Planned Dataverse scope

The target production solution should contain:

- `gmt_timesheetsubmission`
- `gmt_auditsubmission`
- `gmt_jobcard`
- `gmt_task`
- `gmt_clockevent`
- one internal staff Power App
- cloud flows for Timesheets, Audit, Job Cards, Tasks and calendar updates
- connection references and environment variables, rather than personal
  connections or hard-coded mailbox names

The public static website continues to submit through its approved FormSubmit
routes during the trial. Dataverse and Power Apps are for the authenticated
internal operational portal once licensing and security roles are approved.

## One-time Dataverse gate

An authorised Power Platform administrator must provision a paid production or
sandbox environment with Dataverse only after the Developer Plan proof is
accepted. Assign the required Power Apps / Power Automate licences and add at
least two GMT administrators. Record the resulting environment URL in a local
shell variable; do not use it in frontend code.

```bash
export GMT_DATAVERSE_URL='https://YOUR-ORG.crm11.dynamics.com'
pac auth create --name GMT-Production --environment "$GMT_DATAVERSE_URL" --deviceCode
```

Then export the unmanaged solution after creating assets in the maker portal:

```bash
./power-platform/scripts/export-solution.sh
```

## Commands

```bash
./power-platform/scripts/check-toolchain.sh
pwsh ./power-platform/scripts/Connect-GmtMicrosoft365.ps1 -ValidateOnly
./power-platform/scripts/export-solution.sh
```

Run `Connect-GmtMicrosoft365.ps1` without `-ValidateOnly` only when an
administrator is present to approve the requested delegated Microsoft sign-in.

`import-solution.sh` intentionally requires `GMT_DATAVERSE_URL` and is a
deployment action. Review the generated zip before running it.

The concrete non-production flow build order, shared-calendar access gate and
Timesheet Intake attachment extension are recorded in
[`operational-readiness-build.md`](operational-readiness-build.md).
The current observed-vs-target intake repair contract is
[`timesheet-monthly-upsert-flow-spec.json`](timesheet-monthly-upsert-flow-spec.json).
It documents the 28 September live flow mismatch and is not a claim that the
target routing or replay has been deployed. The local
[`intake-record-routing.mjs`](intake-record-routing.mjs) validator exercises
legacy and correction attachment shapes against Date-column pay months.

### Timesheet correction delivery receipts

The local Worker also contains a disabled private-folder resolver at
`POST /api/integrations/private-timesheet-route`. It uses the same protected
delivery-key header and accepts exactly `recordId`, `generation`, `flowRunId`
and `runStartedAt`. It checks
the saved source and pay cycle, requires a delivery attempt, verifies the
employee folder's current permissions, checks the exact month folder and
workbook's ancestry and permissions, and returns their IDs, the pay month and
the exact generation-verified source as `sourceBase64`. The response contains
timesheet data and must use secure outputs; pass its decoded source to the
Office Script rather than trusting the incoming message's attachment.
The first verified directory lookup binds the employee address to its Entra
object ID. A later address reuse or account rename is held for explicit
reconciliation rather than silently granting another identity access. The
initial binding relies on the directory and the authorised employee selection;
it does not prove the historical identity of a previously reused address.
An additional disabled switch can create a missing blank workbook after an
exclusive reservation; an uncertain attempt remains held for review. The
parent must already be private to Admin and the site owners. The resolver
rechecks the saved source, queue and pay period after verification, but cannot
prevent changes after the response or prove that the receiving flow used the
returned file. Do not enable the resolver, provisioning or delivery switches
until those gaps and the live private workbook and receipt tests are resolved.
The resolver records the selected workbook against one run for each source
generation. Another run cannot obtain that generation's route, and a run
cannot resolve it again after a workbook verification or terminal receipt.
An interrupted run or ambiguous outcome therefore remains held until it is
reconciled; never start another workbook write automatically.

The portal can show end-to-end correction stages only after the Power Automate
flow posts authenticated receipts to the Cloudflare Worker. The local target
contract is documented in
[`timesheet-monthly-upsert-flow-spec.json`](timesheet-monthly-upsert-flow-spec.json);
it is **not configured in the live flow yet**.

For each existing protected correction, the flow must carry the exact
`gmt_delivery_generation` value from the dispatched message into every receipt.
It is the lowercase SHA-256 digest of the exact JSON attachment bytes; the
Worker checks it against the currently queued attachment. A missing or stale
generation cannot verify a later correction, even when its dates are the same.
An unsent, queued correction cannot receive delivery evidence. A failed
attempt may have reached the provider before a timeout, so its callback can
still be accepted as evidence; it does not automatically release the queue.
The flow must use the same provider run name and RFC 3339 start timestamp for
all events. Require an accepted `flow_started` receipt after source validation
and routing and before the workbook write. The Office Script returns
`verifiedRecordIds`, `verifiedRecordIdsJson`, `verifiedRowsJson` and
`unverifiedRecordIds` only after
re-reading `Daily Entries` and `Weekly Totals` and comparing the dated rows,
payroll cells and totals. The two JSON text fields carry the original array
values, including null for an unknown break or total; send both fields to the
receipt endpoint without mixing them with the corresponding array fields.
Recreate the Excel Run script action after changing the return type, and verify
its mappings again. Post `workbook_verified` only when every
source row is present and verified, and the created/updated/unchanged counts
match the verified row count. The local private-route contract requires each
verified row's read-back start, finish, break, absence, total and notes; the
Worker compares these to the protected source and retains only row identities
in the receipt. Secure inputs and outputs on every action that handles those
values, including the script, parsing and callback actions. The older
`upsert-monthly-timesheet-row.ts` returns IDs and dates only and cannot satisfy
this stronger contract. In the normal path, record that receipt before
updating the history index. Post `flow_completed` after all required
downstream actions succeed, or `flow_failed` with one of the contract's
allowed stages and a sanitised, single-line error.

The callback uses `POST /api/integrations/timesheet-delivery-receipts`, JSON,
and the `X-GMT-Delivery-Key` header. Configure the same randomly generated
secret as the Cloudflare Worker secret `TIMESHEET_DELIVERY_CALLBACK_KEY` and a
secured Power Automate environment variable or approved secret store. Do not
put secret values in this repository, flow exports, workbook content, browser
code or ordinary action logs; enable secure inputs and outputs for callback
actions. A `workbook_verified` callback includes the exact `workbookId` returned
by the resolver. The Worker compares it with the saved run route; it cannot be
used to choose another workbook. The flow must use that same ID in its Excel
action and retain the action inputs and workbook read-back for audit. A callback
alone is not independent proof that Power Automate used the claimed file.

Callback identity is `(recordId, flowRunId, event)` with the same required
`generation` in each event. Retry a failed callback action with the original
identity, timestamp and identical body; matching retries are idempotent. If the
start receipt is not confirmed, hold before the workbook write. If the
verification receipt is not confirmed, hold before the history update and do
not repeat the workbook write. Preserve the evidence and reconcile an
unresolved outcome before retrying any later stage. A missing receipt remains
“Not reported” in the portal;
email acceptance alone does not prove a flow run or workbook update. Live flow
configuration, Worker secret provisioning and a controlled synthetic
end-to-end run still require an authorised Power Platform operator.

The optional `tools/GmtDataverseBootstrap` project is a controlled, local
metadata bootstrap for a fresh developer environment. It was **not** used to
create the current `crbf9_` proof tables. Do not run it against production and
do not use it to repair the current proof without an explicit schema migration
decision.

## Ownership and security

- Use GMT-owned connections and share every production flow with a second GMT
  administrator.
- Put mailbox, SharePoint site and calendar identifiers in Power Platform
  environment variables / connection references.
- Create a dedicated shared calendar, such as `GMT Operational Calendar`, for
  job planning and task events. Do not automate an individual employee's
  calendar.
- Use Microsoft Entra security groups and Dataverse roles for staff access.
- Keep the current SharePoint Lists as the migration index until the Dataverse
  cutover is signed off.
