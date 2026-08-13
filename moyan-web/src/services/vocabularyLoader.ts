import { db } from '../db';
import type { Card } from '../db';
import { hasVocabularyBackend } from './vocabularyApi';

interface VocabularyData {
  decks: {
    name: string;
    description: string;
    color: string;
  }[];
  cards: {
    deckIndex: number;
    front: string;
    back: string;
    example: string;
    pronunciation: string;
    tags: string[];
  }[];
}

let cachedData: VocabularyData | null = null;

export async function loadVocabularyData(): Promise<VocabularyData> {
  if (cachedData) return cachedData;

  try {
    const response = await fetch('/vocabulary.json');
    if (!response.ok) {
      throw new Error(`Failed to load vocabulary: ${response.status}`);
    }
    cachedData = await response.json();
    return cachedData!;
  } catch (err) {
    console.error('Failed to load vocabulary.json:', err);
    // Return empty data as fallback
    return { decks: [], cards: [] };
  }
}

export async function initVocabularyDecks(): Promise<void> {
  // Server-authoritative mode: system decks come from the API after login.
  if (hasVocabularyBackend()) {
    return;
  }

  const data = await loadVocabularyData();
  if (data.decks.length === 0) return;

  const vocabDeckNames = new Set(data.decks.map(d => d.name));
  const existingDecks = await db.decks.toArray();

  // 检查是否有旧的30天结构（第1天~第30天）
  const hasOld30Day = existingDecks.some(d => d.name.match(/^第\d+天$/));

  if (hasOld30Day) {
    // 迁移旧数据：删除旧的30个"第X天"牌组及其卡片，保留其他牌组和复习记录
    for (const deck of existingDecks) {
      if (deck.name.match(/^第\d+天$/)) {
        await db.cards.where('deckId').equals(deck.id!).delete();
        await db.decks.delete(deck.id!);
      }
    }
    // 如果已有"30天词汇"，也删除它以便重新导入
    const existing30Day = existingDecks.find(d => d.name === '30天词汇');
    if (existing30Day) {
      await db.cards.where('deckId').equals(existing30Day.id!).delete();
      await db.decks.delete(existing30Day.id!);
    }
  }

  // 2026-08 词库同步：旧版内置词库（13 个中文技术词库）已被线上系统词库
  // （4 个 YouTube 采集 deck）取代。只移除这批旧种子词库及其卡片，
  // 保留用户自建词库与复习记录，避免静默清空用户数据。
  const OLD_SEEDED_DECK_NAMES = new Set([
    '编程基础词汇', 'Go语言核心', 'Rust语言核心', '数据结构与算法',
    '系统设计面试', '数据库与缓存', '网络与协议', 'DevOps与云原生',
    '代码审查与协作', '远程工作沟通', '技术面试表达', '软技能与职业发展',
    '30天词汇',
  ]);
  for (const deck of existingDecks) {
    if (OLD_SEEDED_DECK_NAMES.has(deck.name) && !vocabDeckNames.has(deck.name)) {
      await db.cards.where('deckId').equals(deck.id!).delete();
      await db.decks.delete(deck.id!);
    }
  }

  // 创建不存在的牌组
  const deckIdMap: number[] = [];
  for (let i = 0; i < data.decks.length; i++) {
    const deckDef = data.decks[i];
    const existing = await db.decks.where('name').equals(deckDef.name).first();

    if (existing) {
      deckIdMap[i] = existing.id!;
    } else {
      const id = await db.decks.add({
        name: deckDef.name,
        description: deckDef.description,
        createdAt: new Date(),
        updatedAt: new Date(),
        cardCount: 0,
        color: deckDef.color,
      });
      deckIdMap[i] = id;
    }
  }

  // 检查是否已有卡片（用户自建词库的卡片保留，新种子卡片按 front 去重补充）
  const hasCards = (await db.cards.count()) > 0;
  if (hasCards) {
    // 只补充新卡片
    const existingFronts = new Set((await db.cards.toArray()).map(c => `${c.deckId}:${c.front}`));
    const newCards: Omit<Card, 'id'>[] = [];

    for (const cardDef of data.cards) {
      const deckId = deckIdMap[cardDef.deckIndex];
      if (!deckId) continue;
      const key = `${deckId}:${cardDef.front}`;
      if (!existingFronts.has(key)) {
        newCards.push({
          deckId,
          front: cardDef.front,
          back: cardDef.back,
          example: cardDef.example,
          pronunciation: cardDef.pronunciation,
          tags: cardDef.tags,
          srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueDate: new Date(), status: 'new' },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    if (newCards.length > 0) {
      await db.cards.bulkAdd(newCards);
    }
  } else {
    // 首次加载或清空后重新加载
    const cardsToAdd: Omit<Card, 'id'>[] = [];
    for (const cardDef of data.cards) {
      const deckId = deckIdMap[cardDef.deckIndex];
      if (!deckId) continue;
      cardsToAdd.push({
        deckId,
        front: cardDef.front,
        back: cardDef.back,
        example: cardDef.example,
        pronunciation: cardDef.pronunciation,
        tags: cardDef.tags,
        srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueDate: new Date(), status: 'new' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    if (cardsToAdd.length > 0) {
      await db.cards.bulkAdd(cardsToAdd);
    }
  }

  // 更新牌组卡片数
  for (const deck of await db.decks.toArray()) {
    const count = await db.cards.where('deckId').equals(deck.id!).count();
    await db.decks.update(deck.id!, { cardCount: count });
  }
}

// 重新加载词库（用于更新JSON后刷新）
export async function reloadVocabulary(): Promise<{ decksAdded: number; cardsAdded: number }> {
  cachedData = null;

  // 删除现有词库卡片
  const data = await loadVocabularyData();
  const existingDecks = await db.decks.toArray();
  const vocabDeckNames = new Set(data.decks.map(d => d.name));

  for (const deck of existingDecks) {
    if (vocabDeckNames.has(deck.name)) {
      await db.cards.where('deckId').equals(deck.id!).delete();
      await db.decks.delete(deck.id!);
    }
  }

  await initVocabularyDecks();

  return {
    decksAdded: data.decks.length,
    cardsAdded: data.cards.length,
  };
}
