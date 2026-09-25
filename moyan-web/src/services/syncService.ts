import { db } from "../db";
import { getCurrentUser } from "./authService";
import { API_BASE, hasBackend } from "./backendMode";

export interface SyncResult {
  success: boolean;
  message: string;
  details?: {
    decksCount: number;
    cardsCount: number;
    logsCount: number;
  };
}

/** Check if backend API is available（判断依据见 backendMode.ts，勿用 API_BASE 是否为空） */
/** Get auth token for current user */
function getToken(): string | null {
  return localStorage.getItem("moyan_token");
}

/** Get user identifier for localStorage backup key */
function getUserKey(): string {
  const user = getCurrentUser();
  if (user) {
    return `moyan_sync_${user.id}`;
  }
  return "moyan_sync_local";
}

/** Serialize all local data */
async function serializeData(): Promise<{
  decks: any[];
  cards: any[];
  reviewLogs: any[];
  exportDate: string;
  version: string;
}> {
  const [decks, cards, reviewLogs] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
  ]);

  return {
    decks,
    cards,
    reviewLogs,
    exportDate: new Date().toISOString(),
    version: "1.0",
  };
}

// ==================== Backend API Sync (Rust backend) ====================

async function uploadToBackend(data: any): Promise<SyncResult> {
  const token = getToken();
  if (!token) {
    return { success: false, message: "未登录，无法同步" };
  }

  try {
    const res = await fetch(`${API_BASE}/api/sync/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, message: `同步失败: ${err}` };
    }

    const result = await res.json();
    return {
      success: true,
      message: `已同步到云端：${result.data?.cards_synced || 0} 张卡片`,
      details: {
        decksCount: result.data?.decks_synced || 0,
        cardsCount: result.data?.cards_synced || 0,
        logsCount: result.data?.logs_synced || 0,
      },
    };
  } catch (err: any) {
    return { success: false, message: `网络错误: ${err.message}` };
  }
}

async function downloadFromBackend(): Promise<SyncResult> {
  const token = getToken();
  if (!token) {
    return { success: false, message: "未登录，无法恢复" };
  }

  try {
    const res = await fetch(`${API_BASE}/api/sync/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, message: `恢复失败: ${err}` };
    }

    const result = await res.json();
    const data = result.data;

    if (!data || !data.cards || data.cards.length === 0) {
      return { success: false, message: "云端没有数据" };
    }

    // Merge downloaded data into local DB
    await mergeDataIntoLocal(data);

    return {
      success: true,
      message: `已从云端恢复：${data.cards?.length || 0} 张卡片`,
      details: {
        decksCount: data.decks?.length || 0,
        cardsCount: data.cards?.length || 0,
        logsCount: data.review_logs?.length || 0,
      },
    };
  } catch (err: any) {
    return { success: false, message: `网络错误: ${err.message}` };
  }
}

// ==================== LocalStorage Fallback Sync ====================

async function uploadToLocalStorage(): Promise<SyncResult> {
  try {
    const data = await serializeData();
    const key = getUserKey();
    localStorage.setItem(key, JSON.stringify(data));

    const sizeKB = Math.round(JSON.stringify(data).length / 1024);
    return {
      success: true,
      message: `已保存到本地浏览器存储 (${sizeKB} KB)`,
      details: {
        decksCount: data.decks.length,
        cardsCount: data.cards.length,
        logsCount: data.reviewLogs.length,
      },
    };
  } catch (err: any) {
    return { success: false, message: `保存失败: ${err.message}` };
  }
}

async function downloadFromLocalStorage(): Promise<SyncResult> {
  try {
    const key = getUserKey();
    const stored = localStorage.getItem(key);

    if (!stored) {
      return { success: false, message: "本地没有找到备份数据" };
    }

    const data = JSON.parse(stored);
    await mergeDataIntoLocal(data);

    return {
      success: true,
      message: `已从本地恢复：${data.cards?.length || 0} 张卡片`,
      details: {
        decksCount: data.decks?.length || 0,
        cardsCount: data.cards?.length || 0,
        logsCount: data.reviewLogs?.length || 0,
      },
    };
  } catch (err: any) {
    return { success: false, message: `恢复失败: ${err.message}` };
  }
}

/** Merge external data into local IndexedDB */
async function mergeDataIntoLocal(data: any): Promise<void> {
  // Simple strategy: merge decks and cards, preserve local SRS state if newer

  if (data.decks?.length) {
    for (const deck of data.decks) {
      const existing = await db.decks.get(deck.id);
      if (!existing) {
        await db.decks.add(deck);
      } else {
        await db.decks.update(deck.id, {
          ...deck,
          updatedAt: new Date(),
        });
      }
    }
  }

  if (data.cards?.length) {
    for (const card of data.cards) {
      // Check if card exists by front + deckId
      const existing = await db.cards
        .where({ deckId: card.deckId || card.deck_id })
        .filter((c) => c.front === card.front)
        .first();

      if (!existing) {
        await db.cards.add({
          ...card,
          deckId: card.deckId || card.deck_id,
          srs: card.srs || {
            interval: 0,
            repetitions: 0,
            easeFactor: 2.5,
            dueDate: new Date(),
            status: "new",
          },
          updatedAt: new Date(),
        });
      }
      // If exists, keep local SRS data (don't overwrite learning progress)
    }
  }

  if (data.reviewLogs?.length || data.review_logs?.length) {
    const logs = data.reviewLogs || data.review_logs;
    for (const log of logs) {
      // Avoid duplicates by checking cardId + reviewedAt
      const existing = await db.reviewLogs
        .where({ cardId: log.cardId || log.card_id })
        .filter(
          (l) =>
            new Date(l.reviewedAt).getTime() ===
            new Date(log.reviewedAt || log.reviewed_at).getTime()
        )
        .first();

      if (!existing) {
        await db.reviewLogs.add({
          cardId: log.cardId || log.card_id,
          deckId: log.deckId || log.deck_id || 0,
          rating: log.rating,
          timeTaken: log.timeTaken || log.time_ms || 0,
          reviewedAt: new Date(log.reviewedAt || log.reviewed_at),
          oldInterval: log.oldInterval || 0,
          newInterval: log.newInterval || log.new_interval || 0,
          oldEaseFactor: log.oldEaseFactor || 2.5,
          newEaseFactor: log.newEaseFactor || log.new_ease_factor || 2.5,
        });
      }
    }
  }
}

// ==================== Public API ====================

export async function syncUpload(): Promise<SyncResult> {
  if (hasBackend()) {
    const data = await serializeData();
    return uploadToBackend(data);
  } else {
    return uploadToLocalStorage();
  }
}

export async function syncDownload(): Promise<SyncResult> {
  if (hasBackend()) {
    return downloadFromBackend();
  } else {
    return downloadFromLocalStorage();
  }
}

export function getSyncMode(): "backend" | "localstorage" {
  return hasBackend() ? "backend" : "localstorage";
}
