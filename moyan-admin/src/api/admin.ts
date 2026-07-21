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

export interface ImportErrorItem {
  sheet: string;
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  created_decks: number;
  updated_decks: number;
  created_cards: number;
  updated_cards: number;
}

export type ImportMode = "merge" | "replace_deck";

export class ImportValidationError extends Error {
  errors: ImportErrorItem[];

  constructor(errors: ImportErrorItem[]) {
    super("导入校验失败");
    this.name = "ImportValidationError";
    this.errors = errors;
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function downloadAdminBlob(path: string, filename: string): Promise<void> {
  const res = await adminFetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `下载失败 (${res.status})`);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, filename);
}

export async function downloadVocabularyTemplate(): Promise<void> {
  await downloadAdminBlob(
    "/api/admin/vocabulary/template.xlsx",
    "vocabulary-template.xlsx",
  );
}

export async function exportVocabularyExcel(): Promise<void> {
  await downloadAdminBlob(
    "/api/admin/vocabulary/export.xlsx",
    "vocabulary-export.xlsx",
  );
}

export async function exportVocabularyJson(): Promise<void> {
  const res = await adminFetch("/api/admin/vocabulary/export.json");
  const data = await parseEnvelope<unknown>(res);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  triggerBlobDownload(blob, "vocabulary-export.json");
}

export async function importVocabulary(
  file: File,
  mode: ImportMode,
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);

  const res = await adminFetch(`/api/admin/vocabulary/import?mode=${mode}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json()) as {
      success?: boolean;
      errors?: ImportErrorItem[];
      error?: { message?: string };
    };
    if (body.errors?.length) {
      throw new ImportValidationError(body.errors);
    }
    throw new Error(body.error?.message ?? `导入失败 (${res.status})`);
  }

  return parseEnvelope<ImportResult>(res);
}
