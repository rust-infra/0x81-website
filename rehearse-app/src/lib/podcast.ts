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
  rate: number;
  autoplay: boolean;
}

export interface PodcastPlayerOptions {
  episodes: PodcastEpisode[];
  speak: (text: string, opts: { rate: number; language?: string }) => Promise<void>;
  stop: () => Promise<void>;
  onState?: (state: PodcastState) => void;
  gapMs?: number;
  initialRate?: number;
  autoplay?: boolean;
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
  state: () => PodcastState;
}

export interface WordRange {
  start: number;
  length: number;
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
    rate: options.initialRate ?? 0.95,
    autoplay: options.autoplay ?? true,
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
          emit();
          continue;
        }
        state.playing = false;
        emit();
        return;
      }
      emit();
      await options.speak(turn.content, { rate: state.rate, language: 'en-US' });
      if (run !== runId || !state.playing) return;
      await wait(gapMs);
      if (run !== runId || !state.playing) return;
      if (state.turnIndex + 1 < current.turns.length) {
        state.turnIndex += 1;
        emit();
        continue;
      }
      if (state.autoplay && advanceEpisode()) {
        emit();
        continue;
      }
      state.playing = false;
      emit();
      return;
    }
  };

  const restart = () => {
    runId += 1;
    clearTimer();
    void options.stop();
    emit();
    if (!state.playing) return;
    const run = runId;
    void loop(run);
  };

  const clampEpisode = (index: number) =>
    Math.min(Math.max(index, 0), Math.max(0, options.episodes.length - 1));

  return {
    play(episodeIndex) {
      if (episodeIndex != null) {
        state.episodeIndex = clampEpisode(episodeIndex);
        state.turnIndex = 0;
      }
      if (state.playing) return;
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
      state.turnIndex = Math.min(state.turnIndex + 1, current.turns.length - 1);
      restart();
    },
    prevTurn() {
      state.turnIndex = Math.max(state.turnIndex - 1, 0);
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
      state.turnIndex = current ? Math.min(Math.max(turnIndex, 0), current.turns.length - 1) : 0;
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
    state: () => ({ ...state }),
  };
}
