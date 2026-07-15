# GMT Power Platform Workspace

This directory keeps the company-owned Power Platform assets under source
control. It is separate from the public GitHub Pages app: browser code must
never contain a Microsoft password, Graph token, SharePoint token, connection
string, client secret, or Dataverse service principal secret.

## Current state

- PAC CLI is installed locally and has an interactive profile for the GMT
  tenant.
- The local `GMTWebAppSolution` solution has publisher prefix `gmt`.
- As of 15 July 2026, `pac env list` returned no Dataverse environments for
  the signed-in account. No Dataverse tables, canvas/model-driven app, or
  solution deployment can be created until GMT provisions an environment.
- Existing SharePoint Lists and the active Timesheet Intake Power Automate flow
  remain the operational baseline. This workspace does not replace them yet.

## Planned Dataverse scope

The first internal solution should contain:

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

An authorised Power Platform administrator must first provision a UK-region
production or sandbox environment with Dataverse, assign the required Power
Apps / Power Automate licences, and add at least two GMT administrators. Record
the resulting environment URL in a local shell variable; do not commit it as a
secret or use it in frontend code.

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
