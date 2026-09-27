import { apiRequest } from './api';
import { createCoachApi } from './coach-api';

export const coachApi = createCoachApi(apiRequest);
export const getCoachQuota = coachApi.getQuota;
export const listCoachScenarios = coachApi.listScenarios;
export const draftCoachScenario = coachApi.draftScenario;
export const postCoachTurn = coachApi.turn;
export const postCoachSummary = coachApi.summary;
export const extractInterviewText = coachApi.extractInterviewText;
export const postInterviewProfile = coachApi.profile;
