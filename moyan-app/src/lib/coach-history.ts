import type { CoachHistoryRecord, CoachScenario, CoachSummaryResponse } from './coach-types';

export function summaryRecordFromSession(
  session: {
    scenarioId: string;
    scenarioTitle: string;
    durationSeconds: number;
    startedAt: number;
    rawText?: string;
    imageUri?: string;
    documentUri?: string;
    [key: string]: unknown;
  },
  summary: CoachSummaryResponse,
  id = `history_${session.startedAt}_${Math.random().toString(36).slice(2, 8)}`
): CoachHistoryRecord {
  const createdAt = new Date(session.startedAt).toISOString();
  return {
    id,
    scenarioId: session.scenarioId,
    scenarioTitle: session.scenarioTitle,
    summary,
    durationSeconds: session.durationSeconds,
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveScenarioTitle(
  scenarioId: string,
  storedTitle: string,
  scenarios: CoachScenario[]
): string {
  return scenarios.find((scenario) => scenario.id === scenarioId)?.title ?? storedTitle;
}
