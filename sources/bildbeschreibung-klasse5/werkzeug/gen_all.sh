#!/bin/zsh
# Erzeugt alle Bilder parallel über Codex (Rohbilder nach output/imagegen/raw/)
cd ${0:A:h:h}
for n in "$@"; do
  ( werkzeug/codex_image.sh output/imagegen/raw/$n.png "$(cat werkzeug/prompts/$n.txt)" && echo "OK $n" || echo "FAIL $n" ) &
done
wait
