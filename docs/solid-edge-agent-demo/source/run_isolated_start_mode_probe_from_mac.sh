#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vmctl="$repo_root/tooling/windows/vm-control/vmctl"
mode="${1:-}"
iteration="${2:-1}"
timeout_seconds="${3:-240}"
manifest="$repo_root/output/solid-edge-large-assembly/fixture-manifest.json"
host_output="$repo_root/output/solid-edge-large-assembly/api-benchmark"
guest_result="C:/Users/iv-dev/Documents/IV-SolidEdge-Demo/large-api-benchmark-output/start-mode-isolated/$mode-$iteration.json"
export IV_CONNECT_VM_NAME="${IV_CONNECT_VM_NAME:-IV-Connect-SolidEdge-Dev}"

case "$mode" in
  interactive_normal|interactive_file_open|automation_spawned) ;;
  *) printf 'Usage: %s <interactive_normal|interactive_file_open|automation_spawned> [iteration] [timeout-seconds]\n' "$0" >&2; exit 2 ;;
esac
if ! [[ "$iteration" =~ ^[1-9][0-9]*$ && "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Iteration and timeout must be positive integers.\n' >&2
  exit 2
fi
if [[ ! -f "$manifest" ]]; then
  printf 'Missing fixture manifest: %s\n' "$manifest" >&2
  exit 2
fi

run_id="$(jq -er '.run_id' "$manifest")"
mkdir -p "$host_output"

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64
}

"$vmctl" start >/dev/null
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\build_api_benchmark.ps1' >/dev/null
launch_json="$("$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\start_mode_probe_async.ps1' \
  -StartMode "$mode" -RunId "$run_id" -Iteration "$iteration" | tr -d '\r')"
printf '%s\n' "$launch_json"

screenshot="$host_output/start-mode-$mode-$iteration.png"
sleep 8
"$vmctl" capture "$screenshot" >/dev/null

deadline=$((SECONDS + timeout_seconds))
while (( SECONDS < deadline )); do
  if "$vmctl" exec -- cmd.exe /d /c \
    "if exist \"$guest_result\" (exit /b 0) else (exit /b 1)" >/dev/null 2>&1; then
    read_script="[Console]::Write([Convert]::ToBase64String([IO.File]::ReadAllBytes(\"$guest_result\")))"
    read_encoded="$(encode_powershell "$read_script")"
    host_result="$host_output/start-mode-$mode-$iteration.json"
    "$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
      -EncodedCommand "$read_encoded" | base64 --decode > "$host_result"
    jq -e --arg mode "$mode" --argjson iteration "$iteration" \
      '.start_mode == $mode and .iteration == $iteration' "$host_result" >/dev/null
    jq '{start_mode,iteration,success,stages,timings_ms,addin,cleanup,error_stage,error_type,error_message}' "$host_result"
    jq -e '.success == true' "$host_result" >/dev/null
    exit 0
  fi
  sleep 2
done

printf 'Timed out after %ss waiting for %s; no process was terminated. Screenshot: %s\n' \
  "$timeout_seconds" "$guest_result" "$screenshot" >&2
exit 124
