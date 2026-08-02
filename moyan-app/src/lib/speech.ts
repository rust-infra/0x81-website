// 设置驱动的跨平台朗读：
// - webspeech → expo-speech（原生 TTS，语速/语言跟随设置）
// - google / elevenlabs / aliyun → HTTP 合成，缓存到本地文件后用 expo-audio 播放
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
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

function speakWithNative(text: string, rate: number, language?: string) {
  if (Platform.OS === 'web') {
    const w = window as unknown as {
      speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void };
      SpeechSynthesisUtterance?: new (t: string) => { lang: string; rate: number };
    };
    if (w.speechSynthesis && w.SpeechSynthesisUtterance) {
      w.speechSynthesis.cancel();
      const u = new w.SpeechSynthesisUtterance(text);
      u.lang = language || (detectLanguage(text) === 'zh' ? 'zh-CN' : 'en-US');
      u.rate = rate;
      w.speechSynthesis.speak(u);
    }
    return;
  }
  Speech.stop();
  Speech.speak(text, {
    language: language || (detectLanguage(text) === 'zh' ? 'zh-CN' : 'en-US'),
    rate,
  });
}

let player: import('expo-audio').AudioPlayer | null = null;

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
  const safeKey = key.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
  const file = new File(Paths.cache, `tts-${reuse ? safeKey : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`}.mp3`);
  if (reuse && file.exists) return file.uri;
  await file.write(new Uint8Array(data));
  return file.uri;
}

async function fetchAndPlay(
  url: string,
  init: RequestInit | undefined,
  cacheKey: string,
  cacheEnabled: boolean
): Promise<boolean> {
  const res = await fetch(url, init);
  if (!res.ok) return false;
  const buffer = await res.arrayBuffer();
  const uri = await cacheFile(cacheKey, buffer, cacheEnabled);
  await playFile(uri);
  return true;
}

async function speakWithProvider(
  text: string,
  settings: SpeechSettings
): Promise<boolean> {
  const lang = detectLanguage(text);
  switch (settings.provider) {
    case 'google': {
      if (!settings.googleKey) return false;
      const voice = lang === 'zh' ? settings.googleZhVoice || 'cmn-CN-Neural2-D' : settings.googleVoice || 'en-US-Neural2-D';
      const languageCode = lang === 'zh' ? 'cmn-CN' : settings.googleLanguage || 'en-US';
      return fetchAndPlay(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${settings.googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voice },
            audioConfig: { audioEncoding: 'MP3', speakingRate: settings.speech_speed ?? 0.9 },
          }),
        },
        `google-${voice}-${text}`,
        !!settings.cacheEnabled
      );
    }
    case 'elevenlabs': {
      if (!settings.elevenLabsKey) return false;
      const voiceId =
        lang === 'zh'
          ? settings.elevenLabsZhVoiceId || settings.elevenLabsVoiceId
          : settings.elevenLabsVoiceId || 'XB0fDUnXU5powFXDhCwa';
      return fetchAndPlay(
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
        },
        `eleven-${voiceId}-${text}`,
        !!settings.cacheEnabled
      );
    }
    case 'aliyun': {
      if (!settings.aliyunKey) return false;
      return fetchAndPlay('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal/multimodal-synthesis', {
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
      }, `aliyun-${settings.aliyunVoice || 'Cherry'}-${text}`, !!settings.cacheEnabled);
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
  try {
    const played = await speakWithProvider(text, settings);
    if (played) return;
  } catch {
    // fall back to native
  }
  speakWithNative(text, rate, opts?.language);
}

export async function stopSpeaking(): Promise<void> {
  if (Platform.OS === 'web') {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void } };
    w.speechSynthesis?.cancel();
  }
  Speech.stop();
  if (player) {
    player.pause();
  }
}

export async function clearAudioCache(): Promise<number> {
  try {
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
