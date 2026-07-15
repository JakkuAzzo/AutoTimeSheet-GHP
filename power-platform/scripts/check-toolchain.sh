#!/usr/bin/env bash
set -euo pipefail

for command in dotnet pac pwsh; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

printf 'dotnet: '
dotnet --version
printf 'pac: '
pac help | sed -n '2p'
printf 'PowerShell: '
pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

echo 'PAC profiles:'
pac auth list
