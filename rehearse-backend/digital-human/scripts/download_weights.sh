#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_ETAG_TIMEOUT=60
export HF_HUB_DOWNLOAD_TIMEOUT=60

HF=".venv/bin/huggingface-cli"
mkdir -p models

download() {
  "$HF" download "$@" --max-workers 1
}

download TMElyralab/MuseTalk \
  --local-dir models \
  --include 'musetalkV15/musetalk.json' 'musetalkV15/unet.pth'

download stabilityai/sd-vae-ft-mse \
  --local-dir models/sd-vae \
  --include 'config.json' 'diffusion_pytorch_model.bin'

download openai/whisper-tiny \
  --local-dir models/whisper \
  --include 'config.json' 'pytorch_model.bin' 'preprocessor_config.json'

download yzd-v/DWPose \
  --local-dir models/dwpose \
  --include 'dw-ll_ucoco_384.pth'

download ManyOtherFunctions/face-parse-bisent \
  --local-dir models/face-parse-bisent \
  --include '79999_iter.pth' 'resnet18-5c106cde.pth'

s3fd="$HOME/.cache/torch/hub/checkpoints/s3fd-619a316812.pth"
if [ ! -f "$s3fd" ]; then
  mkdir -p "$(dirname "$s3fd")"
  curl -L "$HF_ENDPOINT/n0x1103/s3fd/resolve/main/s3fd-619a316812.pth" -o "$s3fd"
fi

actual="$(sha256sum "$s3fd" | cut -d' ' -f1)"
expected="619a31681264d3f7f7fc7a16a42cbbe8b23f31a256f75a366e5a1bcd59b33543"
if [ "$actual" != "$expected" ]; then
  echo "s3fd checksum mismatch: $actual" >&2
  exit 1
fi

echo "weights ready: $(du -sh models | cut -f1)"

