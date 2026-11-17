#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
exec .venv/bin/uvicorn service.app:app --host "${DH_HOST:-0.0.0.0}" --port "${DH_PORT:-8765}"
