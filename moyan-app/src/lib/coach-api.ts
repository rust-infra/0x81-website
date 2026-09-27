import type { ApiRequest } from './api-client';
import type {
  CoachQuotaStatus,
  CoachScenario,
  CoachSummaryRequest,
  CoachSummaryResponse,
  CoachTurnRequest,
  CoachTurnResponse,
} from './coach-types';

export interface CoachApi {
  getQuota: () => Promise<CoachQuotaStatus>;
  listScenarios: (locale: string) => Promise<CoachScenario[]>;
  draftScenario: (description: string, locale: string) => Promise<CoachScenario>;
  turn: (body: CoachTurnRequest) => Promise<CoachTurnResponse>;
  summary: (body: CoachSummaryRequest) => Promise<CoachSummaryResponse>;
}

export function createCoachApi(request: ApiRequest): CoachApi {
  return {
    getQuota: () => request<CoachQuotaStatus>('/api/coach/quota'),
    listScenarios: (locale) =>
      request<CoachScenario[]>(
        `/api/coach/scenarios?locale=${encodeURIComponent(locale)}`
      ),
    draftScenario: (description, locale) =>
      request<CoachScenario>('/api/coach/scenario/draft', {
        method: 'POST',
        body: JSON.stringify({ description, locale }),
      }),
    turn: (body) =>
      request<CoachTurnResponse>('/api/coach/turn', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    summary: (body) =>
      request<CoachSummaryResponse>('/api/coach/summary', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}

async function defaultRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const { apiRequest } = await import('./api.js');
  return apiRequest<T>(path, options);
}

export const getCoachQuota = () =>
  defaultRequest<CoachQuotaStatus>('/api/coach/quota');
export const listCoachScenarios = (locale: string) =>
  defaultRequest<CoachScenario[]>(
    `/api/coach/scenarios?locale=${encodeURIComponent(locale)}`
  );
export const draftCoachScenario = (description: string, locale: string) =>
  defaultRequest<CoachScenario>('/api/coach/scenario/draft', {
    method: 'POST',
    body: JSON.stringify({ description, locale }),
  });
export const postCoachTurn = (body: CoachTurnRequest) =>
  defaultRequest<CoachTurnResponse>('/api/coach/turn', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const postCoachSummary = (body: CoachSummaryRequest) =>
  defaultRequest<CoachSummaryResponse>('/api/coach/summary', {
    method: 'POST',
    body: JSON.stringify(body),
  });
