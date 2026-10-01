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

test('every template carries a Chinese line for its English opening', () => {
  for (const id of ['incident_sync', 'scope_deadline', 'cross_timezone_handoff', 'growth_1on1']) {
    // 中英两套模板都要有，界面语言不决定是否显示译文
    for (const lang of ['zh-CN', 'en'] as const) {
      const template = scenarioFromTemplate(id, lang);
      assert.ok(template?.opening_line_zh, `${id}/${lang} 缺开场白中文`);
      // 英文开场白本身保持英文，译文只作对照
      assert.doesNotMatch(template?.opening_line ?? '', /[\u4e00-\u9fff]/);
    }
  }
});

test('normalizing a scenario keeps its opening translation', () => {
  const template = scenarioFromTemplate('incident_sync') as CoachScenario;
  const result = normalizeCoachScenario(template);
  assert.equal(result.ok, true);
  assert.equal(
    result.ok ? result.scenario.opening_line_zh : null,
    template.opening_line_zh
  );
});
