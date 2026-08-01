import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeck, getStudyQueue, listDecks } from "./vocabularyApi";

class MemoryStorage {
  private data = new Map<string, string>();

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  get length() {
    return this.data.size;
  }
}

describe("vocabularyApi", () => {
  beforeEach(() => {
    Object.assign(globalThis, { localStorage: new MemoryStorage() });
    localStorage.setItem("moyan_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      })
    );
  });

  it("lists decks with bearer token", async () => {
    await listDecks();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/decks$/),
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((options.headers as Headers).get("Authorization")).toBe(
      "Bearer tok"
    );
  });

  it("creates a deck with JSON body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: "deck_1", name: "Mine" },
      }),
    });

    await createDeck({ name: "Mine", description: "d" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/decks$/),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Mine", description: "d" }),
      })
    );
  });

  it("fetches the aggregated study queue", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          cards: [],
          due_count: 2,
          new_count: 5,
          total_cards: 7,
          today_reviewed: 1,
        },
      }),
    });

    const queue = await getStudyQueue();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/study\/queue$/),
      expect.anything()
    );
    expect(queue.due_count).toBe(2);
    expect(queue.total_cards).toBe(7);
  });
});
