# 0x81-website

Host 分流网关 + 多个 Astro 静态站点：

| 域名 | 服务 | 说明 |
|------|------|------|
| `0x81.uk` / `www.0x81.uk` | `0xindex` | 产品索引站（`ai.0x81`） |
| `tact.0x81.uk` | `website` | tact 产品落地页 |
| `crab.0x81.uk` | `crab-web` | CrabBridge 产品落地页 |
| `moyan.0x81.uk` | `moyan-web` | 墨言（词汇 / 打字训练） |

## 架构

```
Browser / CDN
      │
      ▼
website-rs :80/:443     Axum 网关
      ├─ Host: 0x81.uk / www.0x81.uk  →  0xindex :4320
      ├─ Host: tact.0x81.uk           →  website :4321
      ├─ Host: crab.0x81.uk           →  crab-web :4322
      ├─ Host: moyan.0x81.uk          →  moyan-web :5000（/api → moyan-backend :4323）
      └─ 其它 Host                      →  本地路由（/health 等）
              │
              ▼
         Caddy 静态服务（各站 dist/）
```

基础镜像默认走华为云 SWR 转发的 Docker Hub（`swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/...`），避免直连 docker.io / DaoCloud 超时或 401。

### 仓库结构

```
0x81-website/
├── website-rs/       # 入口网关（Rust / Axum :80）
├── 0xindex/          # 主站 ai.0x81（Astro → Bun :4320）
├── website/          # tact 站（Astro → Bun :4321）
├── crab-web/         # CrabBridge 站（Astro → Bun :4322）
├── moyan-web/        # 墨言前端（Vite → Caddy :5000）
├── moyan-backend/    # 墨言 API（Axum :4323）
├── docs/             # 设计稿与实现计划
└── docker-compose.yml
```

### 请求路径

1. 流量进入 `website-rs:80`
2. `proxy_or_next` 按 `Host` 反代到对应上游
3. 转发时将 `Host` 改写为 `localhost:<port>`
4. 回写响应时注入 `Cache-Control`，并经 gzip（`CompressionLayer`）与 CORS（`CorsLayer`）

Compose 环境变量：

- `PROXY_UPSTREAM_HOST_INDEX=0xindex`
- `PROXY_UPSTREAM_HOST_TACT=website`
- `PROXY_UPSTREAM_HOST_CRAB=crab-web`
- `PROXY_UPSTREAM_HOST_MOYAN=moyan-web`

### 网关横切能力

| 能力 | 说明 |
|------|------|
| Host 路由 | `0x81.uk` → 4320，`tact` → 4321，`crab` → 4322，`moyan` → 5000 |
| TLS | rustls 监听 443（`TLS_CERT_PATH` / `TLS_KEY_PATH`，Cloudflare Origin Certificate）；未配置则仅 HTTP |
| 压缩 | `CompressionLayer` |
| CORS | `CorsLayer::permissive()` |
| 缓存头 | `/_astro/*` 一年 `immutable`；HTML `max-age=60, must-revalidate`；图片/字体一天；错误 `no-store` |
| 健康检查 | `GET /health` |

### HTTPS（Cloudflare Full (strict)）

1. Cloudflare → SSL/TLS → **Origin Server** → Create Certificate，覆盖 `0x81.uk, *.0x81.uk`
2. 证书存为 `certs/origin.pem`，私钥存为 `certs/origin-key.pem`（`certs/` 已 gitignore，不入库）
3. `docker compose up -d --build` 后网关同时监听 80/443
4. Cloudflare SSL/TLS 加密模式切到 **Full (strict)**，并开启 **Always Use HTTPS**

缺少证书文件时网关自动退回仅 HTTP（本地开发无需证书）。

## 前端应用

构建模式相同：**Docker 多阶段 = `npm install` → `astro build` → Caddy 直接托管 `dist/`**。

Dockerfile 默认使用官方镜像名（如 `node:20-alpine`、`caddy:2-alpine`、`rust:latest`、`debian:bookworm-slim`）。如果本机 Docker 已配置阿里云等镜像加速器，会自动生效；如需指定自定义镜像源，也可通过 build args 覆盖。

### `0xindex`（产品索引）

```
0xindex/src/
├── pages/index.astro      # /    EN
├── pages/zh/index.astro   # /zh  ZH
├── data/products.ts       # 产品目录
├── i18n/{en,zh}.json      # 文案
└── components/            # Nav · Hero · ProductMatrixIDE · Footer
```

- 品牌：`ai.0x81`，matrix-first（青黑 IDE）
- tact / crab 外链到各自产品站
- 改产品需同步：`products.ts` + `en.json` + `zh.json`（`products.<id>.blurb`）

### `website`（tact）

- 琥珀 CRT / TUI 产品落地页，端口 `4321`
- Astro 静态 + Bun `server.ts`

### `crab-web`（CrabBridge）

- 与 tact **同款**琥珀 TUI 视觉与组件结构，端口 `4322`
- 产品：[rust-infra/crab-bridge-rs](https://github.com/rust-infra/crab-bridge-rs) — Codex ↔ DeepSeek / Kimi Responses 代理
- 设计说明：`docs/superpowers/specs/2026-07-14-crab-web-design.md`

### `moyan-web` / `moyan-backend`（墨言）

- 前端：Vite 构建 + Caddy，主机映射 `5000:80`，域名 `moyan.0x81.uk`
- 后端：Axum API `:4323`；Caddy 将 `/api/*` 反代到 `moyan-backend`
- Google OAuth 生产回调建议设为 `https://moyan.0x81.uk/api/auth/google/callback`（`MOYAN_GOOGLE_REDIRECT_URL`）

## 本地运行

```bash
docker compose up -d --build
```

服务：

| 服务 | 端口 | 说明 |
|------|------|------|
| `website-rs` | `80` / `443` | 网关入口 |
| `0xindex` | `4320` | 主站（也可直接访问） |
| `website` | `4321` | tact（也可直接访问） |
| `crab-web` | `4322` | CrabBridge（也可直接访问） |
| `moyan-backend` | `4323` | 墨言 API |
| `moyan-web` | `5000` | 墨言前端（Caddy；`/api` 反代到 backend） |

本地按 Host 访问时，需把 `0x81.uk` / `tact.0x81.uk` / `crab.0x81.uk` / `moyan.0x81.uk` 指到本机（`/etc/hosts` 或本地 DNS）。

单独开发前端：

```bash
cd 0xindex && bun install && bun run dev
# 或
cd website && bun install && bun run dev
# 或
cd crab-web && bun install && bun run dev
```

## 相关文档

- 主站设计：`docs/superpowers/specs/2026-07-14-0xindex-main-site-design.md`
- 主站实现计划：`docs/superpowers/plans/2026-07-14-0xindex-main-site.md`
- CrabBridge 站设计：`docs/superpowers/specs/2026-07-14-crab-web-design.md`
