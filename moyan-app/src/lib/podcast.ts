import AsyncStorage from '@react-native-async-storage/async-storage';

export const PODCAST_RECENT_KEY = 'podcast_recent';
const MAX_RECENT = 10;

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
