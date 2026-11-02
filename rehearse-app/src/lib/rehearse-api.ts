import type { ApiRequest } from './api-client';
import type { Lang } from './translations';
import type {
  CoachLanguage,
  CoachQuotaStatus,
  CoachScenario,
  CoachSummaryRequest,
  CoachSummaryResponse,
  CoachTurnRequest,
  CoachTurnResponse,
  InterviewProfileRequest,
  InterviewProfileResponse,
  InterviewTextResult,
  SyncedUserSettings,
} from './rehearse-types';

/**
 * 界面语言不是演练语言。界面上只有中文和英文两档，而场景接口只认
 * `zh-CN / en-US / en-GB / en-IN / en-AU`，把 `'en'` 原样发过去会
 * 400「language must be one of …」。界面是英文时取美式英语作为列表语言，
 * 单条场景自己的 `language` 仍然决定这一轮怎么练（口音与界面解耦）。
 */
export function rehearsalListLanguage(lang: Lang): CoachLanguage {
  return lang === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export interface CoachApi {
  getQuota: () => Promise<CoachQuotaStatus>;
  listScenarios: (language: Lang) => Promise<CoachScenario[]>;
  draftScenario: (description: string, language: Lang) => Promise<CoachScenario>;
  turn: (body: CoachTurnRequest, signal?: AbortSignal) => Promise<CoachTurnResponse>;
  summary: (body: CoachSummaryRequest) => Promise<CoachSummaryResponse>;
  extractInterviewText: (body: FormData) => Promise<InterviewTextResult>;
  profile: (body: InterviewProfileRequest) => Promise<InterviewProfileResponse>;
  getSettings: () => Promise<SyncedUserSettings>;
  putSettings: (doc: SyncedUserSettings) => Promise<SyncedUserSettings>;
}

export function createCoachApi(request: ApiRequest): CoachApi {
  return {
    getQuota: () => request<CoachQuotaStatus>('/api/rehearse/quota'),
    listScenarios: (language) =>
      request<CoachScenario[]>(
        `/api/rehearse/scenarios?language=${encodeURIComponent(rehearsalListLanguage(language))}`
      ),
    draftScenario: (description, language) =>
      request<CoachScenario>('/api/rehearse/scenario/draft', {
        method: 'POST',
        body: JSON.stringify({ description, language: rehearsalListLanguage(language) }),
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
    // 用户设置文档：全量读写，服务端只校验形状（rehearse-backend/internal/httpapi/user_settings.go）。
    getSettings: () => request<SyncedUserSettings>('/api/rehearse/settings'),
    putSettings: (doc) =>
      request<SyncedUserSettings>('/api/rehearse/settings', {
        method: 'PUT',
        body: JSON.stringify(doc),
      }),
  };
}
