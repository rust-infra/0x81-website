#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../third_party/MuseTalk"

video="${1:-data/video/yongen.mp4}"
audio="${2:-data/audio/yongen.wav}"
name="${3:-yongen_yongen}"

mkdir -p ../../outputs/demo

cat > configs/inference/demo.yaml <<YAML
task_0:
 video_path: "$video"
 audio_path: "$audio"
YAML

PYTHONPATH=./musetalk/utils:. ../../.venv/bin/python -m scripts.inference \
  --inference_config configs/inference/demo.yaml \
  --result_dir ../../outputs/demo \
  --unet_model_path ./models/musetalkV15/unet.pth \
  --unet_config ./models/musetalkV15/musetalk.json \
  --version v15 \
  --batch_size 4 \
  --use_float16 \
  --parsing_mode jaw \
  --output_vid_name "$name.mp4"

echo "output: $(cd ../.. && pwd)/outputs/demo/v15/$name.mp4"
