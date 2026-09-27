import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryRecordFromSession } from './coach-history';
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
