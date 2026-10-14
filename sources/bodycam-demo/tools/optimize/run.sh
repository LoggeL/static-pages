#!/bin/bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
C14_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
C14_REPO="$(cd -- "$C14_DIR/../../../.." && pwd)"
C14_WORK="${C14_WORK:-${C7_WORK:-/Users/logge/Documents/Projects/bodycam-work/codex/C14/optimize}}"
C14_PUBLIC="$C14_REPO/public/bodycam-demo"
C14_REFERENCE="${C14_REFERENCE_TEXTURES:-/Users/logge/Documents/Projects/bodycam-work/codex/C7/originals/textures}"
C14_FINISH=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --stage-only|--allow-over-budget) C14_FINISH+=("$1"); shift ;;
    --reference-textures) [ "$#" -ge 2 ] || exit 2; C14_REFERENCE="$2"; shift 2 ;;
    *) echo 'Usage: run.sh [--stage-only|--allow-over-budget] [--reference-textures ORIGINAL_TEXTURES]' >&2; exit 2 ;;
  esac
done
if [ "${C7_LOCKED:-0}" != 1 ]; then
  export C14_WORK C14_REFERENCE_TEXTURES="$C14_REFERENCE"
  exec python3 "$C14_DIR/lock.py" "$C14_WORK" bash "$C14_DIR/run.sh" "${C14_FINISH[@]+${C14_FINISH[@]}}"
fi
C14_SOURCE=()
if [ -d "$C14_REFERENCE" ]; then C14_SOURCE=(--reference-textures "$C14_REFERENCE"); fi
python3 "$C14_DIR/pipeline.py" snapshot --public "$C14_PUBLIC" --work "$C14_WORK" "${C14_SOURCE[@]+${C14_SOURCE[@]}}"
mkdir -p "$C14_WORK/tools" "$C14_WORK/reports"
if ! cmp -s "$C14_DIR/package-lock.json" "$C14_WORK/tools/package-lock.json" || [ ! -d "$C14_WORK/tools/node_modules" ]; then
  cp "$C14_DIR/package.json" "$C14_DIR/package-lock.json" "$C14_WORK/tools/"
  npm ci --prefix "$C14_WORK/tools" --no-audit --no-fund
fi
if [ ! -x "$C14_WORK/tools/venv/bin/python" ]; then python3 -m venv "$C14_WORK/tools/venv"; fi
"$C14_WORK/tools/venv/bin/python" -m pip install --quiet -r "$C14_DIR/requirements.txt"
C14_PYTHON="$C14_WORK/tools/venv/bin/python"
(cd "$C14_WORK/tools" && npx --no-install gltf-transform --version)
"$C14_PYTHON" "$C14_DIR/inventory.py" --root "$C14_PUBLIC" --json "$C14_WORK/reports/pre-run.json" --markdown "$C14_WORK/reports/pre-run.md"
node "$C14_DIR/glb.mjs" --input "$C14_WORK/originals" --protected-input "$C14_PUBLIC" --output "$C14_WORK/staging" \
  --deps "$C14_WORK/tools/node_modules" --report "$C14_WORK/reports/glb.json" > "$C14_WORK/reports/glb.log"
C14_NORMALS=()
if [ -d "$C14_WORK/normal-originals" ]; then C14_NORMALS=(--normal-originals "$C14_WORK/normal-originals"); fi
"$C14_PYTHON" "$C14_DIR/textures.py" --originals "$C14_WORK/originals/textures" \
  --output "$C14_WORK/staging/textures" --report "$C14_WORK/reports/textures.json" "${C14_NORMALS[@]+${C14_NORMALS[@]}}"
"$C14_PYTHON" "$C14_DIR/pipeline.py" finish --public "$C14_PUBLIC" --work "$C14_WORK" "${C14_FINISH[@]+${C14_FINISH[@]}}"
"$C14_PYTHON" "$C14_DIR/inventory.py" --root "$C14_PUBLIC" --json "$C14_WORK/reports/after.json" --markdown "$C14_WORK/reports/after.md"
