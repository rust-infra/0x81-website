/**
 * 麦克风同传的生命周期控制器。
 *
 * UI 只管画面，识别会话的启动、暂停、重启、错误映射都在这里。
 * `start` 注入真实 STT 适配器或测试替身，因此不接设备也能测。
 */

export type MicState = 'idle' | 'listening' | 'paused';
export type MicErrorKind = 'denied' | 'unsupported';

export interface MicSessionLike {
  stop: () => void;
  abort: () => void;
}

export interface MicStartCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface MicSessionOptions {
  start: (locale: string, callbacks: MicStartCallbacks) => Promise<MicSessionLike>;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (kind: MicErrorKind) => void;
  locale?: string;
  restartDelayMs?: number;
  fastEndMs?: number;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface MicSessionController {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setLocale: (locale: string) => void;
  state: () => MicState;
}

export function createMicSessionController(options: MicSessionOptions): MicSessionController {
  const restartDelayMs = options.restartDelayMs ?? 300;
  const fastEndMs = options.fastEndMs ?? 1000;
  const now = options.now ?? Date.now;
  const setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: MicState = 'idle';
  let locale = options.locale ?? 'en-US';
  let session: MicSessionLike | null = null;
  let starting = false;
  let generation = 0;
  let restartHandle: unknown = null;
  let restartPending = false;
  let startedAt = 0;
  let fastEnds = 0;

  const emitState = (next: MicState) => {
    state = next;
  };

  const clearRestart = () => {
    if (restartHandle != null) {
      clearTimeoutFn(restartHandle);
      restartHandle = null;
    }
  };

  const startSession = async () => {
    if (session || starting || state !== 'listening') return;
    starting = true;
    const run = ++generation;
    try {
      const next = await options.start(locale, {
        onInterim: options.onInterim,
        onFinal: options.onFinal,
        onError: (message) => {
          session = null;
          if (state !== 'listening') return;
          emitState('idle');
          options.onError(/not-allowed|permission|denied/i.test(message) ? 'denied' : 'unsupported');
        },
        onEnd: () => {
          session = null;
          if (state !== 'listening') return;
          const ranMs = now() - startedAt;
          fastEnds = ranMs < fastEndMs ? fastEnds + 1 : 0;
          if (fastEnds >= 3) {
            emitState('idle');
            options.onError('unsupported');
            return;
          }
          clearRestart();
          restartHandle = setTimeoutFn(() => {
            restartHandle = null;
            void startSession();
          }, restartDelayMs);
        },
      });
      if (run !== generation || state !== 'listening') {
        next.abort();
        return;
      }
      session = next;
      startedAt = now();
    } catch (error) {
      if (run !== generation) return;
      emitState('idle');
      const message = error instanceof Error ? error.message : String(error);
      options.onError(/denied|restricted/.test(message) ? 'denied' : 'unsupported');
    } finally {
      if (run === generation) starting = false;
      if (restartPending && state === 'listening') {
        restartPending = false;
        starting = false;
        void startSession();
      }
    }
  };

  return {
    start() {
      if (state === 'listening') return;
      clearRestart();
      fastEnds = 0;
      emitState('listening');
      void startSession();
    },
    pause() {
      if (state !== 'listening') return;
      emitState('paused');
      generation += 1;
      clearRestart();
      if (session) {
        const current = session;
        session = null;
        current.stop();
      }
    },
    resume() {
      if (state !== 'paused') return;
      emitState('listening');
      void startSession();
    },
    stop() {
      generation += 1;
      restartPending = false;
      clearRestart();
      emitState('idle');
      if (session) {
        const current = session;
        session = null;
        current.abort();
      }
    },
    setLocale(next) {
      if (next === locale) return;
      locale = next;
      if (state !== 'listening') return;
      restartPending = true;
      generation += 1;
      if (session) {
        const current = session;
        session = null;
        current.abort();
      }
      if (!starting) {
        restartPending = false;
        void startSession();
      }
    },
    state: () => state,
  };
}
