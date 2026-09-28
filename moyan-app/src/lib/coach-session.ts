import type { CoachFeedback, CoachTurn } from './coach-types';

/**
 * A transcript turn. `feedback` is local-only: it is attached to the user turn
 * it corrects so the transcript can show it beside that message, and
 * `wireHistory` strips it back off before anything is sent upstream or handed
 * to the summary screen.
 */
export type SessionTurn = CoachTurn & {
  feedback?: CoachFeedback | null;
  /** 该轮的中文翻译（目前只有教练的回复有）。 */
  contentZh?: string;
};

/** The upstream payload is `{ role, content }` only. */
export function wireHistory(history: SessionTurn[]): CoachTurn[] {
  return history.map(({ role, content }) => ({ role, content }));
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
