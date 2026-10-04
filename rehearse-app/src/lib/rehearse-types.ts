/**
 * 演练语言 / TTS 口音的共用枚举（§4.2）。旧类型名 `CoachLocale` 把语言和口音
 * 混成一个概念，改名后两者正交：顶层 `language` 决定说什么语言，`persona.accent`
 * 只影响英文时的音色。枚举里没有裸的 `en`——这些值都是 locale，`en-IN` 表示
 * 「印度英语」，沿用上游的数据形态。
 */
export type CoachLanguage = 'en-US' | 'en-GB' | 'en-IN' | 'en-AU' | 'zh-CN';
export type CoachTone = 'friendly' | 'neutral' | 'direct' | 'challenging';
export type CoachSetting = 'meeting' | 'one_on_one' | 'coffee_chat' | 'phone_call';
export type CoachDifficulty = 'easy' | 'core' | 'challenge';
/** 场景族，按「演练目的」分（§5.1）：旧值 `engineering` / `high_stakes` 已删除。 */
export type CoachCategory = 'interview' | 'pitch' | 'hard_talk' | 'daily';
export type CoachMode = 'feedback' | 'immersion';
export type CoachMood = 'neutral' | 'friendly' | 'curious' | 'encouraging' | 'concerned';
/** 材料种类（原 `InterviewKind`）。v1 只保留 resume / job（§5.3）。 */
export type MaterialKind = 'resume' | 'job';

export interface CoachScenario {
  id: string;
  source: 'preset' | 'custom';
  category: CoachCategory;
  /** 场景的默认演练语言，用户开始前可改（§5.4）。 */
  language: CoachLanguage;
  title: string;
  description: string;
  persona: {
    name: string;
    role: string;
    /** 仅 language 为英文时生效的 TTS 口音；null 表示不指定、用默认音色（§4.2）。 */
    accent?: CoachLanguage | null;
    tone: CoachTone;
  };
  setting: CoachSetting;
  opening_line: string;
  /** 开场白的对照（原 `opening_line_zh`）；中文场景为空——与 `reply_translation` 同一套规则。 */
  opening_line_translation?: string;
  /** 首句对应的推荐表达，由场景目录预置，加载场景时立即展示。 */
  opening_next_lines?: CoachExpression[];
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

/** 挂载的材料（原 `InterviewContext`，§7.6 改名）。 */
export interface MaterialContext {
  kind: MaterialKind | 'resume_job';
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

/**
 * 推荐表达。字段名是 text / translation 而不是 en / zh——中文演练时「本来的语言」
 * 是中文，en/zh 会装错东西（§4.3）。
 */
export interface CoachExpression {
  /** 目标语言的原句（英文演练时是英文，中文演练时是中文）。 */
  text: string;
  /** 对照；中文演练时通常为空——学习者不需要中文→中文。 */
  translation: string;
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
  completed_turns?: number;
  /** 原 `coach_mode`（§7.6 改名），枚举不变。 */
  mode?: CoachMode;
  /** 覆盖场景的默认演练语言，用户可在会话中切（§5.4）。 */
  language?: CoachLanguage;
  /** 挂载的材料（原 `interview`，§7.6 改名）。 */
  material?: MaterialContext;
}

export interface CoachTurnResponse {
  reply: string;
  /** `reply` 的对照翻译（原 `reply_zh`）；中文演练时为 null（§4.3）。 */
  reply_translation: string | null;
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
  /** 决定 strengths / improvements / expressions 用哪种语言写。 */
  language?: CoachLanguage;
  /** 挂载的材料（原 `interview`，§7.6 改名）。 */
  material?: MaterialContext;
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
  kind: MaterialKind;
  text: string;
}

export interface InterviewProfileResponse {
  kind: MaterialKind;
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

/**
 * 会话里的本地轮次：比上行 payload 多几个仅本地字段（消息 id、纠错、命中的推荐语、翻译）。
 * 上行时由 `wireHistory` 裁剪回 `{ role, content }`。
 */
export interface CoachSessionTurn extends CoachTurn {
  /** 稳定的消息标识：列表 key 用它，不能用下标或内容片段。 */
  id?: string;
  feedback?: CoachFeedback | null;
  /** 用户本轮说中了上一轮生成的推荐句时，保留其关联信息。 */
  matchedSuggestion?: CoachExpression;
  /** 该轮的中文翻译（目前只有教练的回复有）。 */
  contentZh?: string;
  /**
   * 这条回复当时给出的「接下来可以怎么说」。
   *
   * 挂在回复自己身上（而不是页面上一份全局的），旧卡才能保留当时的推荐语：
   * 过期的推荐语不该继续当"下一句"用，但回看时它是有价值的。
   */
  nextLines?: CoachExpression[];
}

/**
 * 进行中的会话草稿：只有一份，用于「重挂载/重开 App/误退出后接着练」。
 * 已结束或主动丢弃的会话不保留（见 session.tsx 的清理逻辑）。
 */
export interface CoachSessionDraft {
  scenarioId: string;
  /** 含 id / feedback / 命中的推荐语 / 每条回复的推荐语等仅本地字段。 */
  history: CoachSessionTurn[];
  /** 已显示但还没有收到 AI 回复的用户输入；恢复后先重试，不直接续写。 */
  pendingText?: string;
  turnIndex: number;
  mode: CoachMode;
  startedAt: number;
  savedAt: number;
}

export interface InterviewProfileRecord {
  id: string;
  kind: MaterialKind | 'resume_job';
  profile: string;
  updatedAt: string;
}

export interface CoachPrefs {
  defaultMode: CoachMode;
  /** TTS 口音偏好（原 `CoachLocale`，§4.2）。 */
  accentPreference: CoachLanguage;
  autoPlay: boolean;
}
