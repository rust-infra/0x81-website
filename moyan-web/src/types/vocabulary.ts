export interface CardExample {
  id: string;
  sentence_en: string;
  translation_zh: string;
}

export interface Deck {
  id: string;
  owner_user_id: string;
  source_key: string | null;
  name: string;
  description: string;
  color: string | null;
  version: number;
  sort_order: number;
  is_active: boolean;
  card_count: number;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  pronunciation: string | null;
  tags: string[];
  examples: CardExample[];
  created_at: string;
  updated_at: string;
}

export interface CardProgress {
  id: string;
  owner_user_id: string;
  card_id: string;
  srs_status: "new" | "learning" | "review" | "relearning" | string;
  interval: number;
  repetitions: number;
  ease_factor: number;
  due_date: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyCard {
  card: Card;
  progress: CardProgress | null;
}

export interface StudyQueue {
  cards: StudyCard[];
  due_count: number;
  new_count: number;
  total_cards: number;
  today_reviewed: number;
}

export interface ReviewLog {
  id: string;
  owner_user_id: string;
  card_id: string;
  deck_id: string;
  rating: string;
  time_ms: number | null;
  reviewed_at: string;
}

export interface CreateDeckRequest {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateDeckRequest {
  name?: string;
  description?: string;
  color?: string;
}

export interface CardExampleInput {
  id?: string;
  sentence_en: string;
  translation_zh: string;
}

export interface CreateCardRequest {
  front: string;
  back: string;
  pronunciation?: string;
  tags?: string[];
  examples?: CardExampleInput[];
}

export interface UpdateCardRequest {
  front?: string;
  back?: string;
  pronunciation?: string | null;
  tags?: string[];
  examples?: CardExampleInput[];
}

export interface UpsertCardProgressRequest {
  srs_status: string;
  interval: number;
  repetitions: number;
  ease_factor: number;
  due_date: string;
  last_reviewed_at?: string | null;
}

export interface CreateReviewLogRequest {
  card_id: string;
  deck_id: string;
  rating: string;
  time_ms?: number;
  reviewed_at?: string;
}

export type TypeMode = "word" | "sentence";

export interface TypeEntry {
  id: string;
  card_id: string;
  deck_id: string;
  mode: TypeMode;
  correct_chars: number;
  wrong_chars: number;
  accuracy: number;
  wpm: number;
  duration_ms: number;
  egregious: boolean;
  created_at: string;
}

export interface TypeSession {
  id: string;
  deck_id: string | null;
  deck_name: string | null;
  mode: TypeMode;
  total_cards: number;
  completed: number;
  skipped: number;
  egregious_count: number;
  avg_accuracy: number;
  avg_wpm: number;
  duration_ms: number;
  created_at: string;
}

export interface TypeSyncRequest {
  session: TypeSession;
  entries: TypeEntry[];
}

export interface TypeSyncResponse {
  saved_session: boolean;
  saved_entries: number;
}

export interface TypeDailyTrend {
  date: string;
  sessions: number;
  avg_accuracy: number;
  avg_wpm: number;
}

export interface TypeMastery {
  card_id: string;
  accuracy: number;
  egregious_count: number;
  score: number;
  last_practiced_at: string | null;
  /** 卡片正面词；卡片被删除时为 null */
  front?: string | null;
  /** 累计字符数：都为 0 说明只有"跳过"记录，accuracy 1.0 并非"练对了" */
  correct_chars?: number;
  wrong_chars?: number;
}

/** 某个词库的历史打字准确率（词库列表徽章用） */
export interface TypeDeckAccuracy {
  deck_id: string;
  accuracy: number;
  correct_chars: number;
  wrong_chars: number;
  entries: number;
}

export interface TypeStats {
  recent_sessions: TypeSession[];
  daily_trend: TypeDailyTrend[];
  mastery: TypeMastery[];
  deck_accuracy?: TypeDeckAccuracy[];
}

/** 错题本里的一个词（打错过、尚未再练到 100% 准确率） */
export interface TypeMistake {
  card_id: string;
  deck_id: string;
  /** 进入错题本的次数 */
  wrong_count: number;
  created_at: string;
  last_wrong_at: string;
  card: Card;
  progress: CardProgress | null;
  /** 该词历史累计（来自打字记录） */
  correct_chars: number;
  wrong_chars: number;
  accuracy: number;
  egregious_count: number;
}

export interface TypeMistakeAdd {
  card_id: string;
  deck_id: string;
  /** 本次打错那条记录的 id：服务端用它去重，重试同一批不会重复计数 */
  entry_id?: string | null;
}

export interface TypeMistakeSyncRequest {
  add: TypeMistakeAdd[];
  /** 本批打到 100% 准确率的词（从错题本移出） */
  remove: string[];
}

export interface TypeMistakeSyncResponse {
  added: number;
  removed: number;
  total: number;
  /** 因 entry_id 已记过而没重复计数的条数（幂等生效的证据） */
  deduplicated?: number;
}

export interface TypeMistakeList {
  items: TypeMistake[];
}

export interface TypedCharState {
  state: "correct" | "wrong";
  input_char?: string | null;
}

export interface TypeResume {
  deck_id: string;
  deck_name: string | null;
  mode: TypeMode;
  card_id: string;
  target: string;
  char_index: number;
  correct_chars: number;
  wrong_chars: number;
  typed_states: TypedCharState[];
  updated_at: string;
}
