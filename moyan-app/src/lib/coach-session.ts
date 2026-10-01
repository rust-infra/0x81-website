import type {
  CoachExpression,
  CoachFeedback,
  CoachMode,
  CoachSessionDraft,
  CoachSessionTurn,
  CoachTurn,
} from './coach-types';

/**
 * A transcript turn. `feedback` is local-only: it is attached to the user turn
 * it corrects so the transcript can show it beside that message, and
 * `wireHistory` strips it back off before anything is sent upstream or handed
 * to the summary screen.
 *
 * 结构与 `CoachSessionTurn` 相同（后者也用于会话草稿），这里只是本模块沿用的名字。
 */
export type SessionTurn = CoachSessionTurn;

/** 生成一轮的稳定 id（时间戳 + 随机后缀，够用且不依赖 uuid 库）。 */
export function newTurnId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSuggestedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const MAX_TURN_REPLY_CHARS = 240;
const MAX_TURN_HISTORY_TURNS = 38;

/** Trim the history that is sent with a turn, reserving room for the latest user turn and reply. */
export function prepareHistoryForTurn<T extends CoachTurn>(
  history: T[],
  userText: string
): T[] {
  const charBudget = Math.max(
    0,
    MAX_HISTORY_CHARS - userText.length - MAX_TURN_REPLY_CHARS
  );
  return trimHistoryNewest(history, MAX_TURN_HISTORY_TURNS, charBudget);
}

function trimHistoryNewest<T extends CoachTurn>(
  history: T[],
  maxTurns: number,
  maxChars: number
): T[] {
  const candidates = history.slice(-maxTurns);
  const kept: T[] = [];
  let total = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const size = candidate.content.length;
    if (kept.length > 0 && total + size > maxChars) break;
    kept.push(candidate);
    total += size;
  }
  return kept.reverse();
}

/** Exact normalized match only; reject partial matches to avoid attaching the wrong hint. */
export function matchNextLine(
  spokenText: string,
  lines: CoachExpression[]
): CoachExpression | undefined {
  const spoken = normalizeSuggestedText(spokenText);
  if (!spoken) return undefined;
  return lines.find((line) => normalizeSuggestedText(line.en) === spoken);
}

/** The upstream payload is `{ role, content }` only. */
export function wireHistory(history: SessionTurn[]): CoachTurn[] {
  return history.map(({ role, content }) => ({ role, content }));
}

/**
 * 最近一条教练回复给出的推荐语 —— 「接下来可以怎么说」永远指最新那一句。
 *
 * 从历史里推导而不是另外存一份状态：推荐语本来就属于某一条回复，
 * 两份数据很容易走岔（旧的一份留在页面上就变成"过期建议"）。
 */
export function latestNextLines(history: SessionTurn[]): CoachExpression[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== 'coach') continue;
    return turn.nextLines ?? [];
  }
  return [];
}

/** Latest user turn that has feedback, so older feedback cards can stay folded. */
export function latestFeedbackTurnIndex(history: SessionTurn[]): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== 'user') continue;
    return turn.feedback ? index : -1;
  }
  return -1;
}

function feedbackBlockedTexts(feedback: CoachFeedback | null | undefined): string[] {
  if (!feedback) return [];
  const blocked = feedback.expressions.map((expression) => expression.en);
  feedback.corrections.forEach((correction) => {
    blocked.push(correction.original, correction.corrected);
  });
  if (feedback.better_phrasing) {
    blocked.push(feedback.better_phrasing.original, feedback.better_phrasing.natural);
  }
  return blocked.filter((value) => value.trim().length > 0);
}

/** Defensive client-side cleanup in addition to the server-side sanitizer. */
export function filterNextLines(
  lines: CoachExpression[],
  feedback?: CoachFeedback | null,
  reply?: string
): CoachExpression[] {
  const blocked = new Set(
    [...feedbackBlockedTexts(feedback), reply ?? '']
      .map(normalizeSuggestedText)
      .filter(Boolean)
  );
  const seen = new Set<string>();
  const out: CoachExpression[] = [];
  for (const line of lines) {
    const en = line.en.trim();
    const zh = line.zh.trim();
    const normalized = normalizeSuggestedText(en);
    if (!en || !normalized || blocked.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ en, zh });
    if (out.length === 2) break;
  }
  return out;
}

export function turnLimitReached(turnIndex: number, maxTurns: number): boolean {
  return turnIndex >= maxTurns;
}

/**
 * 草稿最多留半天：隔夜再打开不该"复活"上一次练习，从开场白重新开始更符合预期。
 */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * 判断草稿能否拿来恢复。返回 null 表示应该照常从开场白开始。
 *
 * 三条规则：
 *   1. 必须属于同一个场景 —— 换场景进来不能被上一局的对话劫持；
 *   2. 必须还没过期（否则隔天的练习会突然出现）；
 *   3. 必须已经说过至少一句 —— 只有开场白的草稿没有恢复价值，
 *      照常重开会重新随机一个开场白。
 */
export function restorableDraft(
  draft: CoachSessionDraft | null | undefined,
  scenarioId: string | undefined,
  now: number,
  maxAgeMs = DRAFT_MAX_AGE_MS
): CoachSessionDraft | null {
  if (!draft || !scenarioId) return null;
  if (draft.scenarioId !== scenarioId) return null;
  if (!Array.isArray(draft.history)) return null;
  if (!hasUserTurn(draft.history) && !draft.pendingText?.trim()) return null;
  if (draft.mode !== 'feedback' && draft.mode !== 'immersion') return null;
  if (!Number.isFinite(draft.turnIndex) || draft.turnIndex < 0) return null;
  if (!Number.isFinite(draft.startedAt) || draft.startedAt <= 0) return null;
  if (!Number.isFinite(draft.savedAt)) return null;
  if (now - draft.savedAt > maxAgeMs) return null;
  if (
    draft.history.some(
      (turn) =>
        !turn ||
        (turn.role !== 'coach' && turn.role !== 'user') ||
        typeof turn.content !== 'string'
    )
  ) {
    return null;
  }

  const history = [...draft.history];
  const pendingParts: string[] = [];
  while (history.at(-1)?.role === 'user') {
    const pending = history.pop();
    if (pending?.content.trim()) pendingParts.unshift(pending.content.trim());
  }
  const pendingText = pendingParts.at(-1) ?? draft.pendingText?.trim() ?? '';
  if (history.length === 0 && !pendingText) return null;
  const restored: CoachSessionDraft = {
    ...draft,
    history,
  };
  if (pendingText) restored.pendingText = pendingText;
  else delete restored.pendingText;
  return restored;
}

export interface TurnRequestHandle {
  id: number;
  controller: AbortController;
}

/** Synchronous single-flight guard for turn submissions. */
export function createTurnRequestGate() {
  let current: TurnRequestHandle | null = null;
  let nextId = 0;
  return {
    active(): boolean {
      return current !== null;
    },
    begin(): TurnRequestHandle | null {
      if (current) return null;
      nextId += 1;
      current = { id: nextId, controller: new AbortController() };
      return current;
    },
    isCurrent(handle: TurnRequestHandle | null | undefined): boolean {
      return !!handle && current === handle;
    },
    finish(handle: TurnRequestHandle | null | undefined): void {
      if (handle && current === handle) current = null;
    },
    cancel(): TurnRequestHandle | null {
      const cancelled = current;
      current = null;
      cancelled?.controller.abort();
      return cancelled;
    },
    current(): TurnRequestHandle | null {
      return current;
    },
  };
}

export type CoachSessionState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface CoachSessionSnapshot {
  state: CoachSessionState;
  requestId?: string;
  pendingText?: string;
  error?: string;
}

export const initialSession: CoachSessionSnapshot = { state: 'idle' };

export type CoachSessionEvent =
  | { type: 'START_LISTENING' }
  | { type: 'STOP_LISTENING' }
  | { type: 'USER_SUBMIT'; id: string; text: string }
  | { type: 'TURN_SUCCESS'; id: string }
  | { type: 'TURN_ERROR'; id: string; message: string }
  | { type: 'START_SPEAKING' }
  | { type: 'STOP_SPEAKING' }
  | { type: 'RESET' };

export function sessionReducer(
  state: CoachSessionSnapshot,
  event: CoachSessionEvent
): CoachSessionSnapshot {
  switch (event.type) {
    case 'START_LISTENING':
      return { state: 'listening' };
    case 'STOP_LISTENING':
      return state.state === 'listening' ? { state: 'idle' } : state;
    case 'USER_SUBMIT':
      if (state.state === 'thinking') return state;
      return { state: 'thinking', requestId: event.id, pendingText: event.text };
    case 'TURN_SUCCESS':
      return state.state === 'thinking' && state.requestId === event.id
        ? { state: 'speaking' }
        : state;
    case 'TURN_ERROR':
      return state.state === 'thinking' && state.requestId === event.id
        ? { state: 'error', requestId: event.id, pendingText: state.pendingText, error: event.message }
        : state;
    case 'START_SPEAKING':
      return { state: 'speaking' };
    case 'STOP_SPEAKING':
      return state.state === 'speaking' ? { state: 'listening' } : state;
    case 'RESET':
      return initialSession;
  }
}

const MAX_HISTORY_TURNS = 40;
const MAX_HISTORY_CHARS = 12_000;

/**
 * Append a turn, then trim from the front to stay within the caps. The newest
 * turn is always kept.
 *
 * Generic so a caller can hang local-only fields off a turn — the session page
 * stores each turn's feedback on the user turn it corrects, so the transcript
 * can show it next to that message. Those fields ride along with the turn;
 * the payload sent upstream is projected back to `{ role, content }` by the
 * caller.
 */
export function appendHistory<T extends CoachTurn>(
  history: T[],
  turn: T,
  maxTurns = MAX_HISTORY_TURNS,
  maxChars = MAX_HISTORY_CHARS
): T[] {
  const candidates = [...history, turn].slice(-maxTurns);
  const kept: T[] = [];
  let total = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const size = candidate.content.length;
    if (kept.length > 0 && total + size > maxChars) break;
    kept.push(candidate);
    total += size;
  }
  return kept.reverse();
}

export function hasUserTurn(history: CoachTurn[]): boolean {
  return history.some((turn) => turn.role === 'user');
}
