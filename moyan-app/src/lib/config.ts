import Constants from 'expo-constants';

export function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return extra?.apiUrl || 'http://127.0.0.1:4323';
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
