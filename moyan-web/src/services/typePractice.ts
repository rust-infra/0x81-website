import type {
  TypeEntry,
  TypeMode,
  TypeResume,
  TypeSession,
} from "@/types/vocabulary";
import type { SRSData } from "../db";
import { calculateSRS } from "./srs";

export const EGREGIOUS_ACCURACY_THRESHOLD = 0.7;
export const TYPE_SYNC_ENTRY_LIMIT = 2000;
/** 打字页 HUD 里准确率低于该值就改成醒目（强调色 + 加粗）显示。 */
export const ACCURACY_WARN_THRESHOLD = 0.9;
/** 「错题本」虚拟词库 id（不是真实词库，只在打字页出现）。 */
export const MISTAKES_DECK_ID = 'mistakes';

/**
 * Whether a typed character matches the expected target character.
 * Comparison ignores letter case (typing "a" for "A" counts as correct);
 * CJK characters, digits and punctuation are unaffected because
 * `toLowerCase()` is the identity for them.
 */
export function typedCharMatches(
  typed: string,
  expected: string | undefined
): boolean {
  if (expected === undefined) return false;
  if (typed === expected) return true;
  return typed.toLowerCase() === expected.toLowerCase();
}

export function accuracyOf(correctChars: number, wrongChars: number): number {
  const total = correctChars + wrongChars;
  return total === 0 ? 0 : correctChars / total;
}

export function wpmOf(correctChars: number, durationMs: number): number {
  const minutes = durationMs / 60000;
  return minutes > 0 ? correctChars / 5 / minutes : 0;
}

export function isEgregious(
  correctChars: number,
  wrongChars: number,
  skipped: boolean
): boolean {
  if (skipped) return true;
  return accuracyOf(correctChars, wrongChars) < EGREGIOUS_ACCURACY_THRESHOLD;
}

export interface TypeEntryInput {
  id: string;
  cardId: string;
  deckId: string;
  mode: TypeMode;
  correctChars: number;
  wrongChars: number;
  durationMs: number;
  skipped: boolean;
  createdAt: string;
}

export function buildTypeEntry(input: TypeEntryInput): TypeEntry {
  return {
    id: input.id,
    card_id: input.cardId,
    deck_id: input.deckId,
    mode: input.mode,
    correct_chars: input.correctChars,
    wrong_chars: input.wrongChars,
    accuracy: accuracyOf(input.correctChars, input.wrongChars),
    wpm: wpmOf(input.correctChars, input.durationMs),
    duration_ms: input.durationMs,
    egregious: isEgregious(
      input.correctChars,
      input.wrongChars,
      input.skipped
    ),
    created_at: input.createdAt,
  };
}

export interface TypeSessionInput {
  id: string;
  deckId: string | null;
  deckName: string | null;
  mode: TypeMode;
  entries: TypeEntry[];
  totalCards: number;
  skipped: number;
  durationMs: number;
  createdAt: string;
}

export function buildTypeSession(input: TypeSessionInput): TypeSession {
  const avg = (values: number[]) =>
    values.length === 0
      ? 0
      : values.reduce((a, b) => a + b, 0) / values.length;
  return {
    id: input.id,
    deck_id: input.deckId,
    deck_name: input.deckName,
    mode: input.mode,
    total_cards: input.totalCards,
    completed: input.entries.length - input.skipped,
    skipped: input.skipped,
    egregious_count: input.entries.filter((e) => e.egregious).length,
    avg_accuracy: avg(input.entries.map((e) => e.accuracy)),
    avg_wpm: avg(input.entries.map((e) => e.wpm)),
    duration_ms: input.durationMs,
    created_at: input.createdAt,
  };
}

export function newPrefixedId(prefix: "ts_" | "te_"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function egregiousSrsUpdates(
  entries: TypeEntry[],
  srsByCard: Map<string, SRSData>
): Array<{ cardId: string; srs: SRSData }> {
  const updates: Array<{ cardId: string; srs: SRSData }> = [];
  for (const entry of entries) {
    if (!entry.egregious) continue;
    const srs = srsByCard.get(entry.card_id);
    if (srs) updates.push({ cardId: entry.card_id, srs });
  }
  return updates;
}

export function toAgainUpsertBody(
  srs: SRSData,
  lastReviewedAt = new Date().toISOString()
) {
  const updated = calculateSRS(srs, "again");
  return {
    srs_status: updated.status,
    interval: updated.interval,
    repetitions: updated.repetitions,
    ease_factor: updated.easeFactor,
    due_date: updated.dueDate.toISOString(),
    last_reviewed_at: lastReviewedAt,
  };
}

export interface TypedCharStateInput {
  state: "correct" | "wrong";
  inputChar?: string | null;
}

export function buildTypeResume(input: {
  deckId: string;
  deckName: string | null;
  mode: TypeMode;
  cardId: string;
  target: string;
  charIndex: number;
  correctChars: number;
  wrongChars: number;
  typedStates: TypedCharStateInput[];
  updatedAt: string;
}): TypeResume {
  return {
    deck_id: input.deckId,
    deck_name: input.deckName,
    mode: input.mode,
    card_id: input.cardId,
    target: input.target,
    char_index: input.charIndex,
    correct_chars: input.correctChars,
    wrong_chars: input.wrongChars,
    typed_states: input.typedStates.map((s) => ({
      state: s.state,
      input_char: s.inputChar ?? null,
    })),
    updated_at: input.updatedAt,
  };
}

/** 一个词练完之后，决定它是否需要进/出错题本所需的最小信息。 */
export interface MistakeCandidate {
  entryId: string;
  cardId: string;
  deckId: string;
  correctChars: number;
  wrongChars: number;
  skipped: boolean;
}

export interface MistakeEvents {
  add: Array<{ card_id: string; deck_id: string; entry_id: string }>;
  remove: string[];
}

/**
 * 由一批完成记录推出错题本的增量变更（判定口径与打字统计一致：逐键计数）：
 * - 跳过的词不参与：既不算打错、也不算练到 100%；
 * - `wrongChars > 0` → 进错题本（打错后退格改对也算，与 accuracy 口径一致）；
 * - `wrongChars === 0` 且确实敲过字 → 100% 准确率 → 移出错题本；
 * - 同一个词在一批里出现多次时以最后一次为准（数组顺序 = 完成顺序）。
 */
export function mistakeEventsOf(candidates: MistakeCandidate[]): MistakeEvents {
  const lastByCard = new Map<string, MistakeCandidate>();
  for (const candidate of candidates) {
    if (candidate.skipped) continue;
    if (candidate.wrongChars > 0 || candidate.correctChars > 0) {
      lastByCard.set(candidate.cardId, candidate);
    }
  }
  const add: MistakeEvents['add'] = [];
  const remove: string[] = [];
  for (const candidate of lastByCard.values()) {
    if (candidate.wrongChars > 0) {
      add.push({
        card_id: candidate.cardId,
        deck_id: candidate.deckId || 'all',
        entry_id: candidate.entryId,
      });
    } else {
      remove.push(candidate.cardId);
    }
  }
  return { add, remove };
}

export function typedStatesFromCharInfos(
  charInfos: Array<{ state: string; inputChar?: string }>,
  count: number
): TypedCharStateInput[] {
  return charInfos.slice(0, count).map((c) => ({
    state: c.state === "wrong" ? "wrong" : "correct",
    inputChar: c.inputChar ?? null,
  }));
}

export function canResumeAt(
  resume: TypeResume | null,
  mode: TypeMode,
  target: string
): boolean {
  if (!resume) return false;
  if (resume.mode !== mode || resume.target !== target) return false;
  return resume.char_index > 0 && resume.char_index < target.length;
}
