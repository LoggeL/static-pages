#!/bin/sh
# Lossless WebP siblings for every RGBM lightmap PNG (rgbm.js loads them where the browser reads
# them byte-exact, otherwise the PNG). -exact keeps RGB under low alpha; run after every bake.
set -e
cd "$(dirname "$0")/../../../public/bodycam-demo"
for png in lightmaps/*.png mobile/lightmaps/*.png; do
  webp="${png%.png}.webp"
  [ "$webp" -nt "$png" ] && continue
  cwebp -quiet -lossless -exact -z 9 -mt "$png" -o "$webp" &
done
wait
