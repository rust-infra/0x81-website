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
