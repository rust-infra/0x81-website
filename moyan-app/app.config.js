// 覆盖 app.json 的动态配置。
// 本地开发不设置 API_URL / GOOGLE_CLIENT_ID，走 app.json 的默认值（开发环境 API 地址由 hostUri 推断）。
// 正式构建通过 eas.json 的 env 注入：API_URL=https://moyan.0x81.uk
export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiUrl: process.env.API_URL,
    googleClientId:
      process.env.GOOGLE_CLIENT_ID || config.extra?.googleClientId || '',
  },
});
