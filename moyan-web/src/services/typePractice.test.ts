import { describe, expect, it } from "vitest";
import type { SRSData } from "../db";
import { calculateSRS } from "./srs";
import {
  buildTypeEntry,
  buildTypeSession,
  buildTypeResume,
  canResumeAt,
  egregiousSrsUpdates,
  isEgregious,
  typedStatesFromCharInfos,
  toAgainUpsertBody,
  wpmOf,
} from "./typePractice";

describe("isEgregious", () => {
  it("marks skipped words as egregious", () => {
    expect(isEgregious(10, 0, true)).toBe(true);
  });

  it("marks accuracy below 0.70 as egregious", () => {
    expect(isEgregious(69, 31, false)).toBe(true);
  });

  it("does not mark accuracy exactly 0.70 as egregious", () => {
    expect(isEgregious(7, 3, false)).toBe(false);
  });

  it("does not mark high accuracy as egregious", () => {
    expect(isEgregious(9, 1, false)).toBe(false);
  });

  it("marks a word with no typed chars as egregious", () => {
    expect(isEgregious(0, 0, false)).toBe(true);
  });
});

describe("wpmOf", () => {
  it("returns 0 for zero duration", () => {
    expect(wpmOf(10, 0)).toBe(0);
  });

  it("computes standard wpm (chars/5 per minute)", () => {
    expect(wpmOf(10, 60_000)).toBeCloseTo(2, 10);
  });
});

describe("buildTypeEntry", () => {
  it("computes accuracy, wpm and egregious flag", () => {
    const entry = buildTypeEntry({
      id: "te_1",
      cardId: "card_a",
      deckId: "deck_a",
      mode: "word",
      correctChars: 10,
      wrongChars: 2,
      durationMs: 60_000,
      skipped: false,
      createdAt: "2026-08-01T08:00:00Z",
    });
    expect(entry.accuracy).toBeCloseTo(10 / 12, 10);
    expect(entry.wpm).toBeCloseTo(2, 10);
    expect(entry.egregious).toBe(false);
  });

  it("marks skipped entries as egregious", () => {
    const entry = buildTypeEntry({
      id: "te_2",
      cardId: "card_b",
      deckId: "deck_a",
      mode: "word",
      correctChars: 0,
      wrongChars: 0,
      durationMs: 1_000,
      skipped: true,
      createdAt: "2026-08-01T08:00:01Z",
    });
    expect(entry.egregious).toBe(true);
  });
});

describe("buildTypeSession", () => {
  it("aggregates completed, skipped, egregious, accuracy and wpm", () => {
    const entries = [
      buildTypeEntry({
        id: "te_a",
        cardId: "card_a",
        deckId: "deck_a",
        mode: "word",
        correctChars: 10,
        wrongChars: 0,
        durationMs: 30_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:00Z",
      }),
      buildTypeEntry({
        id: "te_b",
        cardId: "card_b",
        deckId: "deck_a",
        mode: "word",
        correctChars: 0,
        wrongChars: 0,
        durationMs: 2_000,
        skipped: true,
        createdAt: "2026-08-01T08:00:30Z",
      }),
      buildTypeEntry({
        id: "te_c",
        cardId: "card_c",
        deckId: "deck_a",
        mode: "word",
        correctChars: 6,
        wrongChars: 4,
        durationMs: 28_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:35Z",
      }),
    ];
    const session = buildTypeSession({
      id: "ts_1",
      deckId: "deck_a",
      deckName: "Rust语言核心",
      mode: "word",
      entries,
      totalCards: 3,
      skipped: 1,
      durationMs: 60_000,
      createdAt: "2026-08-01T08:01:00Z",
    });
    expect(session.completed).toBe(2);
    expect(session.skipped).toBe(1);
    expect(session.egregious_count).toBe(2);
    expect(session.avg_accuracy).toBeCloseTo((1 + 0 + 0.6) / 3, 10);
    expect(session.avg_wpm).toBeCloseTo((4 + 0 + 6 / 5 / (28_000 / 60000)) / 3, 6);
  });
});

describe("SRS again updates", () => {
  const srs: SRSData = {
    interval: 5,
    repetitions: 2,
    easeFactor: 2.5,
    dueDate: new Date("2026-08-05T00:00:00Z"),
    status: "review",
  };

  it("maps only egregious entries with known srs", () => {
    const entries = [
      buildTypeEntry({
        id: "te_1",
        cardId: "card_a",
        deckId: "deck_a",
        mode: "word",
        correctChars: 0,
        wrongChars: 0,
        durationMs: 1_000,
        skipped: true,
        createdAt: "2026-08-01T08:00:00Z",
      }),
      buildTypeEntry({
        id: "te_2",
        cardId: "card_b",
        deckId: "deck_a",
        mode: "word",
        correctChars: 10,
        wrongChars: 0,
        durationMs: 5_000,
        skipped: false,
        createdAt: "2026-08-01T08:00:05Z",
      }),
    ];
    const updates = egregiousSrsUpdates(entries, new Map([["card_a", srs]]));
    expect(updates.map((u) => u.cardId)).toEqual(["card_a"]);
  });

  it("builds upsert body matching calculateSRS(again)", () => {
    const updated = calculateSRS(srs, "again");
    const body = toAgainUpsertBody(srs, "2026-08-01T09:00:00Z");
    expect(body.srs_status).toBe(updated.status);
    expect(body.interval).toBe(updated.interval);
    expect(body.repetitions).toBe(updated.repetitions);
    expect(body.ease_factor).toBe(updated.easeFactor);
    expect(body.due_date).toBe(updated.dueDate.toISOString());
    expect(body.last_reviewed_at).toBe("2026-08-01T09:00:00Z");
  });
});

describe("type resume helpers", () => {
  it("builds a resume with snake_case fields", () => {
    const resume = buildTypeResume({
      deckId: "deck_a",
      deckName: "Rust语言核心",
      mode: "word",
      cardId: "card_a",
      target: "hello",
      charIndex: 3,
      correctChars: 2,
      wrongChars: 1,
      typedStates: [
        { state: "correct", inputChar: "h" },
        { state: "wrong", inputChar: "x" },
        { state: "correct", inputChar: "l" },
      ],
      updatedAt: "2026-08-01T08:30:00Z",
    });
    expect(resume.deck_id).toBe("deck_a");
    expect(resume.char_index).toBe(3);
    expect(resume.correct_chars).toBe(2);
    expect(resume.typed_states[1].state).toBe("wrong");
    expect(resume.typed_states[1].input_char).toBe("x");
  });

  it("extracts typed states from char infos", () => {
    const states = typedStatesFromCharInfos(
      [
        { state: "correct", inputChar: "h" },
        { state: "wrong", inputChar: "x" },
        { state: "pending" },
        { state: "correct" },
      ],
      2
    );
    expect(states).toEqual([
      { state: "correct", inputChar: "h" },
      { state: "wrong", inputChar: "x" },
    ]);
  });

  it("decides when a mid-word resume is possible", () => {
    const midWord = buildTypeResume({
      deckId: "",
      deckName: null,
      mode: "word",
      cardId: "card_a",
      target: "hello",
      charIndex: 3,
      correctChars: 2,
      wrongChars: 1,
      typedStates: [],
      updatedAt: "2026-08-01T08:30:00Z",
    });
    expect(canResumeAt(midWord, "word", "hello")).toBe(true);
    // completed word → start fresh
    expect(canResumeAt({ ...midWord, char_index: 5 }, "word", "hello")).toBe(false);
    // mode mismatch → start fresh
    expect(canResumeAt(midWord, "sentence", "hello")).toBe(false);
    // target mismatch (card content changed) → start fresh
    expect(canResumeAt(midWord, "word", "world")).toBe(false);
    // null resume → false
    expect(canResumeAt(null, "word", "hello")).toBe(false);
  });
});
