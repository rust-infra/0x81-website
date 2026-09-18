#!/usr/bin/env bash
# 本地开发启动脚本（不进 Docker）。
# - 自动加载 .env（PORT/DATABASE_URL/ADMIN_TOKEN 等）
# - 直接使用宿主机本地代理 127.0.0.1:7890（无需 Allow LAN / host-gateway）
# - 用法: ./dev-run.sh [cargo 参数...]，如 ./dev-run.sh（默认 release 构建）
set -euo pipefail
cd "$(dirname "$0")"

# 加载 .env（set -a 让变量同时被 export）
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# 非 JWT 的 legacy token 兜底认证：**只在本地开发打开**。
# 它会让任何 Bearer 值（如 moyan-app「粘贴 token」开发登录）自动建号通过，
# 线上/容器里一律默认关闭，见 middleware/auth.rs 的 legacy_token_auth_allowed。
export ALLOW_LEGACY_TOKEN_AUTH="${ALLOW_LEGACY_TOKEN_AUTH:-1}"

# 采集代理：本地运行 127.0.0.1 就是宿主机代理；已设 MOYAN_YTDLP_PROXY 则跳过
export http_proxy="${http_proxy:-http://127.0.0.1:7890}"
export https_proxy="${https_proxy:-http://127.0.0.1:7890}"
export all_proxy="${all_proxy:-http://127.0.0.1:7890}"
# 本地回环不走代理
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1}"

echo ">>> moyan-backend dev: PORT=${PORT:-4323} DATABASE_URL=${DATABASE_URL:-sqlite:data/local-dev.db}"
echo ">>> proxy: ${MOYAN_YTDLP_PROXY:-$https_proxy}"

exec cargo run --release "$@"
