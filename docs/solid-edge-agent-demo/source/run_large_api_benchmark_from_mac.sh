#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vmctl="$repo_root/tooling/windows/vm-control/vmctl"
manifest="$repo_root/output/solid-edge-large-assembly/fixture-manifest.json"
guest_output='C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\large-api-benchmark-output'
host_output="$repo_root/output/solid-edge-large-assembly/api-benchmark"
iterations="${1:-10}"
warmups="${2:-2}"
cold_iterations="${3:-0}"
export IV_CONNECT_VM_NAME="${IV_CONNECT_VM_NAME:-IV-Connect-SolidEdge-Dev}"

if ! [[ "$iterations" =~ ^[1-9][0-9]*$ && "$warmups" =~ ^[0-9]+$ && "$cold_iterations" =~ ^[0-9]+$ ]]; then
  printf 'Usage: %s [measured-iterations] [warmups] [application-cold-iterations]\n' "$0" >&2
  exit 2
fi
if [[ ! -f "$manifest" ]]; then
  printf 'Missing fixture manifest: %s\n' "$manifest" >&2
  exit 2
fi

run_id="$(jq -er '.run_id' "$manifest")"
encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64
}

"$vmctl" start >/dev/null
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\build_api_benchmark.ps1'

set +e
windows_args=(
  -RunId "$run_id"
  -Iterations "$iterations"
  -Warmups "$warmups"
  -ColdIterations "$cold_iterations"
)
if [[ "$cold_iterations" -gt 0 ]]; then
  windows_args+=(-AllowApplicationRestart)
fi
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\run_large_api_benchmark_windows.ps1' \
  "${windows_args[@]}"
benchmark_exit=$?
set -e

if [[ "$benchmark_exit" -ne 0 && "$benchmark_exit" -ne 2 ]]; then
  printf 'Large-fixture benchmark failed with exit code %s before synchronization.\n' "$benchmark_exit" >&2
  exit "$benchmark_exit"
fi

mkdir -p "$host_output"
files=(
  api-benchmark-environment.json
  api-benchmark-runs.csv
  api-benchmark-runs.json
  api-benchmark-summary.json
  api-capabilities.json
  api-contracts.txt
)

if [[ "$cold_iterations" -gt 0 ]]; then
  files+=(
    api-start-mode-runs.json
    api-start-mode-runs.csv
    api-start-mode-summary.json
    api-start-mode-environment.json
  )
fi

for name in "${files[@]}"; do
  read_script="\$ProgressPreference=\"SilentlyContinue\"; [Console]::Write([Convert]::ToBase64String([IO.File]::ReadAllBytes(\"$guest_output\\$name\")))"
  encoded="$(encode_powershell "$read_script")"
  "$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
    -EncodedCommand "$encoded" | base64 --decode > "$host_output/$name"
done

jq -e . "$host_output/api-benchmark-environment.json" >/dev/null
jq -e . "$host_output/api-benchmark-runs.json" >/dev/null
jq -e . "$host_output/api-benchmark-summary.json" >/dev/null
jq -e . "$host_output/api-capabilities.json" >/dev/null
if [[ "$cold_iterations" -gt 0 ]]; then
  jq -e . "$host_output/api-start-mode-runs.json" >/dev/null
  jq -e . "$host_output/api-start-mode-summary.json" >/dev/null
  jq -e . "$host_output/api-start-mode-environment.json" >/dev/null
fi

printf 'Large-fixture benchmark raw data synchronized to %s (benchmark exit %s).\n' "$host_output" "$benchmark_exit"
