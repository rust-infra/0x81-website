import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PodcastProgress {
  episodeId: string;
  episodeIndex: number;
  turnIndex: number;
  updatedAt: number;
}

export type PodcastProgressInput = Omit<PodcastProgress, 'updatedAt'>;

function storageKey(deck: string): string {
  return `podcast_progress:${deck}`;
}

export function parsePodcastProgress(raw: string | null): PodcastProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PodcastProgress> | null;
    if (
      !value ||
      typeof value.episodeId !== 'string' ||
      !value.episodeId ||
      typeof value.episodeIndex !== 'number' ||
      !Number.isFinite(value.episodeIndex) ||
      value.episodeIndex < 0 ||
      typeof value.turnIndex !== 'number' ||
      !Number.isFinite(value.turnIndex) ||
      value.turnIndex < 0
    ) {
      return null;
    }
    return {
      episodeId: value.episodeId,
      episodeIndex: Math.floor(value.episodeIndex),
      turnIndex: Math.floor(value.turnIndex),
      updatedAt:
        typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
          ? value.updatedAt
          : 0,
    };
  } catch {
    return null;
  }
}

export async function loadPodcastProgress(
  deck: string
): Promise<PodcastProgress | null> {
  const raw = await AsyncStorage.getItem(storageKey(deck));
  return parsePodcastProgress(raw);
}

export async function savePodcastProgress(
  deck: string,
  input: PodcastProgressInput
): Promise<void> {
  await AsyncStorage.setItem(
    storageKey(deck),
    JSON.stringify({ ...input, updatedAt: Date.now() })
  );
}
