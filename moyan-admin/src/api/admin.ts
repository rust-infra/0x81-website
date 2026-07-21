import { adminFetch } from "./client";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface Deck {
  id: string;
  owner_user_id: string;
  source_key: string | null;
  name: string;
  description: string;
  color: string | null;
  version: number;
  sort_order: number;
  is_active: boolean;
  card_count: number;
  created_at: string;
  updated_at: string;
}

export interface CardExample {
  id: string;
  sentence_en: string;
  translation_zh: string;
}

export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  pronunciation: string | null;
  tags: string[];
  examples: CardExample[];
  created_at: string;
  updated_at: string;
}

export interface ListQuery {
  q?: string;
  page?: number;
  page_size?: number;
}

export interface CreateDeckInput {
  name: string;
  description?: string;
  color?: string;
  source_key?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdateDeckInput {
  name?: string;
  description?: string;
  color?: string;
  source_key?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface CreateCardInput {
  front: string;
  back: string;
  pronunciation?: string;
  tags?: string[];
}

export interface UpdateCardInput {
  front?: string;
  back?: string;
  pronunciation?: string;
  tags?: string[];
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `请求失败 (${res.status})`);
  }

  const body = (await res.json()) as ApiEnvelope<T>;
  if (!body.success) {
    throw new Error("请求未成功");
  }

  return body.data;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function pingAdmin(token?: string): Promise<void> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const headers = new Headers();

  if (token) {
    headers.set("X-Admin-Token", token);
  }

  const res = token
    ? await fetch(`${base}/api/admin/ping`, { headers })
    : await adminFetch("/api/admin/ping");

  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "无效的管理员令牌" : "管理员验证失败",
    );
  }
}

export async function listDecks(
  query: ListQuery = {},
): Promise<PageResult<Deck>> {
  const res = await adminFetch(
    `/api/admin/decks${buildQuery({
      q: query.q,
      page: query.page,
      page_size: query.page_size,
    })}`,
  );
  return parseEnvelope<PageResult<Deck>>(res);
}

export async function createDeck(input: CreateDeckInput): Promise<Deck> {
  const res = await adminFetch("/api/admin/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<Deck>(res);
}

export async function updateDeck(
  deckId: string,
  input: UpdateDeckInput,
): Promise<Deck> {
  const res = await adminFetch(`/api/admin/decks/${deckId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<Deck>(res);
}

export async function deleteDeck(deckId: string): Promise<void> {
  const res = await adminFetch(`/api/admin/decks/${deckId}`, {
    method: "DELETE",
  });
  await parseEnvelope<null>(res);
}

export async function listCards(
  deckId: string,
  query: ListQuery = {},
): Promise<PageResult<Card>> {
  const res = await adminFetch(
    `/api/admin/decks/${deckId}/cards${buildQuery({
      q: query.q,
      page: query.page,
      page_size: query.page_size,
    })}`,
  );
  return parseEnvelope<PageResult<Card>>(res);
}

export async function createCard(
  deckId: string,
  input: CreateCardInput,
): Promise<Card> {
  const res = await adminFetch(`/api/admin/decks/${deckId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<Card>(res);
}

export async function updateCard(
  cardId: string,
  input: UpdateCardInput,
): Promise<Card> {
  const res = await adminFetch(`/api/admin/cards/${cardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<Card>(res);
}

export async function deleteCard(cardId: string): Promise<void> {
  const res = await adminFetch(`/api/admin/cards/${cardId}`, {
    method: "DELETE",
  });
  await parseEnvelope<null>(res);
}
