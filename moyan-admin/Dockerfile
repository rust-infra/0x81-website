# ── Build Stage ──────────────────────────────────────────────
ARG NODE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-alpine
ARG CADDY_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/caddy:2-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# 先复制依赖定义，利用 Docker 缓存
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set replace-registry-host always \
    && npm ci --frozen-lockfile

# 复制源码
COPY . .

# 构建生产版本
RUN npm run build

# ── Runtime Stage ────────────────────────────────────────────
FROM ${CADDY_IMAGE}

# 复制构建产物
COPY --from=builder /app/dist /usr/share/caddy/html

# 复制 Caddy 配置
COPY Caddyfile /etc/caddy/Caddyfile

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5001/ || exit 1

EXPOSE 5001

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
