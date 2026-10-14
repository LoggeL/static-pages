#!/bin/bash
# Welle 3: C18 (Arme) ∥ C21 (Endungen); danach C19 (NPC, nach C18); zuletzt C20 (Regression, nach allem).
export MODEL=gpt-6.1-sol
sleep 180
source <(sed -n '/^CODEX=/,/^}/p' "$(dirname "$0")/run.sh")
retry() { for n in 1 2 3 4 5 6; do job "$@"; grep "ENDE  $1 " "$OUT/progress.log" | tail -1 | grep -q "exit=0" && return; sleep 300; done; }
echo "$(date '+%F %T') ===== Lauf 4b (Welle 3, gpt-6.1-sol) =====" >> "$OUT/progress.log"
retry C18 C18_fp_arms_tech.md ultra & P18=$!
retry C21 C21_texture_extensions.md xhigh & P21=$!
wait $P18
retry C19 C19_npc_tech.md max
wait $P21
retry C20 C20_dev_pages_regression.md xhigh
echo "$(date '+%F %T') ===== Lauf 4b beendet =====" >> "$OUT/progress.log"
