#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vmctl="$repo_root/tooling/windows/vm-control/vmctl"
host_output="$repo_root/output/solid-edge-bom-semantics/bom-semantics-evidence.json"
guest_output='C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\bom-semantics\bom-semantics-evidence.json'
guest_executable='C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\tools\bom-semantics\IV.SolidEdge.BomSemanticsProbe.exe'
export IV_CONNECT_VM_NAME="${IV_CONNECT_VM_NAME:-IV-Connect-SolidEdge-Dev}"

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64
}

"$vmctl" start >/dev/null
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\build_bom_semantics_probe.ps1'

clear_output="Remove-Item -LiteralPath '$guest_output' -Force -ErrorAction SilentlyContinue"
encoded="$(encode_powershell "$clear_output")"
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "$encoded"

set +e
"$vmctl" exec -- "$guest_executable" "$guest_output" --variant1-only
probe_exit=$?
set -e

read_script="\$ProgressPreference='SilentlyContinue'; [Console]::Write([Convert]::ToBase64String([IO.File]::ReadAllBytes('$guest_output')))"
encoded="$(encode_powershell "$read_script")"
mkdir -p "$(dirname "$host_output")"
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -EncodedCommand "$encoded" | base64 --decode > "$host_output"

jq -e . "$host_output" >/dev/null
printf 'BOM-semantics evidence synchronized to %s (probe exit %s).\n' "$host_output" "$probe_exit"
exit "$probe_exit"
