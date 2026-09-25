// Web 端播客搜索缓存 + 最近播放（对应 moyan-app 的 lib/podcast.ts，AsyncStorage → localStorage）

export const PODCAST_RECENT_KEY = "podcast_recent";
export const PODCAST_SEARCH_CACHE_KEY = "podcast_search_cache";
const MAX_RECENT = 10;
const MAX_SEARCH_CACHE = 20;

export interface RecentItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  url: string;
  at: number;
}

export function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(PODCAST_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.sort((a: RecentItem, b: RecentItem) => b.at - a.at)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(item: RecentItem): void {
  try {
    const current = loadRecent();
    const next = [item, ...current.filter((r) => r.id !== item.id)]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RECENT);
    localStorage.setItem(PODCAST_RECENT_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}

export interface CachedSearch {
  query: string;
  at: number;
  items: { id: string; title: string; channel: string; thumbnail: string | null }[];
  nextPageToken?: string;
}

export function loadSearchCache(
  query: string
): { items: CachedSearch["items"]; nextPageToken?: string } | null {
  try {
    const raw = localStorage.getItem(PODCAST_SEARCH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const hit = parsed.find(
      (c) => c && c.query === query && Array.isArray(c.items)
    );
    return hit
      ? {
          items: hit.items as CachedSearch["items"],
          nextPageToken: hit.nextPageToken || "",
        }
      : null;
  } catch {
    return null;
  }
}

export function saveSearchCache(
  query: string,
  items: CachedSearch["items"],
  nextPageToken?: string
): void {
  try {
    const raw = localStorage.getItem(PODCAST_SEARCH_CACHE_KEY);
    const cached: CachedSearch[] = raw ? JSON.parse(raw) : [];
    const next = [
      { query, at: Date.now(), items, nextPageToken },
      ...cached.filter((c) => c && c.query !== query),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_SEARCH_CACHE);
    localStorage.setItem(PODCAST_SEARCH_CACHE_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}
