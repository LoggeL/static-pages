#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
vmctl="$repo_root/tooling/windows/vm-control/vmctl"
host_output="$repo_root/output/solid-edge-large-assembly"
export IV_CONNECT_VM_NAME="${IV_CONNECT_VM_NAME:-IV-Connect-SolidEdge-Dev}"

encode_powershell() {
  printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64
}

"$vmctl" start >/dev/null
"$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
  -ExecutionPolicy Bypass -File 'Z:\tooling\solid-edge\build_large_assembly_demo_tool.ps1'
"$vmctl" exec -- \
  'C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\tools\IV.SolidEdge.LargeAssemblyDemo.exe'

latest_script='$latest=Get-ChildItem -LiteralPath "C:\Users\iv-dev\Documents\IV-SolidEdge-Demo\large-assembly-demo\runs" -Directory | Sort-Object LastWriteTimeUtc | Select-Object -Last 1; [Console]::Write($latest.FullName)'
latest_encoded="$(encode_powershell "$latest_script")"
latest_run="$("$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "$latest_encoded" | tr -d '\r\n')"
if [[ -z "$latest_run" ]]; then
  printf 'No large-assembly run directory found.\n' >&2
  exit 1
fi

latest_name="$(printf '%s' "$latest_run" | tr '\\' '\n' | tail -n 1)"
host_snapshot="$host_output/runtime-snapshots/$latest_name"
mkdir -p "$host_output" "$host_snapshot"
files=(
  fixture-manifest.json
  IV_OVN_BACK.par
  IV_OVN_CONTROL.par
  IV_OVN_DOOR.par
  IV_OVN_FOOT.par
  IV_OVN_HANDLE.par
  IV_OVN_HEATER.par
  IV_OVN_KNOB.par
  IV_OVN_NAMEPLATE.par
  IV_OVN_RACK.par
  IV_OVN_SIDE.par
  IV_OVN_TOP.par
  IV_OVN_MODULE_SHELL.asm
  IV_OVN_MODULE_DOOR.asm
  IV_OVN_MODULE_CHAMBER.asm
  IV_OVN_MODULE_SERVICE.asm
  IV_InnovaVento_Oven_Factory.asm
  IV_InnovaVento_Oven_Factory.dft
  IV_InnovaVento_Oven_Factory.stp
  IV_InnovaVento_Oven_Factory.pdf
  "IV_InnovaVento_Oven_Factory_Assembly views.pri"
  IV_InnovaVento_Oven_Factory.metadata.json
  IV_InnovaVento_Oven_Factory.bom.json
  IV_InnovaVento_Oven_Factory.bom.csv
  IV_InnovaVento_Oven_Factory.analysis.json
)
for name in "${files[@]}"; do
  read_script="[Console]::Write([Convert]::ToBase64String([IO.File]::ReadAllBytes(\"$latest_run\\runtime-snapshot\\$name\")))"
  encoded="$(encode_powershell "$read_script")"
  "$vmctl" exec -- powershell.exe -NoLogo -NoProfile -NonInteractive \
    -EncodedCommand "$encoded" | base64 --decode > "$host_snapshot/$name"
done

pdf_python="${IV_CONNECT_PDF_PYTHON:-python3}"
if ! "$pdf_python" -c 'import pypdf' >/dev/null 2>&1; then
  bundled_python='/Users/logge/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
  if [[ -x "$bundled_python" ]] && "$bundled_python" -c 'import pypdf' >/dev/null 2>&1; then
    pdf_python="$bundled_python"
  else
    printf 'pypdf is required to assemble the native per-sheet PDF outputs.\n' >&2
    exit 1
  fi
fi
primary_pdf="$host_snapshot/IV_InnovaVento_Oven_Factory.pdf"
detail_pdf="$host_snapshot/IV_InnovaVento_Oven_Factory_Assembly views.pri"
merged_pdf="$host_snapshot/IV_InnovaVento_Oven_Factory.merged.pdf"
"$pdf_python" "$repo_root/tooling/docs/merge_pdf_pages.py" \
  "$merged_pdf" "$primary_pdf" "$detail_pdf"
mv "$merged_pdf" "$primary_pdf"
cp "$primary_pdf" "$host_output/IV_InnovaVento_Oven_Factory.pdf"

jq -e . "$host_snapshot/fixture-manifest.json" >/dev/null
jq -e . "$host_snapshot/IV_InnovaVento_Oven_Factory.bom.json" >/dev/null
jq -e . "$host_snapshot/IV_InnovaVento_Oven_Factory.metadata.json" >/dev/null
jq -e . "$host_snapshot/IV_InnovaVento_Oven_Factory.analysis.json" >/dev/null
cp "$host_snapshot/fixture-manifest.json" "$host_output/fixture-manifest.json"
cp "$host_snapshot/IV_InnovaVento_Oven_Factory.bom.json" "$host_output/IV_InnovaVento_Oven_Factory.bom.json"
cp "$host_snapshot/IV_InnovaVento_Oven_Factory.bom.csv" "$host_output/IV_InnovaVento_Oven_Factory.bom.csv"
printf 'Large-assembly evidence synchronized from %s to %s.\n' "$latest_run" "$host_snapshot"
