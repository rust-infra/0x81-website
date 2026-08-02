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
}

export interface TypeStats {
  recent_sessions: TypeSession[];
  daily_trend: TypeDailyTrend[];
  mastery: TypeMastery[];
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
