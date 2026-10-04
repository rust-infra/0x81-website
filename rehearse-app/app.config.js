// 覆盖 app.json 的动态配置。
// 本地开发不设置 API_URL / AUTH_URL / GOOGLE_CLIENT_ID，走 config.ts 的推断
// （开发环境 API 地址由 hostUri 推断，登录回落到同一个 host 的**认证端口**——
//  注意业务与认证是两个端口，见 lib/config.ts）。
// 正式构建通过 eas.json 的 env 注入：
//   API_URL=https://rehearse.0x81.uk    业务（rehearse-backend）
//   AUTH_URL=https://auth.0x81.uk       登录（跨产品能力域名，由 moyan-backend 提供）
// 两者分开的意义见 docs/superpowers/specs/2026-10-02-gateway-auth-design.md
export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiUrl: process.env.API_URL,
    authUrl: process.env.AUTH_URL,
    googleClientId:
      process.env.GOOGLE_CLIENT_ID || config.extra?.googleClientId || '',
  },
});
