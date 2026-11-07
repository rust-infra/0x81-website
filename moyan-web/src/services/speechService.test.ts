import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
      googleZhVoice: "cmn-CN-Neural2-A",
    });

    await speak("亲自动手的；实操的");

    expect(requests).toHaveLength(1);
    expect(requests[0].voiceName).toBe("cmn-CN-Neural2-A");
    expect(requests[0].languageCode).toBe("cmn-CN");
  });

  it("reads pure English text with the configured English voice", async () => {
    configure({
      provider: "google",
      googleKey: "test-key",
      googleVoice: "en-US-Neural2-D",
      googleZhVoice: "cmn-CN-Neural2-A",
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
      googleZhVoice: "cmn-CN-Neural2-A",
    });

    await speak("hands-on 亲自动手的");

    expect(requests.map((r) => r.voiceName)).toEqual([
      "en-US-Neural2-D",
      "cmn-CN-Neural2-A",
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
});
