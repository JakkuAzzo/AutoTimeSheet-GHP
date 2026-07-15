#!/usr/bin/env bash
set -euo pipefail

: "${GMT_DATAVERSE_URL:?Set GMT_DATAVERSE_URL to the approved Dataverse environment URL.}"

solution_name="${GMT_SOLUTION_NAME:-GMTWebAppSolution}"
output_dir="$(cd "$(dirname "$0")/.." && pwd)/exports"
mkdir -p "$output_dir"

# PAC 2.x selects an authenticated Dataverse target through `env`, not `auth`.
pac env select --environment "$GMT_DATAVERSE_URL"
pac solution export --name "$solution_name" --path "$output_dir/${solution_name}_unmanaged.zip" --managed false --overwrite
pac solution unpack --zipfile "$output_dir/${solution_name}_unmanaged.zip" --folder "$(cd "$(dirname "$0")/.." && pwd)/${solution_name}/src" --allowDelete true

echo "Exported and unpacked $solution_name. Review git diff before committing."
