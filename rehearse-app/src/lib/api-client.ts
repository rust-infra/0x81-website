import { ApiError } from './api-error';
import { translate } from './i18n';

export type ApiRequest = <T>(
  path: string,
  options?: RequestInit
) => Promise<T>;

export interface ApiClientDeps {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /**
   * 服务端回了 401 时通知上层清掉凭证。
   *
   * 没有这条时，token 过期或被吊销的用户会停在一个「已登录」的空壳里：
   * 每个请求都失败，页面不会退回登录页，只能自己去设置里退出。
   */
  onUnauthorized?: () => void;
}

export async function apiRequestWithDeps<T>(
  path: string,
  options: RequestInit,
  deps: ApiClientDeps
): Promise<T> {
  const token = await deps.getToken();
  if (!token) {
    throw new ApiError(401, translate('notLoggedIn'));
  }

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  headers.Authorization = `Bearer ${token}`;
  if (typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(`${deps.baseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) deps.onUnauthorized?.();
    const body = await res.json().catch(() => ({}));
    const error = body?.error ?? {};
    throw new ApiError(
      res.status,
      error.message || translate('requestFailed', { status: res.status }),
      error.reason,
      error
    );
  }

  const result = await res.json();
  return result.data as T;
}
