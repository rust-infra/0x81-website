import type { ApiRequest } from './api-client';
import type {
  CoachQuotaStatus,
  CoachScenario,
  CoachSummaryRequest,
  CoachSummaryResponse,
  CoachTurnRequest,
  CoachTurnResponse,
  InterviewProfileRequest,
  InterviewProfileResponse,
  InterviewTextResult,
} from './rehearse-types';

export interface CoachApi {
  getQuota: () => Promise<CoachQuotaStatus>;
  listScenarios: (locale: string) => Promise<CoachScenario[]>;
  draftScenario: (description: string, locale: string) => Promise<CoachScenario>;
  turn: (body: CoachTurnRequest, signal?: AbortSignal) => Promise<CoachTurnResponse>;
  summary: (body: CoachSummaryRequest) => Promise<CoachSummaryResponse>;
  extractInterviewText: (body: FormData) => Promise<InterviewTextResult>;
  profile: (body: InterviewProfileRequest) => Promise<InterviewProfileResponse>;
}

export function createCoachApi(request: ApiRequest): CoachApi {
  return {
    getQuota: () => request<CoachQuotaStatus>('/api/rehearse/quota'),
    listScenarios: (locale) =>
      request<CoachScenario[]>(
        `/api/rehearse/scenarios?locale=${encodeURIComponent(locale)}`
      ),
    draftScenario: (description, locale) =>
      request<CoachScenario>('/api/rehearse/scenario/draft', {
        method: 'POST',
        body: JSON.stringify({ description, locale }),
      }),
    turn: (body, signal) =>
      request<CoachTurnResponse>('/api/rehearse/turn', {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      }),
    summary: (body) =>
      request<CoachSummaryResponse>('/api/rehearse/summary', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    extractInterviewText: (body) =>
      request<InterviewTextResult>('/api/rehearse/material/text', {
        method: 'POST',
        body,
      }),
    profile: (body) =>
      request<InterviewProfileResponse>('/api/rehearse/material/profile', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };
}
