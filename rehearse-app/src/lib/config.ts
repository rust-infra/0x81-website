import Constants from 'expo-constants';

/**
 * 业务后端（rehearse-backend）的端口。
 *
 * ⚠️ 与墨言**不是同一个**：墨言是 4323，职演是 4324（§6.5）。两个服务各自
 * 一个进程、一个容器。
 */
const API_PORT = 4324;

/**
 * 认证服务的端口。
 *
 * 职演**没有自己的认证服务**——登录入口是 `auth.0x81.uk`，由 moyan-backend
 * 提供（§7.4：统一登录入口 + 各服务自己验 token）。所以开发环境下登录要打到
 * 4323，而不是 4324。
 */
const AUTH_PORT = 4323;

/**
 * 开发时从 Expo dev server 的 hostUri 推断宿主 IP（形如 "192.168.1.5:8081"）。
 * 真机与电脑同一个局域网时，不用手改任何配置就能连上后端。
 */
function lanHost(): string | undefined {
  return Constants.expoConfig?.hostUri?.split(':')[0] || undefined;
}

export function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;

  // 显式配置优先（正式构建走 eas.json 的 env 注入）。
  if (extra?.apiUrl) {
    return extra.apiUrl;
  }

  const host = lanHost();
  if (host) {
    return `http://${host}:${API_PORT}`;
  }

  return `http://127.0.0.1:${API_PORT}`;
}

/**
 * 登录/用户信息的 base URL。
 *
 * **为什么和 `getApiBase()` 分开**：登录是跨产品的能力，业务是产品自己的事。
 * 生产上前者是 `https://auth.0x81.uk`，后者是 `https://rehearse.0x81.uk`。
 * 分开之后，将来 auth 抽成独立服务时只改网关一条路由，客户端不用发版。
 * 设计：docs/superpowers/specs/2026-10-02-gateway-auth-design.md
 *
 * ⚠️ 未配置 `AUTH_URL` 时的回落**不是** `getApiBase()`：职演的业务与认证是
 * **两个不同的后端进程**（4324 / 4323），而 `rehearse-backend` 根本不认识
 * `/api/auth/*`（§7.4.2「没有 /api/auth/*」）。照抄墨言那种「回落到业务地址」
 * 的写法，开发环境下登录会打到 4324 拿到 404，而症状只是「登录没反应」。
 */
export function getAuthBase(): string {
  const extra = Constants.expoConfig?.extra as { authUrl?: string } | undefined;
  if (extra?.authUrl) {
    return extra.authUrl;
  }

  const host = lanHost();
  if (host) {
    return `http://${host}:${AUTH_PORT}`;
  }

  return `http://127.0.0.1:${AUTH_PORT}`;
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
  return extra?.googleRedirectUri || 'rehearse://auth/google';
}
