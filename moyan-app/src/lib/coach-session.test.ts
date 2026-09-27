import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, hasUserTurn, initialSession, sessionReducer } from './coach-session';
import type { CoachTurn } from './coach-types';

test('ignores a second submit while thinking', () => {
  let state = sessionReducer(initialSession, {
    type: 'USER_SUBMIT',
    id: 'a',
    text: 'hello',
  });
  state = sessionReducer(state, { type: 'USER_SUBMIT', id: 'b', text: 'again' });
  assert.equal(state.state, 'thinking');
  assert.equal(state.requestId, 'a');
});

test('drops stale response after reset', () => {
  let state = sessionReducer(initialSession, {
    type: 'USER_SUBMIT',
    id: 'a',
    text: 'hello',
  });
  state = sessionReducer(state, { type: 'RESET' });
  state = sessionReducer(state, { type: 'TURN_SUCCESS', id: 'a' });
  assert.deepEqual(state, initialSession);
});

test('history keeps the newest turns inside the total character budget', () => {
  const history: CoachTurn[] = Array.from({ length: 45 }, (_, index) => ({
    role: index % 2 === 0 ? 'coach' : 'user',
    content: index === 44 ? 'x'.repeat(11_900) : `turn ${index}`,
  }));
  const next = appendHistory(history, { role: 'user', content: 'latest' });
  assert.ok(next.length <= 40);
  const total = next.reduce((sum, turn) => sum + turn.content.length, 0);
  assert.ok(total <= 12_000);
  assert.equal(next.at(-1)?.content, 'latest');
});

test('detects whether a session has a user turn', () => {
  assert.equal(hasUserTurn([{ role: 'coach', content: 'Hello' }]), false);
  assert.equal(
    hasUserTurn([
      { role: 'coach', content: 'Hello' },
      { role: 'user', content: 'Hi' },
    ]),
    true
  );
});
