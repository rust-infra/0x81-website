import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoachScenario, scenarioFromTemplate } from './coach-validation';
import type { CoachScenario } from './coach-types';

const base = (): CoachScenario => ({
  id: 'custom_x',
  source: 'custom',
  category: 'engineering',
  title: 'Incident sync',
  description: 'Practice updates',
  persona: { name: 'Sam', role: 'SRE', locale: 'en-US', tone: 'direct' },
  setting: 'meeting',
  opening_line: 'What happened?',
  focus_points: ['impact', 'ETA'],
  difficulty: 'challenge',
  max_turns: 50,
});

test('normalizes source and clamps turns into range', () => {
  const result = normalizeCoachScenario({ ...base(), source: 'preset' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.scenario.source, 'custom');
    assert.equal(result.scenario.max_turns, 20);
  }
});

test('rejects overlong fields and too many focus points', () => {
  const result = normalizeCoachScenario({
    ...base(),
    title: 'x'.repeat(61),
    focus_points: ['1', '2', '3', '4', '5', '6'],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.title);
    assert.ok(result.errors.focus_points);
  }
});

test('templates are valid custom scenarios', () => {
  for (const id of ['incident_sync', 'scope_deadline', 'cross_timezone_handoff', 'growth_1on1']) {
    const template = scenarioFromTemplate(id);
    const templateEn = scenarioFromTemplate(id, 'en');
    assert.equal(template?.source, 'custom');
    assert.equal(normalizeCoachScenario(template as CoachScenario).ok, true);
    assert.equal(normalizeCoachScenario(templateEn as CoachScenario).ok, true);
    assert.doesNotMatch(templateEn?.title ?? '', /[\u4e00-\u9fff]/);
  }
});
