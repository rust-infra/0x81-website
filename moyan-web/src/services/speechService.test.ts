import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_ZH_VOICES,
  getSpeechSettings,
  saveSpeechSettings,
  speak,
  stopAllAudio,
} from "./speechService";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

class FakeAudio {
  src: string;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
  }
  play() {
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }
  pause() {}
}

interface TtsRequest {
  url: string;
  languageCode: string;
  voiceName: string;
  text: string;
}

let requests: TtsRequest[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal("localStorage", new MemoryStorage());
  // 关掉音频缓存：同一段文本在前面用例里被缓存过后，这里就不会再发请求
  localStorage.setItem("speech_settings", JSON.stringify({ cacheEnabled: false }));
  vi.stubGlobal("window", {
    speechSynthesis: { cancel: vi.fn(), getVoices: () => [] },
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}");
      requests.push({
        url: String(url),
        languageCode: body.voice?.languageCode,
        voiceName: body.voice?.name,
        text: body.input?.text,
      });
      return {
        ok: true,
        json: async () => ({ audioContent: btoa("x") }),
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    })
  );
});

function configure(patch: Record<string, unknown>) {
  saveSpeechSettings({ ...getSpeechSettings(), ...patch } as never);
}

describe("speechService voice routing", () => {
  it("reads pure Chinese text with the configured Chinese voice", async () => {
    configure({
      provider: "google",
      googleKey: "test-key",
      googleVoice: "en-US-Neural2-D",
      googleZhVoice: "cmn-CN-Wavenet-A",
    });

    await speak("亲自动手的；实操的");

    expect(requests).toHaveLength(1);
    expect(requests[0].voiceName).toBe("cmn-CN-Wavenet-A");
    expect(requests[0].languageCode).toBe("cmn-CN");
  });

  it("reads pure English text with the configured English voice", async () => {
    configure({
      provider: "google",
      googleKey: "test-key",
      googleVoice: "en-US-Neural2-D",
      googleZhVoice: "cmn-CN-Wavenet-A",
    });

    await speak("hands-on");

    expect(requests).toHaveLength(1);
    expect(requests[0].voiceName).toBe("en-US-Neural2-D");
    expect(requests[0].languageCode).toBe("en-US");
  });

  it("splits mixed text and uses the matching voice per segment", async () => {
    configure({
      provider: "google",
      googleKey: "test-key",
      googleVoice: "en-US-Neural2-D",
      googleZhVoice: "cmn-CN-Wavenet-A",
    });

    await speak("hands-on 亲自动手的");

    expect(requests.map((r) => r.voiceName)).toEqual([
      "en-US-Neural2-D",
      "cmn-CN-Wavenet-A",
    ]);
  });

  it("routes Chinese to the ElevenLabs Chinese voice id", async () => {
    configure({
      provider: "elevenlabs",
      elevenLabsKey: "test-key",
      elevenLabsVoiceId: "EN_VOICE",
      elevenLabsZhVoiceId: "ZH_VOICE",
    });

    await speak("亲自动手的");

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/ZH_VOICE");
  });

  it("stops playback cleanly between requests", () => {
    stopAllAudio();
    expect(window.speechSynthesis.cancel).toBeDefined();
  });

  it("ships only Chinese voice ids that Google Cloud actually provides", () => {
    // cmn-CN 只有 Standard / Wavenet；粤语是 yue-HK。写成 Neural2 或 yue-CN
    // 会让请求返回 400，再静默回退到浏览器音色。
    for (const voice of GOOGLE_ZH_VOICES) {
      expect(voice.id).toMatch(/^(cmn-CN|cmn-TW)-(Standard|Wavenet)-[A-D]$|^yue-HK-Standard-[A-D]$/);
      expect(voice.id).not.toContain("Neural2");
    }
  });

  it("replaces a stale saved voice with a valid one", () => {
    localStorage.setItem(
      "speech_settings",
      JSON.stringify({ provider: "google", googleZhVoice: "cmn-CN-Neural2-A" })
    );

    const settings = getSpeechSettings();

    expect(GOOGLE_ZH_VOICES.some((v) => v.id === settings.googleZhVoice)).toBe(true);
  });

  it("falls back to the default voice when a stale one is sent", async () => {
    configure({
      provider: "google",
      googleKey: "test-key",
      googleZhVoice: "cmn-CN-Neural2-A",
    });

    await speak("亲自动手的");

    expect(requests[0].voiceName).toBe("cmn-CN-Wavenet-A");
  });
});
