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
