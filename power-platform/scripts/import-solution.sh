#!/usr/bin/env bash
set -euo pipefail

: "${GMT_DATAVERSE_URL:?Set GMT_DATAVERSE_URL to the approved Dataverse environment URL.}"

solution_name="${GMT_SOLUTION_NAME:-GMTWebAppSolution}"
root="$(cd "$(dirname "$0")/.." && pwd)"
zip_path="$root/exports/${solution_name}_unmanaged.zip"

mkdir -p "$root/exports"
pac solution pack --folder "$root/${solution_name}/src" --zipfile "$zip_path" --packagetype Unmanaged
pac auth select --environment "$GMT_DATAVERSE_URL"
pac solution import --path "$zip_path" --publish-changes

echo "Imported $solution_name into $GMT_DATAVERSE_URL."
