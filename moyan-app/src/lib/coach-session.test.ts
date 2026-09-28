import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendHistory,
  createTurnRequestGate,
  DRAFT_MAX_AGE_MS,
  filterNextLines,
  hasUserTurn,
  initialSession,
  latestFeedbackTurnIndex,
  latestNextLines,
  matchNextLine,
  prepareHistoryForTurn,
  restorableDraft,
  sessionReducer,
  turnLimitReached,
  wireHistory,
  type SessionTurn,
} from './coach-session';
import type { CoachTurn, CoachSessionDraft } from './coach-types';

function draft(overrides: Partial<CoachSessionDraft> = {}): CoachSessionDraft {
  return {
    scenarioId: 'standup_update',
    history: [
      { role: 'coach', content: 'Morning! How is the feature going?' },
      { role: 'user', content: 'It is on track.' },
    ],
    turnIndex: 1,
    mode: 'feedback',
    startedAt: 1_000,
    savedAt: 5_000,
    ...overrides,
  };
}

test('recommendations stay on the reply that produced them', () => {
  const opening = { en: 'Any blockers?', zh: '有卡点吗？' };
  const followUp = { en: 'I am waiting on review.', zh: '我在等评审。' };
  const history: SessionTurn[] = [
    { id: 'c1', role: 'coach', content: 'Morning!', nextLines: [opening] },
    { id: 'u1', role: 'user', content: 'It is on track.' },
    { id: 'c2', role: 'coach', content: 'Nice. What is next?', nextLines: [followUp] },
  ];

  // 旧卡自己的推荐语没有被"最新一份"覆盖 —— 折叠入口展开后看到的是当时那两句。
  assert.deepEqual(history[0]?.nextLines, [opening]);
  assert.deepEqual(history[2]?.nextLines, [followUp]);
  // 「接下来可以怎么说」指最新一条回复，用户说完还没收到回复时也保持这一条。
  assert.deepEqual(latestNextLines(history), [followUp]);
  assert.deepEqual(latestNextLines([...history, { id: 'u2', role: 'user', content: 'ok' }]), [followUp]);
});

test('latestNextLines tolerates a reply without recommendations', () => {
  assert.deepEqual(latestNextLines([]), []);
  assert.deepEqual(latestNextLines([{ role: 'user', content: 'hi' }]), []);
  assert.deepEqual(
    latestNextLines([
      { role: 'coach', content: 'a', nextLines: [{ en: 'x', zh: 'x' }] },
      { role: 'coach', content: 'b' },
    ]),
    []
  );
});

test('suggestions to a reply are local-only and never sent upstream', () => {
  const history: SessionTurn[] = [
    { role: 'coach', content: 'Morning!', nextLines: [{ en: 'Any blockers?', zh: '有卡点吗？' }] },
  ];
  assert.deepEqual(wireHistory(history), [{ role: 'coach', content: 'Morning!' }]);
});

test('restores a completed draft saved for the same scenario', () => {
  const saved = draft({
    history: [
      { role: 'coach', content: 'Morning! How is the feature going?' },
      { role: 'user', content: 'It is on track.' },
      { role: 'coach', content: 'Nice. Any blockers?' },
    ],
  });
  assert.deepEqual(restorableDraft(saved, 'standup_update', 6_000), saved);
});

test('restores a draft saved for the same scenario', () => {
  const saved = draft();
  assert.deepEqual(restorableDraft(saved, 'standup_update', 6_000), {
    ...saved,
    history: saved.history.slice(0, -1),
    pendingText: 'It is on track.',
  });
});

test('never restores a draft from a different scenario', () => {
  assert.equal(restorableDraft(draft(), 'code_review', 6_000), null);
  assert.equal(restorableDraft(draft(), undefined, 6_000), null);
});

test('expired drafts fall back to a fresh opening line', () => {
  const saved = draft();
  assert.deepEqual(
    restorableDraft(saved, 'standup_update', 5_000 + DRAFT_MAX_AGE_MS),
    {
      ...saved,
      history: saved.history.slice(0, -1),
      pendingText: 'It is on track.',
    }
  );
  assert.equal(
    restorableDraft(saved, 'standup_update', 5_000 + DRAFT_MAX_AGE_MS + 1),
    null
  );
});

test('a draft with only the opening line is not worth restoring', () => {
  const openingOnly = draft({ history: [{ role: 'coach', content: 'Morning!' }] });
  assert.equal(restorableDraft(openingOnly, 'standup_update', 6_000), null);
});

test('restoring a draft strips an unanswered user turn and exposes it for retry', () => {
  const saved = draft({
    history: [
      { id: 'coach-1', role: 'coach', content: 'Morning!' },
      { id: 'user-1', role: 'user', content: 'I am still working on it.' },
    ],
  });
  const restored = restorableDraft(saved, 'standup_update', 6_000);
  assert.deepEqual(restored?.history, [{ id: 'coach-1', role: 'coach', content: 'Morning!' }]);
  assert.equal(restored?.pendingText, 'I am still working on it.');
});

test('restores a first-turn failure when only pending text was saved', () => {
  const saved = draft({
    history: [{ id: 'coach-1', role: 'coach', content: 'Morning!' }],
    pendingText: 'I have not answered yet.',
  });
  assert.deepEqual(restorableDraft(saved, 'standup_update', 6_000), saved);
});

test('malformed drafts never crash the session screen', () => {
  assert.equal(restorableDraft(null, 'standup_update', 6_000), null);
  assert.equal(restorableDraft(undefined, 'standup_update', 6_000), null);
  const corrupt = { ...draft(), savedAt: Number.NaN, history: null } as unknown as CoachSessionDraft;
  assert.equal(restorableDraft(corrupt, 'standup_update', 6_000), null);
});

test('rejects structurally invalid draft metadata', () => {
  assert.equal(
    restorableDraft({ ...draft(), mode: 'broken' as 'feedback' }, 'standup_update', 6_000),
    null
  );
  assert.equal(
    restorableDraft({ ...draft(), turnIndex: Number.NaN }, 'standup_update', 6_000),
    null
  );
  assert.equal(
    restorableDraft({ ...draft(), startedAt: Number.NaN }, 'standup_update', 6_000),
    null
  );
});

test('matches a suggested line immediately, ignoring case and punctuation only', () => {
  const line = { en: "I'll pick up the next ticket.", zh: '我来接下一个工单。' };
  assert.equal(matchNextLine("i'll pick up the next ticket", [line]), line);
  assert.equal(matchNextLine("I'll pick up the ticket", [line]), undefined);
  assert.equal(matchNextLine('', [line]), undefined);
});

test('matched suggestion is attached locally and stripped from API history', () => {
  const suggestion = { en: 'Give me an hour.', zh: '给我一小时。' };
  const history: SessionTurn[] = [{
    id: 'turn-1',
    role: 'user',
    content: 'Give me an hour.',
    matchedSuggestion: suggestion,
  }];
  assert.equal(history[0]?.matchedSuggestion, suggestion);
  assert.deepEqual(wireHistory(history), [{ role: 'user', content: 'Give me an hour.' }]);
});
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

test('turn history reserves room for the latest user turn and the next reply', () => {
  const longHistory: CoachTurn[] = Array.from({ length: 44 }, (_, index) => ({
    role: index % 2 === 0 ? 'coach' : 'user',
    content: `turn ${index} ${'x'.repeat(290)}`,
  }));
  const prepared = prepareHistoryForTurn(longHistory, 'y'.repeat(1_800));
  const total = prepared.reduce((sum, turn) => sum + turn.content.length, 0);

  assert.ok(prepared.length <= 38);
  assert.ok(total + 1_800 + 240 <= 12_000);
  assert.ok(prepared.at(-1)?.content.startsWith('turn 43 '));
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

test('finds the latest feedback turn for expansion', () => {
  const feedback = { corrections: [], expressions: [] };
  const history: SessionTurn[] = [
    { role: 'user', content: 'one', feedback },
    { role: 'coach', content: 'reply' },
    { role: 'user', content: 'two' },
  ];
  assert.equal(latestFeedbackTurnIndex(history), -1);
  assert.equal(latestFeedbackTurnIndex(history.slice(0, 2)), 0);
  assert.equal(latestFeedbackTurnIndex([{ role: 'user', content: 'none' }]), -1);
});

test('filters next lines that duplicate feedback or each other', () => {
  const feedback = {
    corrections: [{ original: 'We finish it', corrected: 'We finished it', explanation_zh: '' }],
    better_phrasing: { original: 'today do UI', natural: 'I am on the UI today', note_zh: '' },
    expressions: [{ en: 'No worries, we have all been there.', zh: '没事，我们都经历过。' }],
  };
  const lines = [
    { en: 'No worries we have all been there', zh: '没事，我们都经历过。' },
    { en: 'I am on the UI today.', zh: '我今天在做 UI。' },
    { en: 'We finished it.', zh: '我们完成了。' },
    { en: 'What is blocking you?', zh: '什么卡住你了？' },
    { en: 'WHAT IS BLOCKING YOU', zh: '重复项' },
  ];

  assert.deepEqual(filterNextLines(lines, feedback, 'Nice work.'), [
    { en: 'What is blocking you?', zh: '什么卡住你了？' },
  ]);
});

test('turn limit is reached at the configured completed-turn count', () => {
  assert.equal(turnLimitReached(0, 10), false);
  assert.equal(turnLimitReached(9, 10), false);
  assert.equal(turnLimitReached(10, 10), true);
  assert.equal(turnLimitReached(11, 10), true);
});

test('turn request gate permits only one active turn at a time', () => {
  const gate = createTurnRequestGate();
  const first = gate.begin();
  assert.ok(first);
  assert.equal(gate.active(), true);
  assert.equal(gate.begin(), null);
  assert.equal(gate.isCurrent(first), true);

  const cancelled = gate.cancel();
  assert.equal(cancelled, first);
  assert.equal(first?.controller.signal.aborted, true);
  assert.equal(gate.active(), false);
  assert.equal(gate.isCurrent(first), false);

  const second = gate.begin();
  assert.ok(second);
  gate.finish(second);
  assert.equal(gate.active(), false);
});

test('appendHistory carries local-only fields on the turn they belong to', () => {
  const feedback = {
    corrections: [{ original: 'We finish it', corrected: 'We finished it' }],
    expressions: [],
  };
  const tagged: SessionTurn = { role: 'user', content: 'We finish it', feedback };
  const next = appendHistory(
    appendHistory<SessionTurn>([], tagged),
    { role: 'coach', content: 'Got it' }
  );
  assert.equal(next[0]?.feedback, feedback);
  assert.equal(next[1]?.feedback, undefined);
});

test('appendHistory keeps a tagged turn even when trimming drops older ones', () => {
  const filler: SessionTurn[] = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'coach' : 'user',
    content: `turn ${index}`,
  }));
  const feedback = { corrections: [], expressions: [] };
  const tagged: SessionTurn = { role: 'user', content: 'latest', feedback };
  const next = appendHistory(
    appendHistory<SessionTurn>(filler, tagged),
    { role: 'coach', content: 'reply' }
  );
  assert.ok(next.length <= 40);
  // The trimmed front must be the old turns, never the one just tagged.
  assert.deepEqual(next.at(-2), tagged);
});

test('wireHistory strips local-only fields from the upstream payload', () => {
  const feedback = { corrections: [], expressions: [] };
  const wire = wireHistory([
    { role: 'user', content: 'We finish it', feedback },
    { role: 'coach', content: 'Got it' },
  ]);
  assert.deepEqual(wire, [
    { role: 'user', content: 'We finish it' },
    { role: 'coach', content: 'Got it' },
  ]);
  assert.deepEqual(Object.keys(wire[0] ?? {}), ['role', 'content']);
});
