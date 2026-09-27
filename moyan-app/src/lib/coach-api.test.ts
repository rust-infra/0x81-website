import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachApi } from './coach-api';
import type { CoachScenario } from './coach-types';

const scenario: CoachScenario = {
  id: 'standup_update',
  source: 'preset',
  category: 'engineering',
  title: 'Daily Standup',
  description: 'Progress',
  persona: { name: 'Alex', role: 'Tech Lead', locale: 'en-US', tone: 'friendly' },
  setting: 'meeting',
  opening_line: 'Morning!',
  focus_points: ['progress'],
  difficulty: 'core',
  max_turns: 10,
};

test('coach api uses the exact quota and turn paths', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const api = createCoachApi(async <T>(path: string, options?: RequestInit) => {
    calls.push({ path, options });
    if (path === '/api/coach/quota') {
      return {
        limit: 100,
        used: 4,
        remaining: 96,
        resets_at: '2026-09-28T00:00:00+08:00',
        enabled: true,
        llm_configured: true,
      } as T;
    }
    return {
      reply: 'Nice!',
      mood: 'friendly',
      turn_index: 1,
      limit_reached: false,
      feedback: null,
    } as T;
  });

  const quota = await api.getQuota();
  assert.equal(quota.remaining, 96);

  await api.turn({
    scenario,
    scenario_id: 'standup_update',
    history: [],
    user_text: 'Hello',
    coach_mode: 'feedback',
    locale: 'zh-CN',
  });

  assert.equal(calls[0]?.path, '/api/coach/quota');
  assert.equal(calls[1]?.path, '/api/coach/turn');
  assert.equal(calls[1]?.options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)).user_text, 'Hello');
});
