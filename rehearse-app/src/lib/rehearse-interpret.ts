/**
 * 同传字幕的流式引擎(纯逻辑层,可单测)。
 *
 * 模拟引擎发出的事件与真实 ASR/翻译 WebSocket 管道同构——
 * 换真实流时 UI 层不用改,只需把 `simulateInterpret` 换成真实数据源,
 * 发出同样的回调。
 *
 * 段(segment)生命周期:
 *   interim(识别中,可被改判回滚) → final(断句提交,冻结) → translated(译文就绪)
 */

export interface InterpretUtterance {
  /** 术语表: 英文术语 → 锁定中文译法。原文命中时高亮,悬停显示。 */
  terms: Record<string, string>;
  /** ASR 识别中的假设序列,后一个覆盖前一个(模拟改判)。 */
  partials: string[];
  /** 断句提交后的最终句。 */
  finals: string[];
}

export interface InterpretCallbacks {
  /** ASR 每次修正假设。`tail` 是当前未完成句的不稳定尾部(用于回滚检测)。 */
  onAsrInterim?: (e: { text: string; tail: string; terms: Record<string, string> }) => void;
  /** 句末提交,该行冻结。 */
  onAsrFinal?: (e: { text: string }) => void;
  /** 译文增量就绪(只翻已提交部分,不重翻全文)。 */
  onTranslate?: (e: { zh: string; en: string }) => void;
  onState?: (s: 'listening' | 'paused' | 'done') => void;
}

export interface InterpretEngine {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isPaused: () => boolean;
}

const COMMIT_DELAY_MS = 500;

/**
 * 把一段 ASR 文本切成「已稳定的头」(以句末标点结尾)和「不稳定的尾」。
 */
export function splitInterpretBoundary(text: string): { stable: string; tail: string } {
  const m = text.match(/^([\s\S]*[.!?])\s+([\s\S]+)$/);
  if (!m) return { stable: '', tail: text };
  return { stable: m[1], tail: m[2] };
}

/**
 * 回滚 = 不稳定尾部被改短/改写,而不仅仅是向后延长。
 * 返回被回滚掉的字符数;纯延长返回 0。
 */
export function interpretRollbackLength(prevTail: string, nextTail: string): number {
  if (!prevTail) return 0;
  if (nextTail.startsWith(prevTail)) return 0; // 纯延长
  let i = 0;
  while (i < prevTail.length && i < nextTail.length && prevTail[i] === nextTail[i]) i++;
  return prevTail.length - i;
}

export const INTERPRET_DEMO_SCRIPT: InterpretUtterance[] = [
  {
    terms: { FOB: '离岸价', MOQ: '起订量' },
    partials: [
      'Hello,',
      'Hello, thanks for joining the call.',
      'Hello, thanks for joining the call. We reviewed your quotation',
      'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday,',
      'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday, and the unit price looks a bit high.',
      'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday, and the unit price looks a bit high. Could you offer a better price on FOB Shanghai terms,',
      'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday, and the unit price looks a bit high. Could you offer a better price on FOB Shanghai terms, with an MOQ of five thousand pieces?',
    ],
    finals: [
      'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday, and the unit price looks a bit high.',
      'Could you offer a better price on FOB Shanghai terms, with an MOQ of five thousand pieces?',
    ],
  },
  {
    terms: { 'lead time': '交期', tooling: '模具' },
    partials: [
      'Sure.',
      'Sure. If you can double the order quantity,',
      'Sure. If you can double the order quantity, we can give you three point five dollars per piece.',
      'Sure. If you can double the order quantity, we can give you three point five dollars per piece. The lead time would be',
      'Sure. If you can double the order quantity, we can give you three point five dollars per piece. The lead time would be around forty five days after the tooling is confirmed.',
    ],
    finals: [
      'Sure. If you can double the order quantity, we can give you three point five dollars per piece.',
      'The lead time would be around forty five days after the tooling is confirmed.',
    ],
  },
  {
    terms: { EXW: '工厂交货', CIF: '到岸价' },
    partials: [
      'Understood.',
      'Understood. Could you also quote',
      'Understood. Could you also quote the same items on EXW and CIF,',
      'Understood. Could you also quote the same items on EXW and CIF, so we can compare the total landed cost?',
    ],
    finals: [
      'Understood. Could you also quote the same items on EXW and CIF, so we can compare the total landed cost?',
    ],
  },
  {
    terms: {},
    partials: [
      'No problem.',
      'No problem. I will send',
      'No problem. I will send the updated sheet',
      'No problem. I will send the updated sheet, sorry, the updated quotation',
      'No problem. I will send the updated quotation to your email',
      'No problem. I will send the updated quotation to your email by tomorrow morning.',
    ],
    finals: [
      'No problem. I will send the updated quotation to your email by tomorrow morning.',
    ],
  },
];

export const INTERPRET_DEMO_TRANSLATIONS: Record<string, string> = {
  'Hello, thanks for joining the call. We reviewed your quotation sheet yesterday, and the unit price looks a bit high.':
    '你好,感谢参加今天的会议。我们昨天看了你们的报价单,单价看起来有点高。',
  'Could you offer a better price on FOB Shanghai terms, with an MOQ of five thousand pieces?':
    '能否按 FOB 上海条款给一个更优惠的价格,起订量五千件?',
  'Sure. If you can double the order quantity, we can give you three point five dollars per piece.':
    '可以的。如果你们能把订单量翻倍,我们可以给到每件 3.5 美元。',
  'The lead time would be around forty five days after the tooling is confirmed.':
    '模具确认后,交期大约四十五天。',
  'Understood. Could you also quote the same items on EXW and CIF, so we can compare the total landed cost?':
    '明白。能否再按 EXW 和 CIF 报一遍同样的产品,方便我们比较总的落地成本?',
  'No problem. I will send the updated quotation to your email by tomorrow morning.':
    '没问题。明天上午之前我会把更新后的报价发到你的邮箱。',
};

/** 金额/数量/交期等关键数字的归一化(原文里英文说法 → 紧凑写法)。 */
const NUMBER_PATTERNS: Array<[RegExp, string]> = [
  [/\bfive thousand\b/gi, '5,000'],
  [/\bthree point five dollars per piece\b/gi, '$3.50/pc'],
  [/\bforty five days\b/gi, '45 天'],
  [/\btomorrow morning\b/gi, '明早'],
];

export function normalizeInterpretNumbers(text: string): string {
  let out = text;
  for (const [re, rep] of NUMBER_PATTERNS) out = out.replace(re, rep);
  return out;
}

/**
 * 去掉已经提交过的前缀。连续识别会把整段转写累积着送回来，
 * interim 行只该显示还没冻结的部分。
 */
export function stripCommittedPrefix(text: string, prefix: string): string {
  if (!prefix) return text;
  if (!text.startsWith(prefix)) return text;
  return text.slice(prefix.length).trimStart();
}

export interface TermChunk {
  text: string;
  term?: string;
  gloss?: string;
}

/** 按术语表切分原文，命中词带 gloss，供 UI 渲染成 Chip。 */
export function splitByTerms(text: string, terms: Record<string, string>): TermChunk[] {
  const keys = Object.keys(terms);
  if (!keys.length) return [{ text }];
  const re = new RegExp(
    `\\b(${keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
  );
  const out: TermChunk[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index) });
    const term = match[0];
    out.push({
      text: term,
      term,
      gloss: terms[term] ?? terms[term.toLowerCase()] ?? terms[term.toUpperCase()],
    });
    last = index + term.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export interface NumberChunk {
  text: string;
  num?: boolean;
}

/** 切出金额、数量、日期等关键数字，UI 用等宽样式锁定。 */
export function splitByNumbers(text: string): NumberChunk[] {
  const re = /(\$[\d.,]+(?:\/\w+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:天|件|pcs?|days?|%|美元)?)/g;
  const out: NumberChunk[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index) });
    out.push({ text: match[0], num: true });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export interface TranslationTask {
  id: number;
  text: string;
}

export interface TranslationQueueOptions {
  run: (task: TranslationTask, signal: AbortSignal) => Promise<string>;
  onResult: (id: number, translation: string) => void;
  onError: (id: number) => void;
  onOverflow: (id: number) => void;
  maxPending?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface TranslationQueue {
  push: (task: TranslationTask) => void;
  clear: () => void;
  pendingCount: () => number;
}

export const MAX_PENDING_TRANSLATIONS = 8;
export const MAX_TRANSLATION_CONCURRENCY = 2;
export const TRANSLATION_TIMEOUT_MS = 15_000;

/**
 * 有界翻译队列。超过待译上限的直接走 onOverflow，
 * 避免 LLM 变慢时字幕落后几十句。clear() 会中止所有在途请求。
 */
export function createTranslationQueue(options: TranslationQueueOptions): TranslationQueue {
  const maxPending = options.maxPending ?? MAX_PENDING_TRANSLATIONS;
  const concurrency = Math.max(1, options.concurrency ?? MAX_TRANSLATION_CONCURRENCY);
  const timeoutMs = options.timeoutMs ?? TRANSLATION_TIMEOUT_MS;
  const pending: TranslationTask[] = [];
  const controllers = new Set<AbortController>();
  const cancelled = new WeakSet<AbortController>();
  let inFlight = 0;

  const pump = () => {
    while (inFlight < concurrency && pending.length > 0) {
      const task = pending.shift();
      if (!task) break;
      inFlight += 1;
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      void options
        .run(task, controller.signal)
        .then((translation) => options.onResult(task.id, translation))
        .catch(() => {
          if (!cancelled.has(controller)) options.onError(task.id);
        })
        .finally(() => {
          clearTimeout(timer);
          controllers.delete(controller);
          inFlight -= 1;
          pump();
        });
    }
  };

  return {
    push(task) {
      if (pending.length >= maxPending) {
        options.onOverflow(task.id);
        return;
      }
      pending.push(task);
      pump();
    },
    clear() {
      pending.length = 0;
      for (const controller of controllers) {
        cancelled.add(controller);
        controller.abort();
      }
      controllers.clear();
    },
    pendingCount: () => pending.length,
  };
}

export interface SimulateOptions extends InterpretCallbacks {
  speed?: number;
  script?: InterpretUtterance[];
  translations?: Record<string, string>;
  /** 注入定时器,测试时用同步实现。 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (h: unknown) => void;
}

/**
 * 模拟一场同传流。回调形状就是 UI 的输入契约，换真实数据源时保持不变。
 * `speed` 越大越快(1 = 真实语速节奏)。
 */
export function simulateInterpret(opts: SimulateOptions): InterpretEngine {
  const {
    speed = 1,
    script = INTERPRET_DEMO_SCRIPT,
    translations = INTERPRET_DEMO_TRANSLATIONS,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onAsrInterim,
    onAsrFinal,
    onTranslate,
    onState,
  } = opts;

  const committed: string[] = [];
  let consumed = 0; // 已翻译到第几个 final
  let ui = 0;
  let pi = 0;
  let fi = 0;
  let timer: unknown = null;
  let paused = false;
  let stopped = false;

  const sleep = (ms: number) => Math.max(24, ms / speed);
  const emitState = (s: 'listening' | 'paused' | 'done') => onState?.(s);

  function flushTranslations() {
    for (let i = consumed; i < committed.length; i++) {
      const en = committed[i];
      const zh = translations[en];
      if (zh) onTranslate?.({ zh: normalizeInterpretNumbers(zh), en: normalizeInterpretNumbers(en) });
    }
    consumed = committed.length;
  }

  function commitFinal(text: string) {
    committed.push(text);
    fi += 1;
    onAsrFinal?.({ text });
    flushTranslations();
  }

  function step() {
    if (stopped) return;
    if (paused) {
      timer = setTimeoutFn(step, 120);
      return;
    }
    const u = script[ui];
    if (!u) {
      emitState('done');
      return;
    }

    if (pi < u.partials.length) {
      const text = u.partials[pi];
      const { stable, tail } = splitInterpretBoundary(text);
      onAsrInterim?.({ text, tail, terms: u.terms });

      // 头部稳定区以「刚完成的下一句 final」结尾时,稍作停顿后提交它。
      if (stable && fi < u.finals.length && stable.endsWith(u.finals[fi])) {
        const finalText = u.finals[fi];
        timer = setTimeoutFn(() => {
          if (stopped || paused) {
            timer = setTimeoutFn(step, 120);
            return;
          }
          commitFinal(finalText);
          pi += 1;
          timer = setTimeoutFn(step, sleep(140));
        }, sleep(COMMIT_DELAY_MS));
        return;
      }

      pi += 1;
      timer = setTimeoutFn(step, sleep(300));
      return;
    }

    if (fi < u.finals.length) {
      commitFinal(u.finals[fi]);
      timer = setTimeoutFn(step, sleep(260));
      return;
    }

    ui += 1;
    pi = 0;
    fi = 0;
    timer = setTimeoutFn(step, sleep(900));
  }

  return {
    start() {
      emitState('listening');
      step();
    },
    pause() {
      if (paused || stopped) return;
      paused = true;
      emitState('paused');
    },
    resume() {
      if (!paused || stopped) return;
      paused = false;
      emitState('listening');
    },
    stop() {
      stopped = true;
      if (timer != null) clearTimeoutFn(timer);
    },
    isPaused: () => paused,
  };
}
