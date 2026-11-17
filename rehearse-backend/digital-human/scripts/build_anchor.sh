#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

src="third_party/MuseTalk/data/video/sun.mp4"
out="assets/sun-anchor-720p.mp4"

if [ ! -f "$src" ]; then
  echo "missing anchor source: $src" >&2
  exit 1
fi

mkdir -p assets
ffmpeg -y -v error -i "$src" \
  -vf "crop=360:540:108:80,scale=720:1080:flags=lanczos,eq=contrast=1.03:saturation=0.85:brightness=-0.02,vignette=PI/6" \
  -an -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p "$out"

echo "anchor: $out"
