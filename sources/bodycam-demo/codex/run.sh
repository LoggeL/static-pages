#!/bin/bash
# Delegierte Bodycam-Aufträge an Codex (gpt-6-astra) mit Abhängigkeiten ausführen.
# Start:  nohup bash sources/bodycam-demo/codex/run.sh > /Users/logge/Documents/Projects/bodycam-work/codex/run.log 2>&1 &
# Einzeln: bash run.sh C4   (führt nur diesen Auftrag aus)
CODEX=/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
REPO=/Users/logge/Documents/Projects/static-pages
HERE=$REPO/sources/bodycam-demo/codex
WORK=/Users/logge/Documents/Projects/bodycam-work/codex
OUT=$HERE/out
mkdir -p "$OUT" "$WORK/logs"

job() {  # job <ID> <brief-datei> <effort>
  local id=$1 brief=$2 effort=$3
  echo "$(date '+%F %T') START $id ($effort)" >> "$OUT/progress.log"
  "$CODEX" exec -C "$REPO" -m "${MODEL:-gpt-6-astra}" -c "model_reasoning_effort=\"$effort\"" \
    -o "$OUT/$id.last.md" \
    "Du bist ein Codex-Auftragnehmer für die Bodycam-Tech-Demo. Lies zuerst sources/bodycam-demo/codex/briefs/_common.md und dann sources/bodycam-demo/codex/briefs/$brief und führe Auftrag $id vollständig und selbstständig aus. Es gibt keine Rückfragen; triff technische Entscheidungen selbst und dokumentiere sie in sources/bodycam-demo/status/$id.md." \
    > "$WORK/logs/$id.log" 2>&1
  local rc=$?
  echo "$(date '+%F %T') ENDE  $id exit=$rc" >> "$OUT/progress.log"
}

if [ -n "$1" ]; then
  f=$(ls "$HERE/briefs" | grep "^$1_" | head -1); job "$1" "$f" "${2:-xhigh}"; exit
fi

echo "$(date '+%F %T') ===== Lauf gestartet =====" >> "$OUT/progress.log"
# Welle 1: unabhängig
job C12 C12_world_player.md max   & P12=$!
job C4  C4_audio.md         xhigh & P4=$!
job C5  C5_postfx.md        max   & P5=$!
job C13 C13_harness.md      xhigh & P13=$!
job C9  C9_weapon_tech.md   xhigh & P9=$!
job C10 C10_character_tech.md xhigh & P10=$!
# Welle 2: braucht Welt/Spieler
wait $P12
job C3 C3_weapon_logic.md xhigh & P3=$!
job C6 C6_lightmaps.md    max   & P6=$!
# App-Gerüst: braucht Welt, Waffe, Audio, Post-FX
wait $P3 $P4 $P5
job C11 C11_appshell.md xhigh & P11=$!
# Optimierung zuletzt, wenn alles andere fertig ist
wait $P6 $P9 $P10 $P11 $P13
job C7 C7_optimize.md xhigh
echo "$(date '+%F %T') ===== Lauf beendet =====" >> "$OUT/progress.log"
