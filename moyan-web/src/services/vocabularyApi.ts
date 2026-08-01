import type {
  Card,
  CreateCardRequest,
  CreateDeckRequest,
  CreateReviewLogRequest,
  Deck,
  ReviewLog,
  StudyCard,
  StudyQueue,
  TypeStats,
  TypeSyncRequest,
  TypeSyncResponse,
  UpdateCardRequest,
  UpdateDeckRequest,
  UpsertCardProgressRequest,
  CardProgress,
} from "@/types/vocabulary";

const API_BASE = import.meta.env.VITE_API_URL || "";

function getToken(): string | null {
  return localStorage.getItem("moyan_token");
}

export function hasVocabularyBackend(): boolean {
  return API_BASE.length > 0;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error("未登录");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
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
  return apiRequest<Deck[]>("/api/decks");
}

export async function createDeck(body: CreateDeckRequest): Promise<Deck> {
  return apiRequest<Deck>("/api/decks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateDeck(
  deckId: string,
  body: UpdateDeckRequest
): Promise<Deck> {
  return apiRequest<Deck>(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteDeck(deckId: string): Promise<void> {
  await apiRequest<null>(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: "DELETE",
  });
}

export async function listCards(deckId: string): Promise<Card[]> {
  return apiRequest<Card[]>(
    `/api/decks/${encodeURIComponent(deckId)}/cards`
  );
}

export async function createCard(
  deckId: string,
  body: CreateCardRequest
): Promise<Card> {
  return apiRequest<Card>(
    `/api/decks/${encodeURIComponent(deckId)}/cards`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function updateCard(
  cardId: string,
  body: UpdateCardRequest
): Promise<Card> {
  return apiRequest<Card>(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteCard(cardId: string): Promise<void> {
  await apiRequest<null>(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: "DELETE",
  });
}

export async function listStudyCards(deckId: string): Promise<StudyCard[]> {
  return apiRequest<StudyCard[]>(
    `/api/decks/${encodeURIComponent(deckId)}/study-cards`
  );
}

export async function getStudyQueue(): Promise<StudyQueue> {
  return apiRequest<StudyQueue>("/api/study/queue");
}

export async function upsertCardProgress(
  cardId: string,
  body: UpsertCardProgressRequest
): Promise<CardProgress> {
  return apiRequest<CardProgress>(
    `/api/card-progress/${encodeURIComponent(cardId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
}

export async function createReviewLog(
  body: CreateReviewLogRequest
): Promise<ReviewLog> {
  return apiRequest<ReviewLog>("/api/review-logs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function syncTypePractice(
  body: TypeSyncRequest
): Promise<TypeSyncResponse> {
  return apiRequest<TypeSyncResponse>("/api/type/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getTypeStats(): Promise<TypeStats> {
  return apiRequest<TypeStats>("/api/type/stats");
}
