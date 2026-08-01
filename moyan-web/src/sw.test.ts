import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function loadSw() {
  const listeners = new Map<string, (event: unknown) => void>();
  const fakeSelf = {
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      listeners.set(type, cb);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const fakeCache = {
    match: async () => undefined,
    put: async () => {},
    addAll: async () => {},
  };
  const fakeCaches = {
    open: async () => fakeCache,
    keys: async () => [],
    delete: async () => true,
  };
  const run = new Function("self", "caches", SW_SOURCE);
  run(fakeSelf, fakeCaches);
  return { fetchHandler: listeners.get("fetch") as (event: unknown) => void };
}

function makeFetchEvent(
  url: string,
  init: { method?: string; mode?: string } = {},
) {
  const respondWith = vi.fn();
  return {
    event: {
      request: {
        url,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
      },
      respondWith,
    },
    respondWith,
  };
}

describe("service worker fetch routing", () => {
  it("does not intercept API requests so the UI always gets fresh data", () => {
    const { fetchHandler } = loadSw();
    const { event, respondWith } = makeFetchEvent(
      "http://127.0.0.1:4323/api/decks",
    );

    fetchHandler(event);

    expect(respondWith).not.toHaveBeenCalled();
  });

  it("does not intercept same-origin API requests either", () => {
    const { fetchHandler } = loadSw();
    const { event, respondWith } = makeFetchEvent(
      "http://localhost:5000/api/settings",
    );

    fetchHandler(event);

    expect(respondWith).not.toHaveBeenCalled();
  });

  it("still intercepts static assets for caching", () => {
    const { fetchHandler } = loadSw();
    const { event, respondWith } = makeFetchEvent(
      "http://localhost:5000/assets/index-abc123.js",
    );

    fetchHandler(event);

    expect(respondWith).toHaveBeenCalled();
  });

  it("still intercepts HTML navigation", () => {
    const { fetchHandler } = loadSw();
    const { event, respondWith } = makeFetchEvent(
      "http://localhost:5000/",
      { mode: "navigate" },
    );

    fetchHandler(event);

    expect(respondWith).toHaveBeenCalled();
  });
});
