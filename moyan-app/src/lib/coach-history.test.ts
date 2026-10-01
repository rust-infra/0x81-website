import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScenarioTitle, summaryRecordFromSession } from './coach-history';
import type { CoachSummaryResponse } from './coach-types';

const summary: CoachSummaryResponse = {
  overall_zh: '表达清楚',
  overall_en: 'Clear',
  strengths: ['impact'],
  improvements: [],
  expressions: [],
  stats: { turns: 3, user_chars: 30, corrections: 1 },
};

test('history record stores only the structured summary', () => {
  const record = summaryRecordFromSession(
    {
      scenarioId: 's1',
      scenarioTitle: 'Incident sync',
      durationSeconds: 120,
      startedAt: 1_700_000_000_000,
      rawText: 'Call me at 13800138000',
      imageUri: 'file:///secret.jpg',
    },
    summary
  );
  const json = JSON.stringify(record);
  assert.equal(json.includes('13800138000'), false);
  assert.equal(json.includes('secret.jpg'), false);
  assert.equal(record.summary.stats.turns, 3);
});

test('resolves stored history titles in the current language', () => {
  const title = resolveScenarioTitle(
    'standup_update',
    '每日站会 · 进度同步',
    [
      {
        id: 'standup_update',
        source: 'preset',
        category: 'engineering',
        title: 'Daily Standup',
        description: '',
        persona: { name: 'Alex', role: 'Tech Lead', locale: 'en-US', tone: 'friendly' },
        setting: 'meeting',
        opening_line: '',
        focus_points: [],
        difficulty: 'core',
        max_turns: 10,
      },
    ]
  );
  assert.equal(title, 'Daily Standup');
});
