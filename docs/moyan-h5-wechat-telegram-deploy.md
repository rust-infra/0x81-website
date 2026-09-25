# 墨言 H5 微信 / Telegram 入口部署清单

两个入口都复用已上线的 H5（https://moyan.0x81.uk），无需新前端工程。

---

## 1. Telegram 入口（推荐先做，最快）

### 1.1 后端
- [ ] @BotFather → `/newbot` → 记录 Bot Token
- [ ] 部署环境加环境变量 `TELEGRAM_BOT_TOKEN=<token>`
- [ ] 重新构建并部署 moyan-backend
- [ ] 验证：`curl -X POST https://moyan.0x81.uk/api/auth/telegram -H 'Content-Type: application/json' -d '{"init_data":""}'` 应返回 400（Empty initData）而非 503

### 1.2 前端
- [ ] 重新构建并部署 moyan-web（已含 Telegram SDK + 登录按钮）
- [ ] 验证：普通浏览器打开 `/login` **不显示** Telegram 按钮（仅 Telegram 内渲染）

### 1.3 入口配置
- [ ] @BotFather → `/setmenubutton` → 选择 bot → 填 `https://moyan.0x81.uk`
- [ ] 手机 Telegram 打开 bot → 点左下角菜单按钮 → 应全屏打开 H5
- [ ] 点击"Telegram 登录" → 一键登录成功
- [ ] 退出重进 → 数据仍在（绑定生效，`UNIQUE(provider, provider_id)` 命中同一账号）

### 1.4 对外分享（可选）
- [ ] 分享 `https://t.me/<bot用户名>?startapp=` 给用户

---

## 2. 微信入口

### 2.1 方式 A：直接分享链接（零开发，推荐）
- [ ] 手机微信打开 `https://moyan.0x81.uk`
- [ ] 验证 **Kimi 登录**可用（Google OAuth 在微信内置浏览器可能被墙，引导用户用 Kimi）
- [ ] 验证学习 / 播客 / 朗读
- [ ] 分享链接到群 / 好友

### 2.2 方式 B：小程序 web-view 壳（可选，需企业主体）
- [ ] 注册**企业主体**小程序，拿到 AppID（个人主体不支持 web-view）
- [ ] `moyan-miniprogram/project.config.json` 替换 `appid`
- [ ] 微信开发者工具导入 `moyan-miniprogram/`
- [ ] mp.weixin.qq.com → 开发管理 → 开发设置 → **业务域名** → 添加 `https://moyan.0x81.uk`
  - 需下载校验文件放站点根目录（moyan-web/dist/）→ 重新部署 → 再保存
  - ⚠️ **前提：域名已完成 ICP 备案**；未备案则放弃本方案，只用方式 A
- [ ] 开发者工具上传 → 体验版 → 手机扫码验证
- [ ] 提交审核 → 发布

---

## 3. 回归验证清单

- [ ] Telegram 内打开 → 全屏无顶部栏 → Telegram 登录可用
- [ ] 微信内打开 H5 → Kimi 登录可用
- [ ] 普通浏览器打开 → 无 Telegram 按钮，Kimi / Google 登录正常
- [ ] 学习 / 播客 / 朗读功能可用
- [ ] 后端 API（/api/...）走 Caddy 反代正常

---

## 4. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| Telegram 登录报 `TELEGRAM_BOT_TOKEN not configured` | 后端未设环境变量，重新部署 |
| Telegram 登录报 `initData hash mismatch` | initData 过期或 bot token 与签发时不符（换 token 需重部署） |
| Telegram 登录报 `initData expired` | 打开页面超过 24h 未登录，刷新重试 |
| 微信 web-view 白屏 | 业务域名未配置 / 校验文件未部署 / 域名未备案 |
| 微信内 Google 登录打不开 | 被墙属预期，改用 Kimi 登录 |
| H5 里没有"Telegram 登录"按钮 | 非 Telegram 环境（普通浏览器/微信）本来就不显示，属预期 |
