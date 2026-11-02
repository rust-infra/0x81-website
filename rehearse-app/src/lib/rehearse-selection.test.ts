import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartCoach,
  groupScenarios,
  shouldShowCoachInitialLoading,
} from './rehearse-selection';
import type { CoachQuotaStatus, CoachScenario } from './rehearse-types';

const scenario = (id: string, category: CoachScenario['category']): CoachScenario => ({
  id,
  source: 'preset',
  category,
  language: 'en-US',
  title: id,
  description: id,
  persona: { name: 'A', role: 'Engineer', accent: null, tone: 'friendly' },
  setting: 'meeting',
  opening_line: 'Hi',
  focus_points: [],
  difficulty: 'core',
  max_turns: 6,
});

const quota = (patch: Partial<CoachQuotaStatus> = {}): CoachQuotaStatus => ({
  limit: 100,
  used: 4,
  remaining: 96,
  resets_at: '2026-09-28T00:00:00+08:00',
  enabled: true,
  llm_configured: true,
  ...patch,
});

test('groups scenarios in the fixed interview, pitch, hard-talk, daily order', () => {
  const groups = groupScenarios([
    scenario('daily', 'daily'),
    scenario('hard', 'hard_talk'),
    scenario('pitch', 'pitch'),
    scenario('interview', 'interview'),
  ]);
  assert.deepEqual(groups.map((group) => group.category), [
    'interview',
    'pitch',
    'hard_talk',
    'daily',
  ]);
});

test('disables start only for exhausted or unavailable states', () => {
  assert.deepEqual(canStartCoach({ quota: quota(), scenario: scenario('a', 'daily') }), {
    ok: true,
  });
  assert.deepEqual(
    canStartCoach({ quota: quota({ remaining: 0 }), scenario: scenario('a', 'daily') }),
    { ok: false, reason: 'quota' }
  );
  assert.deepEqual(
    canStartCoach({
      quota: quota({ llm_configured: false }),
      scenario: scenario('a', 'daily'),
    }),
    { ok: false, reason: 'llm' }
  );
  assert.deepEqual(
    canStartCoach({
      quota: quota({ enabled: false, limit: 100, remaining: null }),
      scenario: scenario('a', 'daily'),
    }),
    { ok: true }
  );
});

test('refocusing the coach screen does not show the full-screen loader again', () => {
  assert.equal(shouldShowCoachInitialLoading(false), true);
  assert.equal(shouldShowCoachInitialLoading(true), false);
});
