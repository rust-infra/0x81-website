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

# 服务端权威模式开关（判断逻辑见 src/services/backendMode.ts）。
# ⚠️ 线上是同源部署：moyan-web 由 Caddy 托管、Caddyfile 把 /api/* 反代到 moyan-backend，
# 请求本就该走相对路径，所以 VITE_API_URL 是**故意留空**的。此时若不开这个开关，前端会
# 静默退回 IndexedDB 本地模式（词库只认镜像里打包的 public/vocabulary.json），
# 后台导入的词库在 /decks 永远看不见 —— 2026-09-18 踩过，别删。
ARG VITE_SERVER_MODE=1

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
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/ || exit 1

EXPOSE 5000

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
