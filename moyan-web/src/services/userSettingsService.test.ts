import { beforeEach, describe, expect, it, vi } from "vitest";

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

function installBrowserStubs() {
  const storage = new MemoryStorage();
  const rootStyle = {
    setProperty() {
      return undefined;
    },
  };
  const root = {
    style: rootStyle,
    setAttribute() {
      return undefined;
    },
  };
  const eventTarget = new EventTarget() as EventTarget & Window;

  Object.assign(globalThis, {
    localStorage: storage,
    document: {
      documentElement: root,
    },
    window: Object.assign(eventTarget, {
      setTimeout,
      clearTimeout,
    }),
    CustomEvent: class CustomEvent<T = unknown> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type, init);
        this.detail = init?.detail as T;
      }
    },
  });
}

describe("userSettingsService", () => {
  beforeEach(() => {
    installBrowserStubs();
    vi.resetModules();
    import.meta.env.VITE_API_URL = "http://127.0.0.1:4323";
    localStorage.clear();
  });

  it("builds payload from user scoped local settings without api keys", async () => {
    const { getSpeechSettings, saveSpeechSettings } = await import("./speechService");
    const { buildUserSettingsPayload } = await import("./userSettingsService");

    saveSpeechSettings({
      ...getSpeechSettings(),
      provider: "aliyun",
      aliyunKey: "secret-key",
      aliyunVoice: "Ethan",
      aliyunModel: "qwen-tts-hd",
      rate: 1.2,
      autoPlay: true,
    });

    const payload = buildUserSettingsPayload();

    expect(payload).toEqual({
      theme: "xuanzhi",
      language: "zh-CN",
      speech_provider: "aliyun",
      speech_voice: "Ethan",
      speech_zh_voice: null,
      speech_model: "qwen-tts-hd",
      speech_speed: 1.2,
      auto_play: true,
    });
    expect(JSON.stringify(payload)).not.toContain("secret-key");
  });

  it("applies remote user settings onto local theme language and speech preferences", async () => {
    const { getSpeechSettings } = await import("./speechService");
    const { applyUserSettings } = await import("./userSettingsService");
    const { getThemeName } = await import("@/theme");
    const { getLanguage } = await import("@/i18n/translations");

    applyUserSettings({
      theme: "zhuqing",
      language: "en",
      speech_provider: "google",
      speech_voice: "en-US-Neural2-F",
      speech_zh_voice: "cmn-CN-Neural2-A",
      speech_model: "en-GB",
      speech_speed: 1.1,
      auto_play: true,
    });

    const speech = getSpeechSettings();
    expect(getThemeName()).toBe("zhuqing");
    expect(getLanguage()).toBe("en");
    expect(speech.provider).toBe("google");
    expect(speech.googleVoice).toBe("en-US-Neural2-F");
    expect(speech.googleZhVoice).toBe("cmn-CN-Neural2-A");
    expect(speech.googleLanguage).toBe("en-GB");
    expect(speech.rate).toBe(1.1);
    expect(speech.autoPlay).toBe(true);
  });

  it("detects whether remote settings contain any usable value", async () => {
    const { hasRemoteSettingsValue } = await import("./userSettingsService");

    expect(hasRemoteSettingsValue({})).toBe(false);
    expect(hasRemoteSettingsValue({ theme: null, language: undefined })).toBe(
      false
    );
    expect(hasRemoteSettingsValue({ theme: "xuanzhi" })).toBe(true);
  });

  it("fetches remote settings on startup when localStorage already has a logged in user", async () => {
    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_1",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-123");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "zhuqing",
        },
      }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const { subscribeToSettingsSync } = await import("./userSettingsService");

    const unsubscribe = subscribeToSettingsSync();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/settings"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      })
    );

    unsubscribe();
  });

  it("only runs one startup sync request for the same logged in user", async () => {
    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_3",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-789");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "zhuqing",
        },
      }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const { subscribeToSettingsSync } = await import("./userSettingsService");

    const unsubscribe = subscribeToSettingsSync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("deduplicates startup sync when subscribed twice for the same user", async () => {
    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_4",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-000");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "zhuqing",
        },
      }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const { subscribeToSettingsSync } = await import("./userSettingsService");

    const unsubscribeA = subscribeToSettingsSync();
    const unsubscribeB = subscribeToSettingsSync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/settings"))).toHaveLength(1);

    unsubscribeA();
    unsubscribeB();
  });

  it("does not save again immediately after applying remote settings", async () => {
    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_5",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-111");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          theme: "zhuqing",
          language: "en",
          speech_provider: "google",
          speech_voice: "en-US-Neural2-F",
          speech_zh_voice: "cmn-CN-Neural2-A",
          speech_model: "en-GB",
          speech_speed: 1.1,
          auto_play: true,
        },
      }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const { subscribeToSettingsSync } = await import("./userSettingsService");

    const unsubscribe = subscribeToSettingsSync();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({ method: "PUT" })
    );

    unsubscribe();
  });

  it("emits sync state events while fetching and saving settings", async () => {
    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_2",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-456");

    const events: Array<{ phase: string; status: string }> = [];
    window.addEventListener("moyan:settings-sync-state", (event) => {
      const detail = (event as CustomEvent<{ phase: string; status: string }>).detail;
      events.push(detail);
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { theme: "xuanzhi" } }),
      });
    Object.assign(globalThis, { fetch: fetchMock });

    const { fetchUserSettings, saveUserSettings } = await import("./userSettingsService");

    await fetchUserSettings();
    await saveUserSettings({ theme: "xuanzhi" });

    expect(events).toEqual([
      expect.objectContaining({ phase: "fetch", status: "loading" }),
      expect.objectContaining({ phase: "fetch", status: "success" }),
      expect.objectContaining({ phase: "save", status: "saving" }),
      expect.objectContaining({ phase: "save", status: "success" }),
    ]);
  });

  it("formats last sync timestamps for the active language", async () => {
    const { formatSettingsSyncTimestamp } = await import("./userSettingsService");

    expect(
      formatSettingsSyncTimestamp(Date.UTC(2026, 6, 20, 3, 5), "zh-CN")
    ).toMatch(/07\/20.*:05|2026\/07\/20.*:05/);
    expect(
      formatSettingsSyncTimestamp(Date.UTC(2026, 6, 20, 3, 5), "en")
    ).toMatch(/07\/(19|20).*:05/);
  });

  it("exposes the latest sync state snapshot for late subscribers", async () => {
    const {
      fetchUserSettings,
      getLatestSettingsSavedTimestamp,
      getLatestSettingsSyncState,
    } = await import("./userSettingsService");

    localStorage.setItem(
      "moyan_user",
      JSON.stringify({
        id: "usr_6",
        name: "Demo User",
        email: "demo@example.com",
        avatar: "",
        provider: "kimi",
      })
    );
    localStorage.setItem("moyan_token", "token-222");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { theme: "zhuqing" } }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    await fetchUserSettings();

    expect(getLatestSettingsSyncState()).toEqual(
      expect.objectContaining({
        phase: "fetch",
        status: "success",
      })
    );
    expect(getLatestSettingsSavedTimestamp()).toBeNull();
  });

  it("tracks last saved timestamp only after a successful save", async () => {
    const {
      getLatestSettingsSavedTimestamp,
      saveUserSettings,
    } = await import("./userSettingsService");

    localStorage.setItem("moyan_token", "token-333");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { theme: "zhuqing" } }),
    });
    Object.assign(globalThis, { fetch: fetchMock });

    expect(getLatestSettingsSavedTimestamp()).toBeNull();

    await saveUserSettings({ theme: "zhuqing" });

    expect(getLatestSettingsSavedTimestamp()).toEqual(expect.any(Number));
  });
});
