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
