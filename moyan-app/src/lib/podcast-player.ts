import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import type { TimedCaption } from './types';

const PROGRESS_KEY = 'podcast_progress';
const SAVE_INTERVAL_MS = 5_000;
const RESUME_MIN_MS = 5_000;
const RESUME_TAIL_GUARD_MS = 10_000;
const MAX_PROGRESS_ENTRIES = 30;

interface ProgressEntry {
  at: number;
  position_ms: number;
  duration_ms: number;
}

type ProgressMap = Record<string, ProgressEntry>;
type Listener = () => void;

export interface PodcastPlayerSnapshot {
  videoId: string;
  title: string;
  channel: string;
  playing: boolean;
  currentMs: number;
  durationMs: number;
  speed: number;
}

export interface EnsureOptions {
  videoId: string;
  url: string;
  youtubeUrl: string;
  title: string;
  channel: string;
  captions: TimedCaption[];
}

export interface ActiveCaption {
  en: string;
  zh: string;
  startMs: number;
}

/**
 * Module-level audio manager. The native player lives here instead of inside a
 * screen, so leaving the player page (or backgrounding the app) keeps audio
 * playing. Playback progress is persisted locally and resumed on the next
 * visit.
 */
class PodcastPlayerManager {
  private player: AudioPlayer | null = null;
  private sourceUrl = '';
  private youtubeUrl = '';
  private videoId = '';
  private title = '';
  private channel = '';
  private captions: TimedCaption[] = [];
  private translations: string[] = [];
  private playing = false;
  private currentMs = 0;
  private durationMs = 0;
  private speed = 1;
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): PodcastPlayerSnapshot {
    return {
      videoId: this.videoId,
      title: this.title,
      channel: this.channel,
      playing: this.playing,
      currentMs: this.currentMs,
      durationMs: this.durationMs,
      speed: this.speed,
    };
  }

  /** Info needed to re-open the player page from a floating overlay. */
  getSource(): { youtubeUrl: string; title: string; channel: string } | null {
    return this.player
      ? {
          youtubeUrl: this.youtubeUrl,
          title: this.title,
          channel: this.channel,
        }
      : null;
  }

  getActiveCaption(): ActiveCaption | null {
    if (this.captions.length === 0 || this.currentMs <= 0) return null;
    const idx = this.captions.findIndex(
      (cap) => this.currentMs >= cap.start_ms && this.currentMs < cap.end_ms
    );
    if (idx < 0) return null;
    return {
      en: this.captions[idx].text,
      zh: this.translations[idx] || '',
      startMs: this.captions[idx].start_ms,
    };
  }

  /** Provide subtitle translations once the player screen fetches them. */
  setTranslations(translations: string[]): void {
    this.translations = translations;
    this.notify();
  }

  /** Prepare the given source and start playing. Returns the ms position we
   *  resumed from (0 when starting from the beginning). */
  async ensure(opts: EnsureOptions): Promise<number> {
    if (this.player && this.sourceUrl === opts.url) {
      this.videoId = opts.videoId;
      this.title = opts.title;
      this.channel = opts.channel;
      this.notify();
      return 0;
    }

    await this.teardown();
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    const player = createAudioPlayer(opts.url);
    this.player = player;
    this.sourceUrl = opts.url;
    this.youtubeUrl = opts.youtubeUrl;
    this.videoId = opts.videoId;
    this.title = opts.title;
    this.channel = opts.channel;
    this.captions = opts.captions;
    this.translations = [];
    this.playing = false;
    this.currentMs = 0;
    this.durationMs = 0;
    this.speed = 1;

    player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (typeof status.currentTime === 'number') {
        this.currentMs = status.currentTime * 1000;
      }
      if (typeof status.duration === 'number') {
        this.durationMs = status.duration * 1000;
      }
      this.playing = !!status.playing;
      if (status.didJustFinish) {
        void this.clearProgress(this.videoId);
      }
      this.notify();
    });

    try {
      player.setActiveForLockScreen(true, {
        title: opts.title,
        artist: opts.channel || 'YouTube',
      });
    } catch {
      // lock screen controls unavailable on this platform
    }

    const saved = await this.loadProgress(opts.videoId);
    const startMs = this.pickResume(saved);
    if (startMs > 0) {
      try {
        player.seekTo(startMs / 1000);
      } catch {
        // ignore seek failures (e.g. source not loaded yet)
      }
    }
    this.startSaveTimer();
    try {
      player.play();
    } catch {
      // e.g. web without a playable source; screen still shows the player UI
    }
    this.notify();
    return startMs;
  }

  togglePlay(): void {
    const player = this.player;
    if (!player) return;
    if (this.playing) {
      player.pause();
      void this.saveProgress();
    } else {
      player.play();
    }
  }

  seekTo(ms: number): void {
    this.player?.seekTo(Math.max(ms / 1000, 0));
    this.currentMs = Math.max(ms, 0);
    this.notify();
  }

  setSpeed(next: number): void {
    this.speed = next;
    this.player?.setPlaybackRate(next);
    this.notify();
  }

  /** Persist the current position immediately (used by pause / source switch). */
  async flushProgress(): Promise<void> {
    await this.saveProgress();
  }

  private async teardown(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveProgress();
    if (this.player) {
      try {
        this.player.pause();
        this.player.release();
      } catch {
        // ignore release errors
      }
      this.player = null;
    }
    this.sourceUrl = '';
    this.youtubeUrl = '';
    this.playing = false;
    this.currentMs = 0;
    this.durationMs = 0;
  }

  private startSaveTimer(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = setInterval(() => {
      if (this.playing && this.currentMs > 0) {
        void this.saveProgress();
      }
    }, SAVE_INTERVAL_MS);
  }

  private async loadProgress(videoId: string): Promise<ProgressEntry | null> {
    try {
      const raw = await AsyncStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      const map: ProgressMap = JSON.parse(raw);
      const entry = map?.[videoId];
      return entry && typeof entry.position_ms === 'number' ? entry : null;
    } catch {
      return null;
    }
  }

  private async saveProgress(): Promise<void> {
    if (!this.videoId || this.currentMs <= 0 || !this.player) return;
    try {
      const raw = await AsyncStorage.getItem(PROGRESS_KEY);
      const map: ProgressMap = raw ? JSON.parse(raw) : {};
      map[this.videoId] = {
        at: Date.now(),
        position_ms: Math.floor(this.currentMs),
        duration_ms: Math.floor(this.durationMs),
      };
      const pruned = Object.entries(map)
        .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
        .slice(0, MAX_PROGRESS_ENTRIES);
      await AsyncStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify(Object.fromEntries(pruned))
      );
    } catch {
      // progress is best-effort
    }
  }

  private async clearProgress(videoId: string): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const map: ProgressMap = JSON.parse(raw);
      if (!map?.[videoId]) return;
      delete map[videoId];
      await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  private pickResume(saved: ProgressEntry | null): number {
    if (!saved) return 0;
    const pos = saved.position_ms;
    if (pos < RESUME_MIN_MS) return 0;
    if (saved.duration_ms > 0 && pos > saved.duration_ms - RESUME_TAIL_GUARD_MS) {
      return 0;
    }
    return pos;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const podcastPlayer = new PodcastPlayerManager();
