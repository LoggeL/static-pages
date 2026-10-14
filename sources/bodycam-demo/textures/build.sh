#!/bin/sh
# Texturen der Bodycam-Demo reproduzierbar erzeugen.
#   RAW: Ablage der Imagegen-Rohbilder (Scratch, nicht im Repo)
# 1) Rohbilder (Codex-Imagegen, gpt-image-2; vorhandene werden uebersprungen)
# 2) PBR-Sets (albedo/normal/orm) + index.json   3) Decals (RGBA-PNG) + index.json["decals"]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
RAW=${RAW:?RAW=<rohbild-ordner> setzen}
OUT=${OUT:-$HERE/../../../public/bodycam-demo/textures}
python3 "$HERE/gen.py" "$RAW" --jobs 2
python3 "$HERE/gen.py" "$RAW" ceiling_stained --variant v2 --jobs 1   # v1 hatte zu dominante Wasserflecken
python3 -I "$HERE/process.py" "$RAW" "$OUT" ${PREVIEW:+--preview "$PREVIEW"}
python3 -I "$HERE/decals.py" "$RAW" "$OUT" ${PREVIEW:+--preview "$PREVIEW"}
