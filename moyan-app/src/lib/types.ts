// 共享类型定义（与 moyan-web 保持一致）

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
  srs_status: 'new' | 'learning' | 'review' | 'relearning' | string;
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

export interface CreateReviewLogRequest {
  card_id: string;
  deck_id: string;
  rating: string;
  time_ms?: number;
  reviewed_at?: string;
}

export interface UpsertCardProgressRequest {
  srs_status: string;
  interval: number;
  repetitions: number;
  ease_factor: number;
  due_date: string;
  last_reviewed_at?: string | null;
}

/** SRS 状态（与 srs.ts 算法共用） */
export interface SRSData {
  interval: number;
  repetitions: number;
  easeFactor: number;
  dueDate: Date;
  lastReviewed?: Date;
  status: 'new' | 'learning' | 'review' | 'relearning';
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  provider: string;
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

export interface UserSettings {
  theme?: string;
  language?: string;
  speech_provider?: string;
  speech_voice?: string;
  speech_zh_voice?: string;
  speech_model?: string;
  speech_speed?: number;
  auto_play?: boolean;
}

export interface DailyTrendPoint {
  date: string;
  reviews: number;
  accuracy: number;
}

export interface TimedCaption {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface PodcastResolved {
  video_id: string;
  title: string;
  channel: string | null;
  duration_sec: number | null;
  thumbnail: string | null;
  audio_url: string;
  captions: TimedCaption[];
}

export interface PodcastTranslate {
  video_id: string;
  translations: string[];
}

export interface AppConfig {
  podcast: {
    app_enabled: boolean;
    web_enabled: boolean;
    youtube_api_key: string;
  };
}
