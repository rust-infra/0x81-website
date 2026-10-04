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
