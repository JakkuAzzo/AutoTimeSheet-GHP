# GMT Dataverse Bootstrap

This local developer tool can create the six `gmt_` GMT Staff Portal tables
defined in `../../developer-environment.md` in a fresh, approved non-production
environment. The schema includes the identifiers, attachment links and calendar
synchronisation fields required by the operational contract.

It uses Microsoft device-code authentication against the free GMT Portal
Development environment. No password, client secret, token or data is stored in
the repository. It is intentionally limited to metadata creation and is not a
production migration tool.

```bash
cd power-platform/tools/GmtDataverseBootstrap
dotnet run                 # inspect which tables are present
dotnet run -- --apply      # create missing tables in the developer environment
```

It was **not** used to create the current `crbf9_` proof tables. Do not use it
against the current proof or a production environment unless a GMT administrator
has approved the schema migration and target solution. The command never moves
or imports operational data.

After a successful, approved run, export the `GMTWebAppSolution` using
`../../scripts/export-solution.sh` so the generated Dataverse metadata is
captured under source control.
