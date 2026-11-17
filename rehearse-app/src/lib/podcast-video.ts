import type { ApiRequest } from './api-client';

export type PodcastClipState =
  | 'missing'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

export interface PodcastClipStatus {
  key: string;
  status: PodcastClipState;
  url?: string;
  error?: string;
  queuePosition?: number;
  version?: string;
}

export interface PodcastClipApi {
  request: (
    text: string,
    options?: { enqueue?: boolean }
  ) => Promise<PodcastClipStatus>;
  status: (key: string) => Promise<PodcastClipStatus>;
}

export interface PodcastClipSource {
  uri: string;
  headers: { Authorization: string };
}

export function createPodcastClipApi(request: ApiRequest): PodcastClipApi {
  return {
    request: (text, options) =>
      request<PodcastClipStatus>('/api/rehearse/podcast/clips', {
        method: 'POST',
        body: JSON.stringify({ text, enqueue: options?.enqueue }),
      }),
    status: (key) =>
      request<PodcastClipStatus>(
        `/api/rehearse/podcast/clips/${encodeURIComponent(key)}`
      ),
  };
}

export function resolvePodcastClipSource(
  status: PodcastClipStatus,
  token: string | null,
  baseUrl: string
): PodcastClipSource | null {
  if (status.status !== 'ready' || !status.url || !token) return null;
  return {
    uri: `${baseUrl}${status.url}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('poster read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function loadPodcastPoster(
  token: string | null,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (!token) return null;
  const response = await fetchImpl(`${baseUrl}/api/rehearse/podcast/poster`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return blobToDataUri(await response.blob());
}
