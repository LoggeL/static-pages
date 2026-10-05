#!/bin/zsh
# Erzeugt genau ein Bild über die Codex-CLI und kopiert es an den Zielpfad.
# Aufruf: scripts/art/codex_image.sh <ziel.png> "<prompt>" [referenz.png ...]
# Protokoll: output/imagegen/log.jsonl (Prompt, Referenzen, Ziel, Dauer, Ergebnis).
set -u
CODEX=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
ROOT=${0:A:h:h}
target=${1:?Zielpfad fehlt}
prompt=${2:?Prompt fehlt}
shift 2
target=${target:A}
mkdir -p "${target:h}" "$ROOT/output/imagegen"
refs=()
for r in "$@"; do refs+=("--image=${r:A}"); done
start=$(date +%s)
rm -f "$target"
instruction="Use your built-in image generation tool to create exactly ONE image for the following brief. Do not write code to draw it and do not edit it afterwards. After generation, copy the generated PNG file byte-for-byte to: $target
Then reply only with the copied path.

BRIEF:
$prompt"
"$CODEX" exec --skip-git-repo-check -c model_reasoning_effort="low" "${refs[@]}" "$instruction" < /dev/null > "$ROOT/output/imagegen/last-codex-${target:t:r}.log" 2>&1  # stdin zu, sonst hängt codex als Hintergrundjob
code=$?
dur=$(( $(date +%s) - start ))
ok=false
[[ -s "$target" ]] && ok=true
python3 - "$ROOT/output/imagegen/log.jsonl" "$target" "$prompt" "$dur" "$ok" "$@" <<'PY'
import json, sys, time
log, target, prompt, dur, ok, *refs = sys.argv[1:]
with open(log, "a") as f:
    f.write(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "target": target, "prompt": prompt,
                        "refs": refs, "seconds": int(dur), "ok": ok == "true"}, ensure_ascii=False) + "\n")
PY
if [[ $ok == true ]]; then
  echo "$target"
  exit 0
fi
echo "FEHLER: kein Bild erzeugt (codex exit $code). Log: $ROOT/output/imagegen/last-codex-${target:t:r}.log" >&2
exit 1
