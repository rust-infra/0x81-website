# 墨言 · 微信小程序（web-view 壳）

用微信小程序 `<web-view>` 包装现有 H5（https://moyan.0x81.uk），零移植。

## 为什么这么做

- moyan-web 已是完整可用的 H5 应用，已上线 moyan.0x81.uk
- 小程序端用 web-view 直接加载，避免把 React/Vite 应用移植到小程序
- 微信内置浏览器本身就能打开 H5，本壳只是给用户一个"小程序入口"

## 目录结构

```
moyan-miniprogram/
├── app.json / app.js / app.wxss     # 小程序全局配置
├── project.config.json              # 微信开发者工具项目配置（appid 需替换）
├── sitemap.json
└── pages/index/                     # 唯一页面：web-view 加载 H5
```

## 接入步骤

1. **准备小程序账号**
   - 必须是**企业主体**小程序（个人主体不支持 web-view 组件）
   - 在 mp.weixin.qq.com 注册，拿到 AppID

2. **替换 AppID**
   - 打开微信开发者工具 → 导入本项目目录 `moyan-miniprogram/`
   - 把 `project.config.json` 中的 `appid` 从 `touristappid` 换成真实 AppID

3. **配置业务域名**（web-view 必需）
   - mp.weixin.qq.com → 开发管理 → 开发设置 → 业务域名
   - 添加 `https://moyan.0x81.uk`
   - 按提示下载校验文件，放到站点根目录（moyan-web/dist/ 下），重新部署后再点保存
   - ⚠️ 前提：该域名已完成 **ICP 备案**（web-view 业务域名强制要求备案域名；若未备案，此路不通，退回到"直接分享链接"方案）

4. **真机验证**
   - 开发者工具 → 上传 → 体验版 → 手机微信扫码打开体验版
   - 验证：登录（Kimi 设备码登录在微信内可用）、学习、播客播放、朗读

5. **提审发布**
   - 小程序类目选择需匹配实际内容（如"教育-在线教育"或"工具"）
   - 审核注意：web-view 页面必须完整加载且功能可用，否则可能被驳回

## 已知限制

- web-view 内是 H5 页面，无法调用 wx 小程序原生 API（登录走 H5 自己的 Kimi/Google，不是微信授权登录）
- Google OAuth 在微信内置浏览器内可能无法打开（被墙），引导用户使用 Kimi 登录
- 播客播放依赖 H5 的 HTML5 Audio；锁屏/后台播放能力受微信浏览器限制
- 如果未来要微信授权登录、分享卡片、支付等原生能力，需要从壳逐步替换为原生页面

## 最快的替代方案（零开发）

H5 本身已上线：直接把 `https://moyan.0x81.uk` 链接分享到微信群/好友即可在微信内置浏览器使用，无需任何开发。本壳仅在需要"小程序形态入口"时使用。
