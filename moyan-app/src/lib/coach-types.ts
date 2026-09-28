export type CoachLocale = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU' | 'zh-CN';
export type CoachTone = 'friendly' | 'neutral' | 'direct' | 'challenging';
export type CoachSetting = 'meeting' | 'one_on_one' | 'coffee_chat' | 'phone_call';
export type CoachDifficulty = 'easy' | 'core' | 'challenge';
export type CoachCategory = 'daily' | 'engineering' | 'high_stakes';
export type CoachMode = 'feedback' | 'immersion';
export type CoachMood = 'neutral' | 'friendly' | 'curious' | 'encouraging' | 'concerned';
export type InterviewKind = 'resume' | 'job';

export interface CoachScenario {
  id: string;
  source: 'preset' | 'custom';
  category: CoachCategory;
  title: string;
  description: string;
  persona: {
    name: string;
    role: string;
    locale: CoachLocale;
    tone: CoachTone;
  };
  setting: CoachSetting;
  opening_line: string;
  /** 开场白的展示用中文对照（预置场景有，自定义场景暂缺）。 */
  opening_line_zh?: string;
  focus_points: string[];
  difficulty: CoachDifficulty;
  max_turns: number;
}

export interface CoachTurn {
  role: 'coach' | 'user';
  content: string;
}

export interface CoachQuotaStatus {
  limit: number;
  used: number;
  remaining: number | null;
  resets_at: string;
  enabled: boolean;
  llm_configured: boolean;
}

export interface InterviewContext {
  kind: InterviewKind | 'resume_job';
  profile: string;
}

export interface CoachCorrection {
  original: string;
  corrected: string;
  explanation_zh?: string;
}

export interface CoachBetterPhrasing {
  original: string;
  natural: string;
  note_zh?: string;
}

export interface CoachExpression {
  en: string;
  zh: string;
}

export interface CoachFeedback {
  corrections: CoachCorrection[];
  better_phrasing?: CoachBetterPhrasing | null;
  expressions: CoachExpression[];
}

export interface CoachTurnRequest {
  scenario: CoachScenario;
  scenario_id?: string;
  history: CoachTurn[];
  user_text: string;
  coach_mode?: CoachMode;
  locale?: string;
  interview?: InterviewContext;
}

export interface CoachTurnResponse {
  reply: string;
  /** `reply` 的中文翻译，展示在回复下方（后端新加，可能缺失）。 */
  reply_zh?: string;
  mood: CoachMood;
  turn_index: number;
  limit_reached: boolean;
  feedback?: CoachFeedback | null;
  /** 针对本轮的 reply，学习者下一句可以直接照说的表达（后端新加，可能缺失）。 */
  next_lines?: CoachExpression[];
}

export interface CoachSummaryRequest {
  scenario: CoachScenario;
  scenario_id?: string;
  history: CoachTurn[];
  locale?: string;
  interview?: InterviewContext;
}

export interface InterviewFeedback {
  star_structure: string;
  quantified_impact: string;
  weak_spots: string[];
}

export interface CoachSummaryStats {
  turns: number;
  user_chars: number;
  corrections: number;
}

export interface CoachSummaryResponse {
  overall_zh: string;
  overall_en: string;
  strengths: string[];
  improvements: string[];
  expressions: CoachExpression[];
  stats: CoachSummaryStats;
  interview_feedback?: InterviewFeedback | null;
}

export interface InterviewTextResult {
  text: string;
  char_count: number;
  likely_scanned: boolean;
  source: 'document' | 'image';
}

export interface InterviewProfileRequest {
  kind: InterviewKind;
  text: string;
}

export interface InterviewProfileResponse {
  kind: InterviewKind;
  profile: string;
}

export interface CoachHistoryRecord {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  summary: CoachSummaryResponse;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewProfileRecord {
  id: string;
  kind: InterviewKind | 'resume_job';
  profile: string;
  updatedAt: string;
}

export interface CoachPrefs {
  defaultMode: CoachMode;
  accentPreference: CoachLocale;
  autoPlay: boolean;
}
