#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYPI_MIRROR="${PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
GH_MIRROR="${GH_MIRROR:-https://ghfast.top}"
PYTHON="${PYTHON:-3.10}"
VENV_PY=".venv/bin/python"

if [ ! -x "$VENV_PY" ]; then
  uv venv --python "$PYTHON" .venv
fi

uv pip install --python "$VENV_PY" \
  torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 \
  --index-url https://download.pytorch.org/whl/cu118

UV_HTTP_TIMEOUT=60 uv pip install --python "$VENV_PY" --index-url "$PYPI_MIRROR" \
  diffusers==0.30.2 accelerate==0.28.0 opencv-python==4.9.0.80 soundfile==0.12.1 \
  transformers==4.39.2 huggingface_hub==0.30.2 librosa==0.11.0 einops==0.8.1 \
  gdown requests 'imageio[ffmpeg]' omegaconf ffmpeg-python moviepy tqdm \
  piper-tts==1.8.0 fastapi 'uvicorn[standard]' \
  'numpy==1.23.5' pip 'setuptools==69.5.1' wheel

UV_HTTP_TIMEOUT=60 uv pip install --python "$VENV_PY" --index-url "$PYPI_MIRROR" mmengine==0.10.4

UV_HTTP_TIMEOUT=60 uv pip install --python "$VENV_PY" --index-url "$PYPI_MIRROR" \
  mmcv==2.0.1 -f https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html

UV_HTTP_TIMEOUT=60 uv pip install --python "$VENV_PY" --index-url "$PYPI_MIRROR" \
  --no-build-isolation mmdet==3.1.0 mmpose==1.1.0

if [ ! -d third_party/MuseTalk ]; then
  tmp_zip="$(mktemp --suffix=.zip)"
  tmp_dir="$(mktemp -d)"
  curl -L "$GH_MIRROR/https://github.com/TMElyralab/MuseTalk/archive/refs/heads/main.zip" -o "$tmp_zip"
  unzip -q "$tmp_zip" -d "$tmp_dir"
  mkdir -p third_party/MuseTalk
  cp -a "$tmp_dir/MuseTalk-main/." third_party/MuseTalk/
  rm -rf "$tmp_zip" "$tmp_dir"
fi

ln -sfn ../../models third_party/MuseTalk/models

./scripts/download_weights.sh

mkdir -p models/piper/en_US-lessac-high
if [ ! -f models/piper/en_US-lessac-high/en_US-lessac-high.onnx ]; then
  curl -L "$HF_ENDPOINT/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx" \
    -o models/piper/en_US-lessac-high/en_US-lessac-high.onnx
  curl -L "$HF_ENDPOINT/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json" \
    -o models/piper/en_US-lessac-high/en_US-lessac-high.onnx.json
fi

./scripts/build_anchor.sh

"$VENV_PY" - <<'PY'
import torch

assert torch.cuda.is_available(), "CUDA is not available"
print(torch.__version__, torch.cuda.get_device_name(0))
PY

