#!/bin/bash
# probe.sh <id> <duration> <step> : grab thumbnails every step seconds via stream URL
id=$1; dur=$2; step=$3; d=probe_$id; mkdir -p $d; url=$(cat url_$id.txt)
n=0
for ((t=5; t<dur; t+=step)); do
  ffmpeg -v error -y -ss $t -i "$url" -frames:v 1 -vf "scale=320:-2" $d/$(printf %05d $t).jpg 2>/dev/null &
  n=$((n+1)); if (( n % 12 == 0 )); then wait; fi
done; wait
python3 -I "$(dirname "$0")/sheet.py" $d sheet_$id
