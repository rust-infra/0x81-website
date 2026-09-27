import type { CoachTurn } from './coach-types';

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

export function appendHistory(
  history: CoachTurn[],
  turn: CoachTurn,
  maxTurns = MAX_HISTORY_TURNS,
  maxChars = MAX_HISTORY_CHARS
): CoachTurn[] {
  const candidates = [...history, turn].slice(-maxTurns);
  const kept: CoachTurn[] = [];
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
