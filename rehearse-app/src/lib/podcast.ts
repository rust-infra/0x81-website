import type { CoachTurn } from './rehearse-types';
import { ENGLISH_LESSONS } from './english-learning-data';

export interface PodcastEpisode {
  id: string;
  title: string;
  lessonTitle: string;
  lessonNumber: number;
  deck: string;
  track: 'main' | 'tech';
  coachName: string;
  turns: CoachTurn[];
}

export interface PodcastState {
  episodeIndex: number;
  turnIndex: number;
  playing: boolean;
  finished: boolean;
  rate: number;
  autoplay: boolean;
  pauseEachLine: boolean;
  loopLine: boolean;
}

export interface PodcastPlayerOptions {
  episodes: PodcastEpisode[];
  speak: (
    text: string,
    opts: { rate: number; language?: string; role?: 'coach' | 'user' }
  ) => Promise<void>;
  stop: () => Promise<void>;
  onState?: (state: PodcastState) => void;
  onError?: (code: 'speak-failed' | 'speech-too-short') => void;
  gapMs?: number;
  initialRate?: number;
  autoplay?: boolean;
  pauseEachLine?: boolean;
  loopLine?: boolean;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface PodcastPlayer {
  play: (episodeIndex?: number) => void;
  pause: () => void;
  toggle: () => void;
  nextTurn: () => void;
  prevTurn: () => void;
  nextEpisode: () => void;
  prevEpisode: () => void;
  seek: (episodeIndex: number, turnIndex: number) => void;
  setRate: (rate: number) => void;
  setAutoplay: (value: boolean) => void;
  setPauseEachLine: (value: boolean) => void;
  setLoopLine: (value: boolean) => void;
  state: () => PodcastState;
}

export interface WordRange {
  start: number;
  length: number;
}

/**
 * 一句话最短可能占用的时间。TTS 在模拟器/无声设备上经常不报错、直接
 * onDone，连播会瞬间跑完整季；低于这个下限就当作没播出来，停下等用户。
 */
function minimumSpeechMs(text: string, rate: number): number {
  return Math.min(1500, (100 + text.length * 6) / Math.max(rate, 0.5));
}

export function estimateWordRange(text: string, progress: number): WordRange | null {
  const matches = [...text.matchAll(/\S+/g)];
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, match) => sum + match[0].length, 0);
  const target = Math.min(Math.max(progress, 0), 1) * total;
  let acc = 0;
  for (const match of matches) {
    acc += match[0].length;
    if (target <= acc || match === matches[matches.length - 1]) {
      return { start: match.index ?? 0, length: match[0].length };
    }
  }
  return null;
}

/**
 * 英语对话标题里常把中文译名塞在末尾括号里（形如
 * `Dialogue 1: New Colleague Introduction(新同事入职介绍)`）。播放页把中文
 * 拆到标题下面单独一行，长标题就不会在括号处断得很碎。
 */
export function splitEpisodeTitle(title: string): {
  title: string;
  subtitle?: string;
} {
  const match = title.match(
    /^(.*?)\s*[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[)）]\s*$/
  );
  if (!match) return { title };
  const main = match[1].trim();
  const subtitle = match[2].trim();
  if (!main || !subtitle) return { title };
  return { title: main, subtitle };
}

export function buildPodcastEpisodes(deck?: string): PodcastEpisode[] {
  return ENGLISH_LESSONS.filter((lesson) => !deck || lesson.deck === deck)
    .flatMap((lesson) =>
      lesson.dialogues.map((dialogue) => ({
        id: dialogue.id,
        title: dialogue.title,
        lessonTitle: lesson.title,
        lessonNumber: lesson.number,
        deck: lesson.deck,
        track: lesson.track,
        coachName: dialogue.scenario.persona.name || 'Coach',
        turns: dialogue.scenario.dialogue ?? [],
      }))
    )
    .filter((episode) => episode.turns.length > 0);
}

export function episodeMinutes(turns: CoachTurn[]): number {
  const words = turns.reduce(
    (count, turn) => count + turn.content.split(/\s+/).filter(Boolean).length,
    0
  );
  return Math.max(1, Math.round(words / 150));
}

export function createPodcastPlayer(options: PodcastPlayerOptions): PodcastPlayer {
  const gapMs = options.gapMs ?? 450;
  const setTimeoutFn =
    options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: PodcastState = {
    episodeIndex: 0,
    turnIndex: 0,
    playing: false,
    finished: false,
    rate: options.initialRate ?? 0.95,
    autoplay: options.autoplay ?? true,
    pauseEachLine: options.pauseEachLine ?? false,
    loopLine: options.loopLine ?? false,
  };
  let runId = 0;
  let timer: unknown = null;
  let timerResolve: (() => void) | null = null;

  const emit = () => options.onState?.({ ...state });
  const clearTimer = () => {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (timerResolve) {
      const resolve = timerResolve;
      timerResolve = null;
      resolve();
    }
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timerResolve = resolve;
      timer = setTimeoutFn(() => {
        timer = null;
        timerResolve = null;
        resolve();
      }, ms);
    });

  const episode = () => options.episodes[state.episodeIndex];

  const advanceEpisode = (): boolean => {
    if (state.episodeIndex + 1 >= options.episodes.length) return false;
    state.episodeIndex += 1;
    state.turnIndex = 0;
    return true;
  };

  const loop = async (run: number) => {
    while (state.playing && run === runId) {
      const current = episode();
      const turn = current?.turns[state.turnIndex];
      if (!turn) {
        if (state.autoplay && advanceEpisode()) {
          state.finished = false;
          emit();
          continue;
        }
        state.playing = false;
        state.finished = true;
        emit();
        return;
      }
      emit();
      const turnRate = state.rate;
      const startedAt = Date.now();
      try {
        await options.speak(turn.content, {
          rate: turnRate,
          language: 'en-US',
          role: turn.role,
        });
      } catch {
        // 朗读失败时停在当前句，而不是把整条连播链断在半路。
        if (run === runId) {
          state.playing = false;
          emit();
          options.onError?.('speak-failed');
        }
        return;
      }
      if (run !== runId || !state.playing) return;
      if (
        turn.content.length >= 8 &&
        Date.now() - startedAt < minimumSpeechMs(turn.content, turnRate)
      ) {
        state.playing = false;
        emit();
        options.onError?.('speech-too-short');
        return;
      }
      await wait(gapMs);
      if (run !== runId || !state.playing) return;
      if (state.loopLine) {
        emit();
        continue;
      }
      if (state.pauseEachLine) {
        if (state.turnIndex + 1 < current.turns.length) {
          state.turnIndex += 1;
          state.playing = false;
          emit();
          return;
        }
        state.playing = false;
        state.finished = true;
        emit();
        return;
      }
      if (state.turnIndex + 1 < current.turns.length) {
        state.turnIndex += 1;
        emit();
        continue;
      }
      if (state.autoplay && advanceEpisode()) {
        state.finished = false;
        emit();
        continue;
      }
      state.playing = false;
      state.finished = true;
      emit();
      return;
    }
  };

  const restart = () => {
    runId += 1;
    clearTimer();
    void options.stop();
    state.finished = false;
    emit();
    if (!state.playing) return;
    const run = runId;
    void loop(run);
  };

  const clampEpisode = (index: number) =>
    Math.min(
      Math.max(Number.isFinite(index) ? Math.floor(index) : 0, 0),
      Math.max(0, options.episodes.length - 1)
    );

  return {
    play(episodeIndex) {
      if (episodeIndex != null) {
        state.episodeIndex = clampEpisode(episodeIndex);
        state.turnIndex = 0;
      } else if (state.finished) {
        // 一集播完后主按钮应该重播整集，而不是只重播最后一句。
        state.turnIndex = 0;
      }
      if (state.playing) return;
      state.finished = false;
      state.playing = true;
      restart();
    },
    pause() {
      if (!state.playing) return;
      state.playing = false;
      runId += 1;
      clearTimer();
      void options.stop();
      emit();
    },
    toggle() {
      state.playing ? this.pause() : this.play();
    },
    nextTurn() {
      const current = episode();
      if (!current) return;
      if (state.turnIndex + 1 < current.turns.length) {
        state.turnIndex += 1;
      } else if (state.episodeIndex + 1 < options.episodes.length) {
        state.episodeIndex += 1;
        state.turnIndex = 0;
      } else {
        state.playing = false;
        state.finished = true;
        runId += 1;
        clearTimer();
        void options.stop();
        emit();
        return;
      }
      restart();
    },
    prevTurn() {
      if (state.turnIndex > 0) {
        state.turnIndex -= 1;
      } else if (state.episodeIndex > 0) {
        state.episodeIndex -= 1;
        state.turnIndex = Math.max(
          0,
          (options.episodes[state.episodeIndex]?.turns.length ?? 1) - 1
        );
      }
      restart();
    },
    nextEpisode() {
      if (!advanceEpisode()) return;
      restart();
    },
    prevEpisode() {
      state.episodeIndex = clampEpisode(state.episodeIndex - 1);
      state.turnIndex = 0;
      restart();
    },
    seek(episodeIndex, turnIndex) {
      state.episodeIndex = clampEpisode(episodeIndex);
      const current = episode();
      const safeTurn = Number.isFinite(turnIndex) ? Math.floor(turnIndex) : 0;
      state.turnIndex = current
        ? Math.min(Math.max(safeTurn, 0), current.turns.length - 1)
        : 0;
      state.finished = false;
      restart();
    },
    setRate(rate) {
      state.rate = rate;
      emit();
    },
    setAutoplay(value) {
      state.autoplay = value;
      emit();
    },
    setPauseEachLine(value) {
      state.pauseEachLine = value;
      if (value) {
        state.loopLine = false;
        state.autoplay = false;
      }
      emit();
    },
    setLoopLine(value) {
      state.loopLine = value;
      if (value) {
        state.pauseEachLine = false;
        state.autoplay = false;
      }
      emit();
    },
    state: () => ({ ...state }),
  };
}
