# 职演 Web / Telegram Mini App 接入（2026-11-03）

状态：已实现，待部署与真机验证。

## 决定

职演不再只有原生 App。新增一个 **Expo Web 产物**，由 `rehearse-web` 容器托管，同时作为
Telegram Mini App 的页面本体。原生 App 的接口与路径不变。

这修正了 `2026-10-02-rehearse-design.md` 里「只做 App，不做 Web」的平台决定。那份文档保留
原文作为历史记录，本文记录新增的部署拓扑与约束。

## 拓扑

```
Telegram / Browser
      │
      ▼
rehearse.0x81.uk → website-rs → rehearse-web:4324 (Caddy)
                                  ├─ /api/rehearse/* → rehearse-backend:4324
                                  ├─ /api/auth/*     → moyan-backend:4323
                                  ├─ /health         → rehearse-backend:4324
                                  └─ 其它            → dist/index.html（SPA）
```

### 为什么 `rehearse-web` 监听 4324

`website-rs` 的 `resolve_upstream` 把主机名和端口写在一起，**端口编进 Rust 二进制**，环境
变量只能覆盖主机名。让 `rehearse-web` 内部占用 4324，就只需要改 compose 的
`PROXY_UPSTREAM_HOST_REHEARSE=rehearse-web`，不必为这次改动发新的 Rust tag；现有 App 打的
`https://rehearse.0x81.uk/api/rehearse/*` 也完全不变。

### 为什么 auth 也走同源

Web 构建注入 `API_URL=AUTH_URL=https://rehearse.0x81.uk`，`/api/auth/*` 由 Caddy 反代到
`moyan-backend:4323`。浏览器侧因此完全同源，不需要给两个后端加 CORS 白名单。原生 App 仍然
直连 `https://auth.0x81.uk`，不受影响。

## 登录

后端已有 `POST /api/auth/telegram`（`moyan-backend`）：客户端提交
`Telegram.WebApp.initData`，服务端用 `TELEGRAM_BOT_TOKEN` 验 HMAC-SHA256，并做 24h 防重放。
本次只加了客户端部分：

- `src/lib/telegram.ts`：读 `initData`，调用 `ready()` / `expand()`。
- `src/lib/auth.tsx`：Web 且未登录时自动换 JWT；失败静默退回登录页。
- **部署前提**：服务器根 `.env` 必须有 `TELEGRAM_BOT_TOKEN`。留空时该接口回 503，Mini App
  会停在登录页。

## Web 构建

`npm run build:web` = `expo export --platform web` + `scripts/patch-web-html.mjs`。

⚠️ Expo 的 **SPA 导出不会读取 `app/+html.tsx`**（那只在 static / server rendering 下生效）。
Telegram SDK 和 `viewport-fit=cover` 是在导出后注入 `dist/index.html` 的；不要往
`+html.tsx` 里加东西。

## 已知缺口

1. **Web STT**：客户端默认 `sttProvider: 'system'`，走原生语音识别；在 Telegram WebView
   （尤其 iOS）不可靠。需要强制云端 STT，并由后端代转或允许用户自带 key。
2. **TTS 自动播放**：WebView 的自动播放策略可能拦下 `new Audio(...).play()`，需要在首次
   用户手势时解锁音频。
3. 主题 / 安全区 / Telegram BackButton 的视觉打磨尚未做。

## 回滚

把 `PROXY_UPSTREAM_HOST_REHEARSE` 改回 `rehearse-backend`，`docker compose up -d website-rs`，
再停掉 `rehearse-web`。没有数据迁移，回滚不改库。

## 验证

- `rehearse-app`：`npm test`（20 个文件 / 92 个测试）与 `npm run typecheck` 通过。
- 本机 `npm run build:web` 通过；`dist/index.html` 含 Telegram SDK 与
  `viewport-fit=cover`，bundle 内含 `api/auth/telegram`。
- Docker 镜像构建交给 CI 的 `docker-build.yml`；真机 Telegram 与麦克风权限尚未验证。
