import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachApi, rehearsalListLanguage } from './rehearse-api';
import type { CoachScenario } from './rehearse-types';

const scenario: CoachScenario = {
  id: 'standup_update',
  source: 'preset',
  category: 'daily',
  language: 'en-US',
  title: 'Daily Standup',
  description: 'Progress',
  persona: { name: 'Alex', role: 'Tech Lead', accent: null, tone: 'friendly' },
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
    if (path === '/api/rehearse/quota') {
      return {
        limit: 100,
        used: 4,
        remaining: 96,
        resets_at: '2026-09-28T00:00:00+08:00',
        enabled: true,
        llm_configured: true,
      } as T;
    }
    if (path === '/api/rehearse/material/profile') {
      return { kind: 'resume', profile: 'compact profile' } as T;
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

  const controller = new AbortController();
  await api.turn({
    scenario,
    scenario_id: 'standup_update',
    history: [],
    user_text: 'Hello',
    completed_turns: 2,
    mode: 'feedback',
    language: 'zh-CN',
  }, controller.signal);

  assert.equal(calls[0]?.path, '/api/rehearse/quota');
  assert.equal(calls[1]?.path, '/api/rehearse/turn');
  assert.equal(calls[1]?.options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)).user_text, 'Hello');
  assert.equal(JSON.parse(String(calls[1]?.options?.body)).completed_turns, 2);
  assert.equal(calls[1]?.options?.signal, controller.signal);

  const profile = await api.profile({ kind: 'resume', text: 'raw resume' });
  assert.equal(profile.profile, 'compact profile');
  assert.equal(calls[2]?.path, '/api/rehearse/material/profile');
});

test('scenario requests map the UI language to a supported rehearsal language', async () => {
  const paths: string[] = [];
  const bodies: string[] = [];
  const api = createCoachApi(async <T>(path: string, options?: RequestInit) => {
    paths.push(path);
    if (options?.body) bodies.push(String(options.body));
    return [] as T;
  });

  // 界面语言是 'en' 时原样发出去，后端会回 400「language must be one of …」。
  await api.listScenarios('en');
  await api.listScenarios('zh-CN');
  assert.deepEqual(paths, [
    '/api/rehearse/scenarios?language=en-US',
    '/api/rehearse/scenarios?language=zh-CN',
  ]);

  await api.draftScenario('cold call to a client', 'en');
  assert.equal(JSON.parse(bodies[0] ?? '{}').language, 'en-US');
  assert.equal(rehearsalListLanguage('en'), 'en-US');
  assert.equal(rehearsalListLanguage('zh-CN'), 'zh-CN');
});

test('settings sync uses the rehearse settings endpoints', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const api = createCoachApi(async <T>(path: string, options?: RequestInit) => {
    calls.push({ path, options });
    return { theme: 'dark', updated_at: '2026-11-02T00:00:00Z' } as T;
  });

  await api.getSettings();
  await api.putSettings({ theme: 'dark', language: 'en', speech: { provider: 'webspeech' } });

  assert.equal(calls[0]?.path, '/api/rehearse/settings');
  assert.equal(calls[0]?.options?.method, undefined, 'GET 不应带 method');
  assert.equal(calls[1]?.path, '/api/rehearse/settings');
  assert.equal(calls[1]?.options?.method, 'PUT');
  assert.equal(JSON.parse(String(calls[1]?.options?.body)).theme, 'dark');
});
