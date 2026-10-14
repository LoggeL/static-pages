#!/bin/bash
# Zweite Codex-Welle (14.10.): Props, Post-FX-Fix, Integration, Regression.
source <(sed -n '/^CODEX=/,/^}/p' "$(dirname "$0")/run.sh")
echo "$(date '+%F %T') ===== Lauf 2 gestartet =====" >> "$OUT/progress.log"
job C17 C17_missing_props.md xhigh & P17=$!
job C15 C15_postfx_artifacts.md max & P15=$!
wait $P17
job C14 C14_integration.md max & P14=$!
wait $P14 $P15
job C16 C16_harness_regression.md xhigh
echo "$(date '+%F %T') ===== Lauf 2 beendet =====" >> "$OUT/progress.log"
