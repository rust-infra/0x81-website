import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachStorage } from './coach-storage';
import type { CoachHistoryRecord, CoachScenario } from './coach-types';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: async (key: string) => {
      data.delete(key);
    },
  };
}

const scenario = (id: string): CoachScenario => ({
  id,
  source: 'custom',
  category: 'engineering',
  title: 'Incident sync',
  description: 'Practice incident updates',
  persona: { name: 'Sam', role: 'SRE', locale: 'en-US', tone: 'direct' },
  setting: 'meeting',
  opening_line: 'What do you know so far?',
  focus_points: ['impact'],
  difficulty: 'challenge',
  max_turns: 12,
});

const history = (id: string, scenarioId: string): CoachHistoryRecord => ({
  id,
  scenarioId,
  scenarioTitle: 'Incident sync',
  summary: {
    overall_zh: '表达清楚',
    overall_en: 'Clear',
    strengths: ['impact'],
    improvements: [],
    expressions: [],
    stats: { turns: 3, user_chars: 30, corrections: 1 },
  },
  durationSeconds: 120,
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
});

test('custom scenario CRUD keeps history when a scenario is deleted', async () => {
  const storage = createCoachStorage(memoryStore());
  await storage.saveCustomScenario(scenario('s1'));
  await storage.saveCustomScenario(scenario('s2'));
  assert.equal((await storage.loadCustomScenarios()).length, 2);

  await storage.saveCoachHistory(history('h1', 's1'));
  await storage.deleteCustomScenario('s1');

  assert.deepEqual((await storage.loadCustomScenarios()).map((item) => item.id), ['s2']);
  assert.equal((await storage.loadCoachHistory()).length, 1);
});

test('history is sorted by updatedAt and can be deleted individually', async () => {
  const storage = createCoachStorage(memoryStore());
  const older = history('older', 's1');
  const newer = { ...history('newer', 's1'), updatedAt: '2026-09-28T00:00:00Z' };
  await storage.saveCoachHistory(older);
  await storage.saveCoachHistory(newer);

  assert.deepEqual((await storage.loadCoachHistory()).map((item) => item.id), ['newer', 'older']);
  await storage.deleteCoachHistory('newer');
  assert.deepEqual((await storage.loadCoachHistory()).map((item) => item.id), ['older']);
});

test('interview profiles are structured and contain no raw source field', async () => {
  const storage = createCoachStorage(memoryStore());
  await storage.saveInterviewProfile({
    id: 'p1',
    kind: 'resume',
    profile: '5 years backend, payments',
    updatedAt: '2026-09-27T00:00:00Z',
  });

  const loaded = await storage.loadInterviewProfiles();
  assert.equal(loaded[0]?.profile, '5 years backend, payments');
  assert.equal('rawText' in (loaded[0] as object), false);
  assert.equal('imageUri' in (loaded[0] as object), false);
});

test('corrupt JSON falls back without throwing', async () => {
  const store = memoryStore();
  await store.setItem('coach_custom_scenarios_v1', '{broken');
  const storage = createCoachStorage(store);
  assert.deepEqual(await storage.loadCustomScenarios(), []);
});

test('session draft round-trips and is cleared when the session ends', async () => {
  const storage = createCoachStorage(memoryStore());
  assert.equal(await storage.loadSessionDraft(), null);

  await storage.saveSessionDraft({
    scenarioId: 'standup_update',
    history: [
      { role: 'coach', content: 'Morning!', nextLines: [{ en: 'Any blockers?', zh: '有卡点吗？' }] },
      { role: 'user', content: 'It is on track.', id: 'turn_1' },
    ],
    turnIndex: 1,
    mode: 'feedback',
    startedAt: 1_000,
    savedAt: 5_000,
  });

  const loaded = await storage.loadSessionDraft();
  assert.equal(loaded?.scenarioId, 'standup_update');
  assert.equal(loaded?.history.length, 2);
  // 仅本地字段要跟着草稿一起留存，恢复后气泡/纠错/推荐语才能原样回来。
  assert.equal((loaded?.history[1] as { id?: string })?.id, 'turn_1');
  assert.equal(loaded?.history[0]?.nextLines?.[0]?.en, 'Any blockers?');

  await storage.clearSessionDraft();
  assert.equal(await storage.loadSessionDraft(), null);
});

test('a corrupt session draft reads as null instead of breaking restore', async () => {
  const store = memoryStore();
  await store.setItem('coach_session_draft_v1', '{broken');
  const storage = createCoachStorage(store);
  assert.equal(await storage.loadSessionDraft(), null);
});

test('session draft clears are serialized after pending saves', async () => {
  const events: string[] = [];
  let releaseSave: (() => void) | undefined;
  const store = {
    getItem: async () => null,
    setItem: async (_key: string, _value: string) => {
      events.push('save:start');
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      events.push('save:end');
    },
    removeItem: async () => {
      events.push('clear');
    },
  };
  const storage = createCoachStorage(store);

  const save = storage.saveSessionDraft({
    scenarioId: 'standup_update',
    history: [{ role: 'user', content: 'hello' }],
    turnIndex: 1,
    mode: 'feedback',
    startedAt: 1,
    savedAt: 2,
  });
  await Promise.resolve();
  const clear = storage.clearSessionDraft();

  assert.deepEqual(events, ['save:start']);
  releaseSave?.();
  await Promise.all([save, clear]);
  assert.deepEqual(events, ['save:start', 'save:end', 'clear']);
});
