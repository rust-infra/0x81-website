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
