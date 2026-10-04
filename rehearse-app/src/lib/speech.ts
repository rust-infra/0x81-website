// 设置驱动的跨平台朗读：
// - webspeech → expo-speech（原生 TTS，语速/语言跟随设置）
// - google / elevenlabs / aliyun → HTTP 合成，缓存到本地文件后用 expo-audio 播放
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import type { UserSettings } from './types';

export type SttProvider = 'system' | 'google-cloud' | 'gemini';

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
  /** Speech-to-text engine. Gemini uses the user's own API key, stored locally. */
  sttProvider?: SttProvider;
  googleCloudServiceAccountJson?: string;
  googleCloudProjectId?: string;
  googleCloudLocation?: string;
  googleCloudSttModel?: string;
  googleCloudRecognizer?: string;
  geminiApiKey?: string;
  geminiSttModel?: string;
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
  sttProvider: 'system',
  googleCloudServiceAccountJson: '',
  googleCloudProjectId: '',
  googleCloudLocation: 'us-central1',
  googleCloudSttModel: 'chirp_3',
  googleCloudRecognizer: '_',
  geminiApiKey: '',
  geminiSttModel: 'gemini-3.8-flash',
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

// ── 原生朗读的时序（iOS/Android） ────────────────────────────────────────────
//
// 症状：每条回复开头被"重复念一小段"再从头念对。
// 根因：`Speech.stop()` 是**异步**的 —— 调完立刻 `speak()`，两次 utterance 会
// 叠/排队（iOS 上尤其明显：第一次已经出声了才被停掉，然后第二次从头起播）。
// 录音（STT）刚结束时音频会话还在 record → playback 的切换窗口里起播，也会让
// utterance 被打断后重来。
//
// 所以这里的规则是：
//   1. 起播前先取消，并**等到引擎真的空闲**（轮询 isSpeakingAsync），不是发完就冲；
//   2. 再留一小段时间让音频会话落定；
//   3. 每段**等它念完**（onDone/onStopped/onError）再处理下一段，多语言分段不再互相截断。
const NATIVE_CANCEL_SETTLE_MS = 120;
// 起播前的落定时间：会话从 record 切回 playback 需要一点时间才真正生效，
// 太短等于没等（起播还会落在切换窗口里）。
const NATIVE_START_SETTLE_MS = 150;

async function nativeIsSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

/** 停掉当前朗读，并等引擎真正空闲（最多 timeoutMs，避免死等）。 */
async function cancelNativeSpeech(timeoutMs = 500): Promise<void> {
  try {
    Speech.stop();
  } catch {
    // 忽略：引擎已停或未就绪
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await nativeIsSpeaking())) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await new Promise((r) => setTimeout(r, NATIVE_CANCEL_SETTLE_MS));
}

/**
 * 朗读一段并等它真的念完。
 * 回调（onDone/onStopped/onError）是主要出口；再按文本长度留一个兜底超时，
 * 避免个别机型丢回调时把后续分段/状态永久卡住。
 */
function speakNativeAndWait(
  text: string,
  rate: number,
  language: string,
  voiceId?: string
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // 约 90ms/字符 @ rate=1 的宽松估算，再加 2s 余量
    const estimate = 2_000 + (text.length * 90) / Math.max(rate, 0.1);
    const timer = setTimeout(finish, estimate);
    try {
      Speech.speak(text, {
        language,
        rate,
        voice: voiceId,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    } catch {
      // 同步抛错（例如机型不支持该音色）时立刻收尾，不留悬挂定时器
      finish();
    }
  });
}

async function speakWithNative(
  text: string,
  rate: number,
  language?: string,
  voiceId?: string,
  token?: number
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
  // Check after async voice lookup: a newer request may have superseded this one.
  if (token !== undefined && token !== speakToken) return;
  // Only the top-level speak() call cancels existing playback. Cancelling here would
  // stop this request's own utterance when advancing to the next language segment.
  await new Promise((r) => setTimeout(r, NATIVE_START_SETTLE_MS));
  if (token !== undefined && token !== speakToken) return;
  if (__DEV__) {
    console.log(
      `[tts] native speak lang=${language} voice=${resolvedVoice ?? '(default)'} text=${JSON.stringify(
        text.slice(0, 60)
      )}`
    );
  }
  await speakNativeAndWait(
    text,
    rate,
    language || (detectLanguage(text) === 'zh' ? 'zh-CN' : 'en-US'),
    resolvedVoice
  );
}

let player: import('expo-audio').AudioPlayer | null = null;
let currentWebAudio: HTMLAudioElement | null = null;
let speakToken = 0;

// iOS 上 expo-speech 不配置 AVAudioSession：app 未设置时默认是 soloAmbient
// 类别，朗读会跟随实体静音拨片（静音时无声）。这里把 audio session 切到
// playback 类别（playsInSilentMode: true），与播客播放器行为一致。
//
// 注意：**不能只做一次就缓存**。麦克风（STT）会把会话切成 record，缓存的"已设置"
// 标志就骗了自己 —— 之后每条回复都在 record → playback 的切换窗口里起播，
// utterance 会被打断后重播，听感就是"用过麦克风之后，每条回复前面重复念一段"。
// 所以每次朗读前都重新声明一次（幂等、开销很小）。
async function applyPlaybackAudioMode(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const { setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
  } catch {
    // audio mode is best-effort
  }
}

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
  opts?: { language?: string; rate?: number; voiceId?: string }
): Promise<void> {
  if (!text.trim()) return;
  const token = ++speakToken;
  // A newer call supersedes this one immediately, including during async setup.
  // Do not let slow audio-mode/settings work allow an older request to reclaim playback.
  await applyPlaybackAudioMode();
  if (token !== speakToken) return;
  const settings = await getSpeechSettings();
  if (token !== speakToken) return;
  const rate = opts?.rate ?? settings.speech_speed ?? 0.9;
  // Stop previous native utterance once per speak request. The token was assigned
  // before awaiting, so concurrent calls cannot overtake each other.
  if (Platform.OS !== 'web') {
    await cancelNativeSpeech();
  } else {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void } };
    w.speechSynthesis?.cancel();
    currentWebAudio?.pause();
    currentWebAudio = null;
  }
  if (token !== speakToken) return;
  const segments = splitByLanguage(text);
  // 诊断日志（仅开发构建）：排查"同一条回复被念两遍/前面重复一段"时，
  // 用它能直接看出 speak 被调用了几次、切成几段、每段用什么语言与音色。
  // 正常后可以删掉，不影响功能。
  if (__DEV__) {
    console.log(
      `[tts] #${token} speak len=${text.length} segments=${segments.length} text=${JSON.stringify(
        text.slice(0, 80)
      )}`
    );
  }
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
      // 语言与音色按**这一段的实际语言**选：调用方传进来的 language/voiceId
      // 是"角色语言偏好"（如 en-IN），只能用于英文段 —— 否则中文段会被英文音色
      // 念成一串听不懂的词。
      const segLanguage = segLang === 'zh' ? 'zh-CN' : opts?.language || 'en-US';
      const voiceId =
        segLang === 'zh'
          ? settings.speech_zh_voice
          : opts?.voiceId ??
            (settings.provider === 'webspeech' ? settings.speech_voice : undefined);
      try {
        await speakWithNative(seg.text, rate, segLanguage, voiceId, token);
      } catch {
        // 原生 TTS 失败时静默跳过，不中断后续 segment
      }
    }
    if (token !== speakToken) return;
    // 段间小停顿。注意：这**不是**用来掩盖截断的 —— 上一段已经等它念完了。
    await new Promise((r) => setTimeout(r, 120));
  }
}

export async function stopSpeaking(): Promise<void> {
  speakToken += 1;
  if (Platform.OS === 'web') {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void } };
    w.speechSynthesis?.cancel();
    currentWebAudio?.pause();
    currentWebAudio = null;
  } else {
    // 等原生引擎停稳后再让调用者（例如开麦）继续。
    await cancelNativeSpeech();
  }
  if (player) player.pause();
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
