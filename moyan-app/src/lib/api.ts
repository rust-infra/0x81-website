// 后端 API 客户端（由 moyan-web/src/services/vocabularyApi.ts 移植，
// localStorage 换成 AsyncStorage；不包含打字相关接口）
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from './config';
import type {
  CardProgress,
  CreateReviewLogRequest,
  Deck,
  ReviewLog,
  StudyCard,
  StudyQueue,
  User,
  UpsertCardProgressRequest,
} from './types';

const API_BASE = getApiBase();
export const TOKEN_KEY = 'moyan_token';

async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  if (!token) {
    throw new Error('未登录');
  }

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const result = await res.json();
  return result.data as T;
}

export async function listDecks(): Promise<Deck[]> {
  return apiRequest<Deck[]>('/api/decks');
}

export async function listStudyCards(deckId: string): Promise<StudyCard[]> {
  return apiRequest<StudyCard[]>(
    `/api/decks/${encodeURIComponent(deckId)}/study-cards`
  );
}

export async function getStudyQueue(): Promise<StudyQueue> {
  return apiRequest<StudyQueue>('/api/study/queue');
}

export async function upsertCardProgress(
  cardId: string,
  body: UpsertCardProgressRequest
): Promise<CardProgress> {
  return apiRequest<CardProgress>(
    `/api/card-progress/${encodeURIComponent(cardId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );
}

export async function createReviewLog(
  body: CreateReviewLogRequest
): Promise<ReviewLog> {
  return apiRequest<ReviewLog>('/api/review-logs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ==================== Kimi Device Flow 登录 ====================

export interface KimiDeviceInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export async function kimiDevice(deviceId: string): Promise<KimiDeviceInfo> {
  const res = await fetch(`${API_BASE}/api/auth/kimi/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `设备授权失败 (${res.status})`);
  }
  return body.data as KimiDeviceInfo;
}

export async function kimiTokenPoll(
  deviceCode: string,
  deviceId: string
): Promise<{ status: 'ok'; accessToken: string } | { status: 'pending' }> {
  const res = await fetch(`${API_BASE}/api/auth/kimi/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode, device_id: deviceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body?.success && body?.data?.access_token) {
    return { status: 'ok', accessToken: body.data.access_token };
  }
  const message: string = body?.error?.message || '';
  if (/authorization_pending|slow_down|pending/i.test(message)) {
    return { status: 'pending' };
  }
  throw new Error(message || `登录轮询失败 (${res.status})`);
}

export async function kimiLogin(
  accessToken: string
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/api/auth/kimi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `登录失败 (${res.status})`);
  }
  const data = body.data as { token: string; user: User };
  return { token: data.token, user: data.user };
}
