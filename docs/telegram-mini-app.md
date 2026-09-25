# Telegram Mini App 接入（墨言）

Telegram Mini App（Telegram 小程序）**不是壳工程**——它就是 HTTPS 网页在 Telegram 内置浏览器中打开。
现有 H5（https://moyan.0x81.uk）就是 Mini App 本体，入口是一个 Telegram Bot 的按钮。

## 与微信路径对比

| 维度 | 微信（web-view 壳） | Telegram（Mini App） |
|---|---|---|
| 工程 | `moyan-miniprogram/` 壳 | **无**，直接用现有 H5 |
| 审核 | 需审核，web-view 有资质要求 | **无审核** |
| 域名白名单 | 需企业主体 + ICP 备案域名 | 仅需 HTTPS |
| 登录 | H5 自己的 Kimi/Google | Telegram 免密登录（initData，已实现） |
| 前提 | 企业主体小程序账号 | 一个 Telegram Bot（@BotFather 免费创建） |

## 已完成的代码改动

**moyan-web（H5 前端）**
- `index.html`：引入官方 SDK `<script src="https://telegram.org/js/telegram-web-app.js"></script>`
- `src/lib/telegram.ts`：桥接初始化——Telegram 内自动 `ready()` + 全屏 `expand()`，并把 `initData` 存入 `sessionStorage.tg_init_data`
- `src/main.tsx`：启动时调用 `initTelegramWebApp()`
- `src/services/authService.ts`：`loginWithTelegram()`——把 initData POST 到 `/api/auth/telegram`，存后端 JWT；`isTelegramWebApp()` / `getTelegramInitData()` 工具
- `src/components/TelegramLoginButton.tsx` + `src/pages/Login.tsx`：登录页新增"Telegram 登录"按钮（**仅 Telegram 内渲染**，普通浏览器/微信不显示）
- 已通过 `npm run build` 验证

**moyan-backend（Rust）**
- `POST /api/auth/telegram`：接收 `{ init_data }`，用 `TELEGRAM_BOT_TOKEN` 做 HMAC-SHA256 校验（防伪造/防重放），通过后走 `find_or_create_user("telegram", tg_uid, ...)` + 签发 JWT
- `users.provider` 新增 `"telegram"` 取值；Telegram 无邮箱 → 合成 `tg<uid>@telegram.local`
- `.env.example` 新增 `TELEGRAM_BOT_TOKEN`
- 已通过 `cargo check` + 5 个单元测试（合法/URL编码/篡改/过期/缺 hash）

> 部署：moyan-backend 环境变量加 `TELEGRAM_BOT_TOKEN=<BotFather 给的 token>`，重新构建部署前后端。

## 接入步骤（需要你的 Telegram 账号操作）

1. **创建机器人**
   - Telegram 里找 `@BotFather` → 发 `/newbot` → 按提示起名，得到 **Bot Token**（形如 `123456:ABC-DEF...`，妥善保存）

2. **设置入口按钮**（三选一，推荐方式 A）
   - **A. 菜单按钮**：@BotFather → `/setmenubutton` → 选择你的 bot → 填 URL `https://moyan.0x81.uk`。用户点开 bot 聊天框左下角菜单按钮即可打开
   - **B. 内联键盘按钮**：任何代码里发键盘按钮 `{"text":"打开墨言","web_app":{"url":"https://moyan.0x81.uk"}}`（需 bot 具备发送消息能力）
   - **C. 分享链接**：直接发 `https://t.me/<你的bot用户名>?startapp=` 或分享 bot 主页，用户点开即进入

3. **真机测试**
   - 手机 Telegram（iOS/Android）打开 bot → 点按钮 → 应全屏打开 H5（无 Telegram 顶部栏，页面可正常登录/学习/播放）

4. **Telegram 免密登录（已实现）**
   - 登录页会出现"Telegram 登录"按钮（仅 Telegram 内），点一下即完成登录/绑定
   - 绑定机制：`users` 表以 `(provider='telegram', provider_id=Telegram uid)` 唯一索引关联，同一 Telegram 用户每次打开自动命中同一账号，学习数据自动同步
   - ⚠️ 安全红线：`initData` 必须由后端校验（已实现 HMAC-SHA256 + 24h 防重放），**不能信任前端明文**

## 注意事项

- Telegram 在中国大陆被墙：此入口面向海外用户（或需用户自备网络环境）
- 音频播放依赖 H5 的 HTML5 Audio，后台/锁屏播放能力受 Telegram 内置浏览器限制，与 App 体验有差距
- Bot Token 泄露 = 机器人被接管，请放入后端环境变量，勿提交到仓库
