// Web 端播客播放器管理器（对应 moyan-app 的 lib/podcast-player.ts）。
// 用 HTML5 Audio 实现；进度存 localStorage，下次进入自动续播。

import type { TimedCaption } from "../services/podcastService";

const PROGRESS_KEY = "podcast_progress";
const SAVE_INTERVAL_MS = 5000;
const RESUME_MIN_MS = 5000;
const RESUME_TAIL_GUARD_MS = 10000;
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

class PodcastPlayerManager {
  private audio: HTMLAudioElement | null = null;
  private sourceUrl = "";
  private videoId = "";
  private title = "";
  private channel = "";
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

  getActiveCaption() {
    if (this.captions.length === 0 || this.currentMs <= 0) return null;
    const idx = this.captions.findIndex(
      (cap) => this.currentMs >= cap.start_ms && this.currentMs < cap.end_ms
    );
    if (idx < 0) return null;
    return {
      en: this.captions[idx].text,
      zh: this.translations[idx] || "",
      startMs: this.captions[idx].start_ms,
    };
  }

  setTranslations(translations: string[]): void {
    this.translations = translations;
    this.notify();
  }

  async ensure(opts: EnsureOptions): Promise<number> {
    if (this.audio && this.sourceUrl === opts.url) {
      this.videoId = opts.videoId;
      this.title = opts.title;
      this.channel = opts.channel;
      this.notify();
      return 0;
    }

    this.teardown();
    const audio = new Audio(opts.url);
    audio.preload = "auto";
    this.audio = audio;
    this.sourceUrl = opts.url;
    this.videoId = opts.videoId;
    this.title = opts.title;
    this.channel = opts.channel;
    this.captions = opts.captions;
    this.translations = [];
    this.playing = false;
    this.currentMs = 0;
    this.durationMs = 0;
    this.speed = 1;

    audio.addEventListener("timeupdate", () => {
      this.currentMs = (audio.currentTime || 0) * 1000;
      if (Number.isFinite(audio.duration)) {
        this.durationMs = audio.duration * 1000;
      }
      this.notify();
    });
    audio.addEventListener("play", () => {
      this.playing = true;
      this.notify();
    });
    audio.addEventListener("pause", () => {
      this.playing = false;
      this.notify();
    });
    audio.addEventListener("ended", () => {
      this.playing = false;
      this.currentMs = 0;
      this.clearProgress(this.videoId);
      this.notify();
    });
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration)) {
        this.durationMs = audio.duration * 1000;
        this.notify();
      }
    });

    const saved = this.loadProgress(opts.videoId);
    const startMs = this.pickResume(saved);
    if (startMs > 0) {
      try {
        audio.currentTime = startMs / 1000;
      } catch {
        // ignore seek failures
      }
    }
    this.startSaveTimer();
    try {
      void audio.play();
    } catch {
      // autoplay may be blocked; screen still shows controls
    }
    this.notify();
    return startMs;
  }

  togglePlay(): void {
    const audio = this.audio;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
      this.saveProgress();
    }
  }

  seekTo(ms: number): void {
    if (!this.audio) return;
    this.audio.currentTime = Math.max(ms / 1000, 0);
    this.currentMs = Math.max(ms, 0);
    this.notify();
  }

  setSpeed(next: number): void {
    this.speed = next;
    if (this.audio) this.audio.playbackRate = next;
    this.notify();
  }

  flushProgress(): void {
    this.saveProgress();
  }

  teardown(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveProgress();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
    }
    this.audio = null;
    this.sourceUrl = "";
    this.playing = false;
    this.currentMs = 0;
    this.durationMs = 0;
  }

  private startSaveTimer(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = setInterval(() => {
      if (this.playing && this.currentMs > 0) {
        this.saveProgress();
      }
    }, SAVE_INTERVAL_MS);
  }

  private loadProgress(videoId: string): ProgressEntry | null {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      const map: ProgressMap = JSON.parse(raw);
      const entry = map?.[videoId];
      return entry && typeof entry.position_ms === "number" ? entry : null;
    } catch {
      return null;
    }
  }

  private saveProgress(): void {
    if (!this.videoId || this.currentMs <= 0 || !this.audio) return;
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const map: ProgressMap = raw ? JSON.parse(raw) : {};
      map[this.videoId] = {
        at: Date.now(),
        position_ms: Math.floor(this.currentMs),
        duration_ms: Math.floor(this.durationMs),
      };
      const pruned = Object.entries(map)
        .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
        .slice(0, MAX_PROGRESS_ENTRIES);
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(pruned)));
    } catch {
      // best-effort
    }
  }

  private clearProgress(videoId: string): void {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const map: ProgressMap = JSON.parse(raw);
      if (!map?.[videoId]) return;
      delete map[videoId];
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
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
