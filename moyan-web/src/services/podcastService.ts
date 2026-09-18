// 播客服务层：config / resolve / translate（音频播放直接走 /api/podcast/audio/{id}）
// 与 moyan-app 的 podcast 模块对齐；搜索直接调 YouTube Data API v3。

export interface PodcastConfig {
  app_enabled: boolean;
  web_enabled: boolean;
  youtube_api_key: string;
}

export interface TimedCaption {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface PodcastResolved {
  video_id: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration_sec: number;
  audio_url: string;
  captions: TimedCaption[];
}

export interface PodcastTranslate {
  video_id: string;
  translations: string[];
  caption_hash: number;
}

export interface AppConfig {
  podcast?: PodcastConfig;
}

import { API_BASE, hasBackend } from "./backendMode";

function getToken(): string | null {
  return localStorage.getItem("moyan_token");
}

export function hasPodcastBackend(): boolean {
  return hasBackend();
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
  const body = (await res.json()) as { success?: boolean; data?: T; error?: { message?: string } };
  if (!body.success) {
    throw new Error(body.error?.message || "请求失败");
  }
  return body.data as T;
}

export async function getAppConfig(): Promise<AppConfig> {
  return apiRequest<AppConfig>("/api/config");
}

export async function resolvePodcast(url: string): Promise<PodcastResolved> {
  return apiRequest<PodcastResolved>("/api/podcast/resolve", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function translatePodcast(
  videoId: string
): Promise<PodcastTranslate> {
  return apiRequest<PodcastTranslate>(
    `/api/podcast/translate/${encodeURIComponent(videoId)}`
  );
}

export function podcastAudioUrl(videoId: string): string {
  return `${API_BASE}/api/podcast/audio/${encodeURIComponent(videoId)}`;
}
