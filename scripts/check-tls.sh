#!/usr/bin/env bash
# 部署后自检：确认 website-rs 真的在 443 上提供 HTTPS。
#
# 为什么需要它：缺证书时网关**只 warn 不报错**，静默退回"仅 HTTP"，443 直接连不上
# （Cloudflare Full (strict) 下表现为握手失败/5xx）。更阴的是 compose 挂载一个不存在
# 的宿主目录时 docker 会自己建一个 root 所有的空目录，于是"certs/ 存在"并不代表
# "证书在里面"。这个脚本把这几条都查一遍。
#
# 用法：
#   scripts/check-tls.sh                 # 证书没就位即失败（exit 1）——部署后用这个
#   scripts/check-tls.sh --allow-http    # 本地开发：只告警，退出码仍为 0
#
# 需要在仓库目录（compose 所在处）运行，且服务已 docker compose up -d。
set -euo pipefail

cd "$(dirname "$0")/.."

service=website-rs
cert=certs/origin.pem
key=certs/origin-key.pem
allow_http=0
case "${1:-}" in
    --allow-http) allow_http=1 ;;
    "") ;;
    *)
        echo "未知参数：$1（可用 --allow-http）" >&2
        exit 2
        ;;
esac

ok() { echo "✓ $*"; }
warn() { echo "! $*" >&2; }
bad() {
    echo "✗ $*" >&2
    exit 1
}

# 1) 宿主侧证书文件：空目录是最常见的假象（docker 自动创建）
missing=""
[ -s "$cert" ] || missing="$cert"
if [ ! -s "$key" ]; then
    missing="${missing:+$missing }$key"
fi
if [ -n "$missing" ]; then
    if [ "$allow_http" = 1 ]; then
        warn "证书文件缺失或为空：$missing（--allow-http，按仅 HTTP 处理）"
        exit 0
    fi
    cat >&2 <<EOF
✗ 证书文件缺失或为空：$missing

  网关会静默退回"仅 HTTP"。从开发机放证书：

    scp certs/origin.pem certs/origin-key.pem <server>:/opt/moyan/certs/
    ssh <server> 'chmod 600 /opt/moyan/certs/origin-key.pem'
    ssh <server> 'cd /opt/moyan && docker compose restart website-rs'

  注意：certs/ 是 gitignore 的，docker 自动建的空目录也算"目录存在"，
  所以别只看目录，要看里面有没有文件。
EOF
    exit 1
fi
ok "宿主侧证书文件存在（$cert, $key）"

# 2) 容器在跑吗
cid=$(docker compose ps -q "$service" 2>/dev/null || true)
if [ -z "$cid" ]; then
    bad "找不到 $service 容器——先在仓库目录里 docker compose up -d"
fi
state=$(docker inspect --format '{{.State.Status}} (restarts {{.RestartCount}})' "$cid")
echo "  容器状态：$state"
case "$state" in
    running*) ;;
    *)
        if docker logs "$cid" 2>&1 | grep -q "failed to load TLS cert/key"; then
            bad "证书文件在、但内容解析不了（日志里有 failed to load TLS cert/key），容器起不来。
  多半是 scp 传坏了或不是 PEM：重新从 Cloudflare 下载 origin.pem/origin-key.pem"
        fi
        bad "容器状态不是 running：$state"
        ;;
esac

# 3) 启动日志必须报 HTTPS listening
logs=$(docker logs "$cid" 2>&1 || true)
if grep -q "HTTPS listening" <<<"$logs"; then
    ok "日志：HTTPS listening on 0.0.0.0:443"
elif grep -q "serving HTTP only" <<<"$logs"; then
    if [ "$allow_http" = 1 ]; then
        warn "网关只跑 HTTP（--allow-http，按仅 HTTP 处理）"
        exit 0
    fi
    cat >&2 <<EOF
✗ 网关明确报告 "serving HTTP only"：容器看不到证书文件。

  按可能性排序：
   1. 宿主 certs/ 里其实没有文件（只有 docker 建的空目录）；
   2. SELinux 拦截读挂载：compose 里该挂载需要 :Z（本仓库已带，改过就对照一下）；
   3. TLS_CERT_PATH / TLS_KEY_PATH 的路径与挂载点不一致（应分别是
      /certs/origin.pem 与 /certs/origin-key.pem，挂载 ./certs:/certs）。
EOF
    exit 1
else
    warn "日志里既没有 'HTTPS listening' 也没有 'serving HTTP only'——容器可能刚启动完，稍后重跑"
fi

# 4) 容器内探针（runtime 镜像自带 curl）
if docker exec "$cid" sh -c 'command -v curl >/dev/null 2>&1'; then
    code=$(docker exec "$cid" sh -c \
        'curl -sk -o /dev/null -w "%{http_code}" --max-time 5 https://localhost/health' || true)
    if [ "$code" = "200" ]; then
        ok "容器内 https://localhost/health → 200"
    else
        bad "容器内 https 探针失败（http_code=${code:-无响应}）"
    fi
else
    warn "容器内没有 curl，跳过 https 探针"
fi

echo
echo "全部通过：网关正在 443 上提供 HTTPS。"
echo "外网再确认一次：curl -sI https://0x81.uk/health"
echo "Cloudflare 侧需是 Full (strict)，且已开 Always Use HTTPS。"
