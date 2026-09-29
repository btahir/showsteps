#!/usr/bin/env bash
# MP4 (2000x1250, 15 fps) -> looping animated WebP at 1000 px wide.
#   hero/to-webp.sh <in.mp4> <out.webp> [quality 0-100, default 68]
# ffmpeg here has no libwebp, so: frames -> PNG (lanczos downscale) -> img2webp (libwebp tools).
set -euo pipefail
IN="$1"; OUT="$2"; Q="${3:-68}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ffmpeg -hide_banner -loglevel error -threads 4 -i "$IN" -vf "scale=1000:-2:flags=lanczos" "$TMP/f%04d.png"
N=$(ls "$TMP"/f*.png | wc -l | tr -d ' ')
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$IN" | awk -F/ '{printf "%d", ($2? $1/$2 : $1)}')
D=$(( 1000 / FPS ))
img2webp -loop 0 -lossy -q "$Q" -m 6 -d "$D" "$TMP"/f*.png -o "$OUT" >/dev/null
SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")
echo "wrote $OUT: $N frames @ ${FPS} fps, $(( SIZE / 1024 )) KB"
