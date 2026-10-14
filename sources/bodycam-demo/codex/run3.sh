#!/bin/bash
# Wiederanlauf nach 429: C17 → C14, danach (wenn C15 fertig) C16.
source <(sed -n '/^CODEX=/,/^}/p' "$(dirname "$0")/run.sh")
retry() { for n in 1 2 3; do job "$@"; grep "ENDE  $1 " "$OUT/progress.log" | tail -1 | grep -q "exit=0" && return; sleep 300; done; }
echo "$(date '+%F %T') ===== Lauf 3 (Wiederanlauf) =====" >> "$OUT/progress.log"
while pgrep -f "Auftrag C15 " >/dev/null; do sleep 60; done
retry C17 C17_missing_props.md xhigh
retry C14 C14_integration.md max
while pgrep -f 'Auftrag C15 ' >/dev/null; do sleep 60; done
retry C16 C16_harness_regression.md xhigh
echo "$(date '+%F %T') ===== Lauf 3 beendet =====" >> "$OUT/progress.log"
