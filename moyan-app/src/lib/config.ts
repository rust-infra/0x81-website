import Constants from 'expo-constants';

export function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return extra?.apiUrl || 'http://127.0.0.1:4323';
}
