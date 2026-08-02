import AsyncStorage from '@react-native-async-storage/async-storage';

export const PODCAST_RECENT_KEY = 'podcast_recent';
export const PODCAST_SEARCH_CACHE_KEY = 'podcast_search_cache';
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

export async function loadRecent(): Promise<RecentItem[]> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => b.at - a.at)
      : [];
  } catch {
    return [];
  }
}

export async function saveRecent(item: RecentItem): Promise<void> {
  try {
    const current = await loadRecent();
    const next = [
      item,
      ...current.filter((r) => r.id !== item.id),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RECENT);
    await AsyncStorage.setItem(PODCAST_RECENT_KEY, JSON.stringify(next));
  } catch {
    // 最近播放只是增强功能，失败不影响播放
  }
}

export interface CachedSearch {
  query: string;
  at: number;
  items: { id: string; title: string; channel: string; thumbnail: string | null }[];
  nextPageToken?: string;
}

export async function loadSearchCache(
  query: string
): Promise<{ items: CachedSearch['items']; nextPageToken?: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_SEARCH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const hit = parsed.find(
      (c) => c && c.query === query && Array.isArray(c.items)
    );
    return hit
      ? {
          items: hit.items as CachedSearch['items'],
          nextPageToken: hit.nextPageToken || '',
        }
      : null;
  } catch {
    return null;
  }
}

export async function saveSearchCache(
  query: string,
  items: CachedSearch['items'],
  nextPageToken?: string
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_SEARCH_CACHE_KEY);
    const cached: CachedSearch[] = raw ? JSON.parse(raw) : [];
    const next = [
      { query, at: Date.now(), items, nextPageToken },
      ...cached.filter((c) => c && c.query !== query),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_SEARCH_CACHE);
    await AsyncStorage.setItem(
      PODCAST_SEARCH_CACHE_KEY,
      JSON.stringify(next)
    );
  } catch {
    // 缓存只是加速，失败不影响搜索
  }
}
