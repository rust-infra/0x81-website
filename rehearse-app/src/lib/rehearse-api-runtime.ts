import { apiRequest } from './api';
import { createCoachApi } from './rehearse-api';
import { createPodcastClipApi } from './podcast-video';

export const coachApi = createCoachApi(apiRequest);
export const podcastClipApi = createPodcastClipApi(apiRequest);
export const getCoachQuota = coachApi.getQuota;
export const listCoachScenarios = coachApi.listScenarios;
export const draftCoachScenario = coachApi.draftScenario;
export const postCoachTurn = coachApi.turn;
export const postCoachSummary = coachApi.summary;
export const translateInterpretText = coachApi.translateInterpret;
export const extractInterviewText = coachApi.extractInterviewText;
export const postInterviewProfile = coachApi.profile;
export const getSyncedSettings = coachApi.getSettings;
export const putSyncedSettings = coachApi.putSettings;
export const requestPodcastClip = podcastClipApi.request;
export const getPodcastClipStatus = podcastClipApi.status;
