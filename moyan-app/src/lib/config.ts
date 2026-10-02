import Constants from 'expo-constants';

const API_PORT = 4323;

export function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;

  // Explicit override (e.g. for production builds) wins.
  if (extra?.apiUrl) {
    return extra.apiUrl;
  }

  // In development, infer the backend host from Expo's dev server hostUri
  // (e.g. "192.168.1.5:8081"), so real devices on the same LAN can reach
  // the backend without manually editing apiUrl.
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host) {
    return `http://${host}:${API_PORT}`;
  }

  return `http://127.0.0.1:${API_PORT}`;
}

/**
 * 登录/用户信息的 base URL。
 *
 * **为什么和 `getApiBase()` 分开**：登录是跨产品的能力，业务是产品自己的事。生产上
 * 前者是 `https://auth.0x81.uk`，后者是 `https://moyan.0x81.uk`（现在指向同一个后端，
 * 但语义不同）。分开之后，将来 auth 抽成独立服务时只改网关一条路由，客户端不用发版。
 * 设计：docs/superpowers/specs/2026-10-02-gateway-auth-design.md
 *
 * 未配置 `AUTH_URL` 时回落到 `getApiBase()`：开发环境没有网关，登录和业务都直连
 * 后端（`http://<lan-ip>:4323`），回落后行为与改动前完全一致。
 */
export function getAuthBase(): string {
  const extra = Constants.expoConfig?.extra as { authUrl?: string } | undefined;
  return extra?.authUrl || getApiBase();
}

export function getGoogleClientId(): string {
  const extra = Constants.expoConfig?.extra as {
    googleClientId?: string;
  } | undefined;
  return extra?.googleClientId || '';
}

export function getGoogleRedirectUri(): string {
  const extra = Constants.expoConfig?.extra as {
    googleRedirectUri?: string;
  } | undefined;
  return extra?.googleRedirectUri || 'moyan://auth/google';
}
