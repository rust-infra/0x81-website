// 设置驱动的跨平台朗读：
// - webspeech → expo-speech（原生 TTS，语速/语言跟随设置）
// - google / elevenlabs / aliyun → HTTP 合成，缓存到本地文件后用 expo-audio 播放
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { UserSettings } from './types';

export interface SpeechSettings extends UserSettings {
  provider?: string;
  googleKey?: string;
  googleVoice?: string;
  googleZhVoice?: string;
  googleLanguage?: string;
  elevenLabsKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsZhVoiceId?: string;
  elevenLabsModel?: string;
  aliyunKey?: string;
  aliyunVoice?: string;
  aliyunModel?: string;
  cacheEnabled?: boolean;
}

const SETTINGS_KEY = 'speech_settings';

const DEFAULTS: SpeechSettings = {
  provider: 'webspeech',
  speech_voice: 'en-US-Neural2-D',
  speech_zh_voice: 'cmn-CN-Neural2-D',
  speech_speed: 0.9,
  auto_play: false,
  googleKey: '',
  googleVoice: 'en-US-Neural2-D',
  googleZhVoice: 'cmn-CN-Neural2-D',
  googleLanguage: 'en-US',
  elevenLabsKey: '',
  elevenLabsVoiceId: 'XB0fDUnXU5powFXDhCwa',
  elevenLabsZhVoiceId: 'XB0fDUnXU5powFXDhCwa',
  elevenLabsModel: 'eleven_turbo_v2_5',
  aliyunKey: '',
  aliyunVoice: 'Cherry',
  aliyunModel: 'qwen-tts',
  cacheEnabled: true,
};

export async function getSpeechSettings(): Promise<SpeechSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

export async function saveSpeechSettings(settings: SpeechSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function resetSpeechSettings(): Promise<SpeechSettings> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULTS }));
  return { ...DEFAULTS };
}

function detectLanguage(text: string): 'en' | 'zh' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

interface LangSegment {
  text: string;
  lang: 'en' | 'zh';
}

/** Split mixed Chinese/English text into language segments（与 moyan-web 一致） */
function splitByLanguage(text: string): LangSegment[] {
  const segments: LangSegment[] = [];
  let current = '';
  let currentLang: 'en' | 'zh' | null = null;
  for (const char of text) {
    const charLang: 'en' | 'zh' =
      /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 'zh' : 'en';
    if (currentLang === null) {
      currentLang = charLang;
      current = char;
    } else if (currentLang === charLang) {
      current += char;
    } else {
      segments.push({ text: current, lang: currentLang });
      currentLang = charLang;
      current = char;
    }
  }
  if (current && currentLang) {
    segments.push({ text: current, lang: currentLang });
  }
  return segments;
}

let webVoicesReady: Promise<void> | null = null;

function ensureWebVoices(): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return Promise.resolve();
  }
  const synth = (window as unknown as {
    speechSynthesis?: {
      getVoices?: () => unknown[];
      addEventListener?: (ev: string, cb: () => void) => void;
      removeEventListener?: (ev: string, cb: () => void) => void;
    };
  }).speechSynthesis;
  if (!synth || !synth.getVoices || (synth.getVoices() || []).length > 0) {
    return Promise.resolve();
  }
  if (!webVoicesReady) {
    webVoicesReady = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', finish);
        resolve();
      };
      const timer = setTimeout(finish, 3000);
      synth.addEventListener?.('voiceschanged', finish);
    });
  }
  return webVoicesReady;
}

let nativeVoiceIds: Set<string> | null = null;

/**
 * 原生平台可用音色 identifier 集合（首次调用后缓存）。
 * iOS 的 expo-speech 对不存在的 voice identifier 会直接抛 InvalidVoiceException，
 * Android 则静默忽略；因此统一先校验，音色无效时丢弃、交给 language 选默认音色。
 */
async function getNativeVoiceIds(): Promise<Set<string>> {
  if (nativeVoiceIds) return nativeVoiceIds;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    nativeVoiceIds = new Set(voices.map((v) => v.identifier));
  } catch {
    nativeVoiceIds = new Set();
  }
  return nativeVoiceIds;
}

async function speakWithNative(
  text: string,
  rate: number,
  language?: string,
  voiceId?: string
) {
  if (Platform.OS === 'web') {
    await ensureWebVoices();
    const w = window as unknown as {
      speechSynthesis?: {
        cancel: () => void;
        speak: (u: unknown) => void;
        getVoices?: () => Array<{ voiceURI: string; lang: string }>;
      };
      SpeechSynthesisUtterance?: new (t: string) => { lang: string; rate: number };
    };
    if (w.speechSynthesis && w.SpeechSynthesisUtterance) {
      w.speechSynthesis.cancel();
      const u = new w.SpeechSynthesisUtterance(text);
      u.lang = language || (detectLanguage(text) === 'zh' ? 'zh-CN' : 'en-US');
      u.rate = rate;
      if (voiceId && w.speechSynthesis.getVoices) {
        try {
          const voice = w.speechSynthesis
            .getVoices()
            .find((v) => v.voiceURI === voiceId);
          if (voice) {
            (u as unknown as { voice?: unknown }).voice = voice;
          }
        } catch {
          // 无效 voice 时忽略，回退到默认音色
        }
      }
      w.speechSynthesis.speak(u);
    }
    return;
  }
  // 校验音色：iOS 上无效 identifier 会让 expo-speech 抛异常导致完全无声，
  // 这里只传入真实存在的系统音色，否则回退到 language 默认音色。
  let resolvedVoice = voiceId;
  if (resolvedVoice) {
    const ids = await getNativeVoiceIds();
    if (!ids.has(resolvedVoice)) resolvedVoice = undefined;
  }
  Speech.stop();
  Speech.speak(text, {
    language: language || (detectLanguage(text) === 'zh' ? 'zh-CN' : 'en-US'),
    rate,
    voice: resolvedVoice,
  });
}

let player: import('expo-audio').AudioPlayer | null = null;
let currentWebAudio: HTMLAudioElement | null = null;
let speakToken = 0;

async function playFile(uri: string): Promise<void> {
  const { createAudioPlayer, setAudioModeAsync } = await import('expo-audio');
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
  if (!player) {
    player = createAudioPlayer(uri);
  } else {
    player.replace(uri);
  }
  player.play();
  await new Promise<void>((resolve) => {
    const sub = player!.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        sub.remove();
        resolve();
      }
    });
  });
}

async function cacheFile(
  key: string,
  data: ArrayBuffer,
  reuse: boolean
): Promise<string> {
  const { File, Paths } = await import('expo-file-system');
  const safeKey = key.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
  const file = new File(Paths.cache, `tts-${reuse ? safeKey : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`}.mp3`);
  if (reuse && file.exists) return file.uri;
  await file.write(new Uint8Array(data));
  return file.uri;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

async function playBytes(
  bytes: Uint8Array,
  cacheKey: string,
  cacheEnabled: boolean,
  token: number
): Promise<boolean> {
  if (token !== speakToken) return false;
  if (Platform.OS === 'web') {
    try {
      currentWebAudio?.pause();
      currentWebAudio = null;
      const audio = new Audio(`data:audio/mpeg;base64,${bytesToBase64(bytes)}`);
      audio.volume = 1;
      currentWebAudio = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          if (currentWebAudio === audio) currentWebAudio = null;
          resolve();
        };
        audio.onerror = () => {
          if (currentWebAudio === audio) currentWebAudio = null;
          reject(new Error('audio playback error'));
        };
        audio.play().catch(reject);
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    if (token !== speakToken) return false;
    const uri = await cacheFile(
      cacheKey,
      bytes.buffer as ArrayBuffer,
      cacheEnabled
    );
    if (token !== speakToken) return false;
    await playFile(uri);
    return true;
  } catch {
    return false;
  }
}

async function speakWithProvider(
  text: string,
  settings: SpeechSettings,
  lang: 'en' | 'zh',
  token: number
): Promise<boolean> {
  switch (settings.provider) {
    case 'google': {
      if (!settings.googleKey) return false;
      const voice = lang === 'zh' ? settings.googleZhVoice || 'cmn-CN-Neural2-D' : settings.googleVoice || 'en-US-Neural2-D';
      const languageCode = lang === 'zh' ? 'cmn-CN' : settings.googleLanguage || 'en-US';
      try {
        const res = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${settings.googleKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: { text },
              voice: { languageCode, name: voice },
              audioConfig: { audioEncoding: 'MP3', speakingRate: settings.speech_speed ?? 0.9 },
            }),
          }
        );
        if (!res.ok) return false;
        const data = (await res.json()) as { audioContent?: string };
        if (!data.audioContent) return false;
        const binary = atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return await playBytes(bytes, `google-${voice}-${text}`, !!settings.cacheEnabled, token);
      } catch {
        return false;
      }
    }
    case 'elevenlabs': {
      if (!settings.elevenLabsKey) return false;
      const voiceId =
        lang === 'zh'
          ? settings.elevenLabsZhVoiceId || settings.elevenLabsVoiceId
          : settings.elevenLabsVoiceId || 'XB0fDUnXU5powFXDhCwa';
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': settings.elevenLabsKey,
            },
            body: JSON.stringify({
              text,
              model_id: settings.elevenLabsModel || 'eleven_turbo_v2_5',
              voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
            }),
          }
        );
        if (!res.ok) return false;
        const bytes = new Uint8Array(await res.arrayBuffer());
        return await playBytes(bytes, `eleven-${voiceId}-${text}`, !!settings.cacheEnabled, token);
      } catch {
        return false;
      }
    }
    case 'aliyun': {
      if (!settings.aliyunKey) return false;
      try {
        const res = await fetch(
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal/multimodal-synthesis',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${settings.aliyunKey}`,
            },
            body: JSON.stringify({
              model: settings.aliyunModel || 'qwen-tts',
              input: { text },
              parameters: { voice: settings.aliyunVoice || 'Cherry' },
            }),
          }
        );
        if (!res.ok) return false;
        const bytes = new Uint8Array(await res.arrayBuffer());
        return await playBytes(bytes, `aliyun-${settings.aliyunVoice || 'Cherry'}-${text}`, !!settings.cacheEnabled, token);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export async function speak(
  text: string,
  opts?: { language?: string; rate?: number }
): Promise<void> {
  if (!text.trim()) return;
  const settings = await getSpeechSettings();
  const rate = opts?.rate ?? settings.speech_speed ?? 0.9;
  const token = ++speakToken;
  const segments = splitByLanguage(text);
  for (const seg of segments) {
    const segLang = seg.lang;
    let played = false;
    try {
      played = await speakWithProvider(seg.text, settings, segLang, token);
    } catch {
      played = false;
    }
    if (token !== speakToken) return;
    if (!played) {
      const voiceId =
        settings.provider === 'webspeech'
          ? segLang === 'zh'
            ? settings.speech_zh_voice
            : settings.speech_voice
          : undefined;
      try {
        await speakWithNative(
          seg.text,
          rate,
          opts?.language || (segLang === 'zh' ? 'zh-CN' : 'en-US'),
          voiceId
        );
      } catch {
        // 原生 TTS 失败时静默跳过，不中断后续 segment
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function stopSpeaking(): Promise<void> {
  speakToken += 1;
  if (Platform.OS === 'web') {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void } };
    w.speechSynthesis?.cancel();
    currentWebAudio?.pause();
    currentWebAudio = null;
  }
  Speech.stop();
  if (player) {
    player.pause();
  }
}

export async function clearAudioCache(): Promise<number> {
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.cache);
    let cleared = 0;
    for (const item of dir.list()) {
      if (item instanceof File && item.name.startsWith('tts-')) {
        try {
          await item.delete();
          cleared += 1;
        } catch {
          // ignore individual failures
        }
      }
    }
    return cleared;
  } catch {
    return 0;
  }
}
