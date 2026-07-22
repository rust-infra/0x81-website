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
  examples?: CardExampleInput[];
}

export interface CardExampleInput {
  id?: string;
  sentence_en: string;
  translation_zh: string;
}

export interface UpdateCardInput {
  front?: string;
  back?: string;
  pronunciation?: string;
  tags?: string[];
  examples?: CardExampleInput[];
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: (ApiEnvelope<T> & { error?: { message?: string } }) | null = null;
  try {
    body = text ? (JSON.parse(text) as ApiEnvelope<T> & { error?: { message?: string } }) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(body?.error?.message || text || `请求失败 (${res.status})`);
  }
  if (!body?.success) {
    throw new Error(body?.error?.message || "请求未成功");
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

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  provider: string;
  status: "active" | "disabled";
  role: "user" | "admin";
  created_at: string;
  last_login_at: string | null;
  last_sync_at: string | null;
}

export interface AdminDeckSummary {
  id: string;
  name: string;
  card_count: number;
  is_system: boolean;
}

export interface AdminSyncSummary {
  last_sync_at: string | null;
  recent_sync_count: number;
}

export interface AdminUserDetail {
  user: AdminUser;
  deck_summaries: AdminDeckSummary[];
  sync_summary: AdminSyncSummary;
}

export interface UserListQuery extends ListQuery {
  status?: AdminUser["status"];
  role?: AdminUser["role"];
}

export interface PatchUserInput {
  status?: AdminUser["status"];
  role?: AdminUser["role"];
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

export async function listUsers(
  query: UserListQuery = {},
): Promise<PageResult<AdminUser>> {
  const res = await adminFetch(
    `/api/admin/users${buildQuery({
      q: query.q,
      page: query.page,
      page_size: query.page_size,
      status: query.status,
      role: query.role,
    })}`,
  );
  return parseEnvelope<PageResult<AdminUser>>(res);
}

export async function getUser(userId: string): Promise<AdminUserDetail> {
  const res = await adminFetch(`/api/admin/users/${userId}`);
  return parseEnvelope<AdminUserDetail>(res);
}

export async function patchUser(
  userId: string,
  input: PatchUserInput,
): Promise<AdminUser> {
  const res = await adminFetch(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<AdminUser>(res);
}

export interface LlmSettings {
  base_url: string;
  model: string;
  temperature: number;
  api_key_set: boolean;
  api_key_masked: string | null;
}

export interface UpdateLlmSettingsInput {
  base_url?: string;
  api_key?: string;
  model?: string;
  temperature?: number;
  clear_api_key?: boolean;
}

export interface YoutubeCaptionsResult {
  video_id: string;
  title: string;
  duration_sec: number | null;
  language: string;
  caption_text: string;
  source_url: string;
}

export interface DraftCard {
  front: string;
  back: string;
  pronunciation?: string | null;
  tags?: string[];
  examples?: CardExampleInput[];
}

export interface YoutubeExtractResult {
  draft_cards: DraftCard[];
  truncated: boolean;
}

export type CollectImportTarget =
  | {
      mode: "create";
      name: string;
      description?: string;
      source_key?: string;
    }
  | { mode: "merge"; deck_id: string };

export interface YoutubeImportResult {
  deck_id: string;
  created_cards: number;
  skipped_cards: number;
}

export type CollectJobStatus =
  | "queued"
  | "fetching_captions"
  | "extracting"
  | "ready"
  | "failed"
  | "paused";

export interface CollectJobListItem {
  id: string;
  url: string;
  proxy?: string | null;
  status: CollectJobStatus | string;
  step: string;
  error?: string | null;
  video_id?: string | null;
  title?: string | null;
  language?: string | null;
  source_url?: string | null;
  draft_card_count: number;
  truncated: boolean;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  llm_started_at?: string | null;
  llm_chunk_done?: number;
  llm_chunk_total?: number;
}

export interface CollectJob extends CollectJobListItem {
  caption_text?: string | null;
  draft_cards: DraftCard[];
}

export interface CollectJobListResult {
  items: CollectJobListItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function getLlmSettings(): Promise<LlmSettings> {
  const res = await adminFetch("/api/admin/settings/llm");
  return parseEnvelope<LlmSettings>(res);
}

export async function updateLlmSettings(
  input: UpdateLlmSettingsInput,
): Promise<LlmSettings> {
  const res = await adminFetch("/api/admin/settings/llm", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<LlmSettings>(res);
}

export async function collectYoutubeCaptions(
  url: string,
  proxy?: string,
): Promise<YoutubeCaptionsResult> {
  const res = await adminFetch("/api/admin/collect/youtube/captions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      proxy: proxy?.trim() ? proxy.trim() : undefined,
    }),
  });
  return parseEnvelope<YoutubeCaptionsResult>(res);
}

export async function collectYoutubeExtract(input: {
  video_id: string;
  title: string;
  caption_text: string;
  proxy?: string;
}): Promise<YoutubeExtractResult> {
  const res = await adminFetch("/api/admin/collect/youtube/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      proxy: input.proxy?.trim() ? input.proxy.trim() : undefined,
    }),
  });
  return parseEnvelope<YoutubeExtractResult>(res);
}

export async function collectYoutubeImport(input: {
  target: CollectImportTarget;
  cards: DraftCard[];
}): Promise<YoutubeImportResult> {
  const res = await adminFetch("/api/admin/collect/youtube/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseEnvelope<YoutubeImportResult>(res);
}

export async function listCollectJobs(params?: {
  q?: string;
  status?: string;
  page?: number;
  page_size?: number;
}): Promise<CollectJobListResult> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await adminFetch(`/api/admin/collect/youtube/jobs${suffix}`);
  return parseEnvelope<CollectJobListResult>(res);
}

export async function createCollectJob(input: {
  url: string;
  proxy?: string;
}): Promise<CollectJob> {
  const res = await adminFetch("/api/admin/collect/youtube/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: input.url,
      proxy: input.proxy?.trim() ? input.proxy.trim() : undefined,
    }),
  });
  return parseEnvelope<CollectJob>(res);
}

export async function getCollectJob(id: string): Promise<CollectJob> {
  const res = await adminFetch(`/api/admin/collect/youtube/jobs/${id}`);
  return parseEnvelope<CollectJob>(res);
}

export async function deleteCollectJob(id: string): Promise<void> {
  const res = await adminFetch(`/api/admin/collect/youtube/jobs/${id}`, {
    method: "DELETE",
  });
  await parseEnvelope<{ deleted: boolean }>(res);
}

export async function pauseCollectJob(id: string): Promise<CollectJob> {
  const res = await adminFetch(`/api/admin/collect/youtube/jobs/${id}/pause`, {
    method: "POST",
  });
  return parseEnvelope<CollectJob>(res);
}

export async function copyCollectJob(id: string): Promise<CollectJob> {
  const res = await adminFetch(`/api/admin/collect/youtube/jobs/${id}/copy`, {
    method: "POST",
  });
  return parseEnvelope<CollectJob>(res);
}
