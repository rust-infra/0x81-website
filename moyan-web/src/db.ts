import Dexie, { type Table } from 'dexie';

// SRS 算法相关字段
export interface SRSData {
  interval: number;      // 间隔天数
  repetitions: number;   // 连续成功次数
  easeFactor: number;    // 容易度因子 (初始 2.5)
  dueDate: Date;         // 下次复习日期
  lastReviewed?: Date;   // 上次复习日期
  status: 'new' | 'learning' | 'review' | 'relearning'; // 卡片状态
}

export interface Deck {
  id?: number;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  cardCount: number;
  color?: string;
}

export interface Card {
  id?: number;
  deckId: number;
  front: string;         // 正面 (问题/单词)
  back: string;          // 背面 (答案/释义)
  example?: string;      // 例句
  pronunciation?: string;// 音标
  tags: string[];
  srs: SRSData;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewLog {
  id?: number;
  cardId: number;
  deckId: number;
  rating: 'again' | 'hard' | 'good' | 'easy';
  timeTaken: number;     // 耗时(ms)
  reviewedAt: Date;
  oldInterval: number;
  newInterval: number;
  oldEaseFactor: number;
  newEaseFactor: number;
}

export interface AppSettings {
  id?: number;
  key: string;
  value: any;
}

export interface TypeHistory {
  id?: number;
  cardId: number;
  cardFront: string;
  mode: 'word' | 'sentence';
  correctChars: number;
  wrongChars: number;
  accuracy: number;
  wpm: number;
  durationMs: number;
  createdAt: Date;
}

export interface StudyHistory {
  id?: number;
  cardId: number;
  cardFront: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  timeTakenMs: number;      // 总耗时（从展示卡片到评级）
  flipDelayMs: number;      // 翻转前思考时间
  studyMode: 'en-zh' | 'zh-en';
  createdAt: Date;
}

export class MoyanDB extends Dexie {
  decks!: Table<Deck, number>;
  cards!: Table<Card, number>;
  reviewLogs!: Table<ReviewLog, number>;
  settings!: Table<AppSettings, number>;
  typeHistory!: Table<TypeHistory, number>;
  studyHistory!: Table<StudyHistory, number>;

  constructor() {
    super('MoyanDB');
    this.version(10).stores({
      decks: '++id, name, createdAt, updatedAt',
      cards: '++id, deckId, [srs.status+srs.dueDate], createdAt',
      reviewLogs: '++id, cardId, deckId, reviewedAt',
      settings: '++id, key',
      typeHistory: '++id, cardId, mode, createdAt',
      studyHistory: '++id, cardId, rating, createdAt',
    });
  }
}

export const db = new MoyanDB();


// 获取今日需要复习的卡片
export async function getDueCards(deckId?: number): Promise<Card[]> {
  const now = new Date();
  if (deckId) {
    return db.cards.where('deckId').equals(deckId).filter(c => c.srs.dueDate <= now).toArray();
  }
  return db.cards.filter(c => c.srs.dueDate <= now).toArray();
}

// 获取学习统计
export async function getStudyStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayReviews = await db.reviewLogs
    .where('reviewedAt')
    .between(today, tomorrow)
    .toArray();

  const totalCards = await db.cards.count();
  const newCards = await db.cards.filter(c => c.srs.status === 'new').count();
  const dueCards = (await getDueCards()).length;

  return {
    todayReviewed: todayReviews.length,
    totalCards,
    newCards,
    dueCards,
    todayAccuracy: todayReviews.length > 0
      ? (todayReviews.filter(r => r.rating === 'good' || r.rating === 'easy').length / todayReviews.length * 100).toFixed(1)
      : '0',
  };
}
