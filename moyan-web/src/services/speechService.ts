// 统一语音服务层 - 支持多语音源切换
// 支持: Web Speech API (免费) | ElevenLabs API (高质量)

// 语音服务层 - 不依赖 db，配置存储在 localStorage

// ==================== 类型定义 ====================

export type SpeechProvider = 'webspeech' | 'elevenlabs' | 'google' | 'aliyun';

export interface SpeechSettings {
  provider: SpeechProvider;
  elevenLabsKey: string;
  elevenLabsVoiceId: string;
  elevenLabsZhVoiceId: string;
  elevenLabsModel: string;
  googleKey: string;
  googleVoice: string;
  googleZhVoice: string;
  googleLanguage: string;
  aliyunKey: string;
  aliyunVoice: string;
  aliyunModel: string;
  rate: number;
  autoPlay: boolean;
  cacheEnabled: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  preview?: string;
}

// ==================== 默认配置 ====================

const DEFAULT_SETTINGS: SpeechSettings = {
  provider: 'webspeech',
  elevenLabsKey: '',
  elevenLabsVoiceId: 'XB0fDUnXU5powFXDhCwa',
  elevenLabsZhVoiceId: 'XB0fDUnXU5powFXDhCwa',
  elevenLabsModel: 'eleven_turbo_v2_5',
  googleKey: '',
  googleVoice: 'en-US-Neural2-D',
  googleZhVoice: 'cmn-CN-Neural2-D',
  googleLanguage: 'en-US',
  aliyunKey: '',
  aliyunVoice: 'Cherry',
  aliyunModel: 'qwen-tts',
  rate: 0.9,
  autoPlay: false,
  cacheEnabled: true,
};

// ElevenLabs 推荐语音列表
export const ELEVENLABS_VOICES: VoiceOption[] = [
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'English Male (Default)', language: 'en' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', language: 'en' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', language: 'en' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', language: 'en' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', language: 'en' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', language: 'en' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', language: 'en' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', language: 'en' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', language: 'en' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', language: 'en' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', language: 'en' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', language: 'en' },
];

// Google Cloud TTS 推荐语音列表
export const GOOGLE_VOICES: VoiceOption[] = [
  { id: 'en-US-Neural2-D', name: 'Neural2-D (Male)', language: 'en-US' },
  { id: 'en-US-Neural2-F', name: 'Neural2-F (Female)', language: 'en-US' },
  { id: 'en-US-Neural2-A', name: 'Neural2-A (Male)', language: 'en-US' },
  { id: 'en-US-Neural2-C', name: 'Neural2-C (Male)', language: 'en-US' },
  { id: 'en-US-Neural2-E', name: 'Neural2-E (Female)', language: 'en-US' },
  { id: 'en-US-Journey-D', name: 'Journey-D (Male)', language: 'en-US' },
  { id: 'en-US-Journey-F', name: 'Journey-F (Female)', language: 'en-US' },
  { id: 'en-US-Studio-O', name: 'Studio-O (Female)', language: 'en-US' },
  { id: 'en-US-Studio-Q', name: 'Studio-Q (Male)', language: 'en-US' },
  { id: 'en-GB-Neural2-B', name: 'Neural2-B (Male, British)', language: 'en-GB' },
  { id: 'en-GB-Neural2-C', name: 'Neural2-C (Female, British)', language: 'en-GB' },
  { id: 'en-AU-Neural2-A', name: 'Neural2-A (Female, Australian)', language: 'en-AU' },
  { id: 'en-AU-Neural2-B', name: 'Neural2-B (Male, Australian)', language: 'en-AU' },
  { id: 'en-IN-Neural2-A', name: 'Neural2-A (Female, Indian)', language: 'en-IN' },
  { id: 'en-IN-Neural2-B', name: 'Neural2-B (Male, Indian)', language: 'en-IN' },
];

// Google Cloud TTS 中文语音列表
export const GOOGLE_ZH_VOICES: VoiceOption[] = [
  { id: 'cmn-CN-Neural2-D', name: 'Neural2-D (中文男声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Neural2-A', name: 'Neural2-A (中文女声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Neural2-B', name: 'Neural2-B (中文男声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Neural2-C', name: 'Neural2-C (中文女声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Wavenet-B', name: 'Wavenet-B (中文女声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Wavenet-C', name: 'Wavenet-C (中文男声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Standard-A', name: 'Standard-A (中文女声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Standard-B', name: 'Standard-B (中文男声)', language: 'cmn-CN' },
  { id: 'cmn-CN-Standard-C', name: 'Standard-C (中文男声)', language: 'cmn-CN' },
  { id: 'yue-CN-Standard-A', name: '粤语-Standard-A', language: 'yue-CN' },
  { id: 'yue-CN-Standard-B', name: '粤语-Standard-B', language: 'yue-CN' },
  { id: 'cmn-TW-Standard-A', name: '台湾-Standard-A', language: 'cmn-TW' },
  { id: 'cmn-TW-Standard-B', name: '台湾-Standard-B', language: 'cmn-TW' },
];

// 阿里云百炼 TTS 音色列表
export const ALIYUN_VOICES: VoiceOption[] = [
  { id: 'Cherry', name: '芊悦', language: 'zh/en' },
  { id: 'Serena', name: '苏瑶', language: 'zh/en' },
  { id: 'Ethan', name: '晨煦', language: 'zh/en' },
  { id: 'Chelsie', name: '千雪', language: 'zh/en' },
  { id: 'Momo', name: '茉兔', language: 'zh/en' },
  { id: 'Vivian', name: '十三', language: 'zh/en' },
  { id: 'Moon', name: '月白', language: 'zh/en' },
  { id: 'Kai', name: '凯', language: 'zh/en' },
  { id: 'Elias', name: '墨讲师', language: 'zh/en' },
  { id: 'Jennifer', name: '詹妮弗', language: 'en' },
  { id: 'Ryan', name: '甜茶', language: 'en' },
  { id: 'Aiden', name: '艾登', language: 'en' },
  { id: 'Andre', name: '安德雷', language: 'en' },
  { id: 'Maia', name: '四月', language: 'zh/en' },
  { id: 'Neil', name: '阿闻', language: 'zh/en' },
  { id: 'Nini', name: '邻家妹妹', language: 'zh/en' },
  { id: 'Seren', name: '小婉', language: 'zh/en' },
  { id: 'Mia', name: '乖小妹', language: 'zh/en' },
  { id: 'Jada', name: '上海-阿珍', language: 'zh/en' },
  { id: 'Dylan', name: '北京-晓东', language: 'zh/en' },
  { id: 'Sunny', name: '四川-晴儿', language: 'zh/en' },
  { id: 'Rocky', name: '粤语-阿强', language: 'zh/en' },
  { id: 'Kiki', name: '粤语-阿清', language: 'zh/en' },
];

const SETTINGS_KEY = 'speech_settings';
let audioCache = new Map<string, HTMLAudioElement>();
let currentAudio: HTMLAudioElement | null = null;

// ==================== 设置管理 ====================

export function getSpeechSettings(): SpeechSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 合并默认值（处理新增字段）
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSpeechSettings(settings: SpeechSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resetSpeechSettings(): SpeechSettings {
  localStorage.removeItem(SETTINGS_KEY);
  audioCache.clear();
  return { ...DEFAULT_SETTINGS };
}

// ==================== Web Speech API ====================

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function getWebSpeechVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices) return cachedVoices;
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

export function preloadWebSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      cachedVoices = voices;
      resolve(voices);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
  });
}

function detectLanguage(text: string): 'en' | 'zh' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

function speakWithWebSpeech(text: string, rate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('浏览器不支持语音合成'));
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const lang = detectLanguage(text);
    const voices = getWebSpeechVoices();

    if (voices.length > 0) {
      const voice = voices.find(v =>
        lang === 'en'
          ? (v.lang.startsWith('en-US') || v.lang.startsWith('en-GB'))
          : (v.lang.startsWith('zh-CN') || v.lang.startsWith('zh-TW'))
      ) || voices[0];
      utterance.voice = voice;
    }
    utterance.lang = lang === 'en' ? 'en-US' : 'zh-CN';
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => {
      if (e.error === 'canceled') resolve();
      else reject(new Error(`语音播放失败: ${e.error}`));
    };

    window.speechSynthesis.speak(utterance);
  });
}

// ==================== ElevenLabs API ====================

// 音频缓存键
function getCacheKey(text: string, voiceId: string): string {
  return `${voiceId}_${text.slice(0, 50)}`;
}

async function fetchElevenLabsAudio(
  text: string,
  apiKey: string,
  voiceId: string,
  model: string
): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API 错误: ${response.status} - ${error}`);
  }

  return response.arrayBuffer();
}

async function speakWithElevenLabs(
  text: string,
  settings: SpeechSettings
): Promise<void> {
  const { elevenLabsKey, elevenLabsVoiceId, elevenLabsModel, cacheEnabled } = settings;
  if (!elevenLabsKey) {
    throw new Error('请先配置 ElevenLabs API Key');
  }

  // 停止当前播放
  stopAllAudio();

  const cacheKey = getCacheKey(text, elevenLabsVoiceId);

  // 检查缓存（仅当 cacheEnabled 为 true 时）
  let audio = cacheEnabled ? audioCache.get(cacheKey) : undefined;

  if (!audio) {
    try {
      const audioData = await fetchElevenLabsAudio(
        text,
        elevenLabsKey,
        elevenLabsVoiceId,
        elevenLabsModel
      );
      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      if (cacheEnabled) {
        audioCache.set(cacheKey, audio);
      }
    } catch (err: any) {
      // 缓存失败降级到 Web Speech
      console.warn('ElevenLabs 失败，降级到 Web Speech:', err);
      await speakWithWebSpeech(text, settings.rate);
      return;
    }
  }

  if (audio) {
    currentAudio = audio;
    audio.currentTime = 0;

    return new Promise((resolve, reject) => {
      audio!.onended = () => {
        currentAudio = null;
        resolve();
      };
      audio!.onerror = () => {
        currentAudio = null;
        reject(new Error('音频播放失败'));
      };
      audio!.play().catch(reject);
    });
  }
}

// ==================== Google Cloud TTS ====================

async function speakWithGoogle(text: string, settings: SpeechSettings): Promise<void> {
  const { googleKey, googleVoice, googleLanguage, rate, cacheEnabled } = settings;
  if (!googleKey) {
    throw new Error('请先配置 Google Cloud API Key');
  }

  stopAllAudio();

  const cacheKey = `google_${googleVoice}_${text.slice(0, 50)}`;
  let audio = cacheEnabled ? audioCache.get(cacheKey) : undefined;

  if (!audio) {
    try {
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode: googleLanguage,
              name: googleVoice,
            },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: rate,
              pitch: 0,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Google TTS 错误: ${response.status}`);
      }

      const data = await response.json();
      const audioData = atob(data.audioContent);
      const arrayBuffer = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        arrayBuffer[i] = audioData.charCodeAt(i);
      }
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      if (cacheEnabled) {
        audioCache.set(cacheKey, audio);
      }
    } catch (err: any) {
      console.warn('Google TTS 失败，降级到 Web Speech:', err);
      await speakWithWebSpeech(text, rate);
      return;
    }
  }

  if (audio) {
    currentAudio = audio;
    audio.currentTime = 0;
    return new Promise((resolve, reject) => {
      audio!.onended = () => {
        currentAudio = null;
        resolve();
      };
      audio!.onerror = () => {
        currentAudio = null;
        reject(new Error('音频播放失败'));
      };
      audio!.play().catch(reject);
    });
  }
}

// ==================== 阿里云百炼 TTS ====================

const ALIYUN_TTS_API = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal/multimodal-synthesis';

async function speakWithAliyun(text: string, settings: SpeechSettings): Promise<void> {
  const { aliyunKey, aliyunVoice, aliyunModel, cacheEnabled } = settings;
  if (!aliyunKey) {
    throw new Error('请先配置阿里云百炼 API Key');
  }

  stopAllAudio();

  const cacheKey = `aliyun_${aliyunVoice}_${text.slice(0, 50)}`;
  let audio = cacheEnabled ? audioCache.get(cacheKey) : undefined;

  if (!audio) {
    try {
      const response = await fetch(ALIYUN_TTS_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliyunKey}`,
        },
        body: JSON.stringify({
          model: aliyunModel || 'qwen-tts',
          input: { text },
          parameters: {
            voice: aliyunVoice || 'Cherry',
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`阿里云 TTS 错误 ${response.status}: ${errText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      if (cacheEnabled) {
        audioCache.set(cacheKey, audio);
      }
    } catch (err: any) {
      console.warn('阿里云 TTS 失败，降级到 Web Speech:', err);
      await speakWithWebSpeech(text, settings.rate);
      return;
    }
  }

  if (audio) {
    currentAudio = audio;
    audio.currentTime = 0;
    return new Promise((resolve, reject) => {
      audio!.onended = () => {
        currentAudio = null;
        resolve();
      };
      audio!.onerror = () => {
        currentAudio = null;
        reject(new Error('音频播放失败'));
      };
      audio!.play().catch(reject);
    });
  }
}

// ==================== 中英文分段播放 ====================

interface LangSegment {
  text: string;
  lang: 'en' | 'zh';
}

/** Split mixed Chinese/English text into language segments */
function splitByLanguage(text: string): LangSegment[] {
  const segments: LangSegment[] = [];
  let current = '';
  let currentLang: 'en' | 'zh' | null = null;

  for (const char of text) {
    const charLang: 'en' | 'zh' = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 'zh' : 'en';
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

/** Check if text contains both Chinese and English */
function isBilingual(text: string): boolean {
  const segments = splitByLanguage(text);
  return segments.length > 1 && segments.some(s => s.lang === 'zh') && segments.some(s => s.lang === 'en');
}

/** Speak with Google TTS using the configured Chinese voice */
async function speakWithGoogleZh(text: string, settings: SpeechSettings): Promise<void> {
  const { googleKey, googleZhVoice, rate } = settings;
  if (!googleKey) {
    await speakWithWebSpeech(text, settings.rate);
    return;
  }

  // Don't stop audio here - we're playing a sequence
  const cacheKey = `google_${googleZhVoice}_${text.slice(0, 50)}`;
  let audio = cacheEnabled ? audioCache.get(cacheKey) : undefined;

  if (!audio) {
    try {
      const voiceOpt = GOOGLE_ZH_VOICES.find(v => v.id === googleZhVoice);
      const languageCode = voiceOpt?.language || 'cmn-CN';
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode,
              name: googleZhVoice || 'cmn-CN-Neural2-D',
            },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: rate,
              pitch: 0,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Google TTS Chinese error: ${response.status}`);
      }

      const data = await response.json();
      const audioData = atob(data.audioContent);
      const arrayBuffer = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        arrayBuffer[i] = audioData.charCodeAt(i);
      }
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audioCache.set(cacheKey, audio);
    } catch {
      await speakWithWebSpeech(text, rate);
      return;
    }
  }

  if (audio) {
    currentAudio = audio;
    audio.currentTime = 0;
    return new Promise((resolve, reject) => {
      audio!.onended = () => {
        currentAudio = null;
        resolve();
      };
      audio!.onerror = () => {
        currentAudio = null;
        reject(new Error('音频播放失败'));
      };
      audio!.play().catch(reject);
    });
  }
}

/** Speak a single segment without splitting (internal, no bilingual detection) */
async function speakSegment(text: string, settings: SpeechSettings): Promise<void> {
  if (!text.trim()) return;

  switch (settings.provider) {
    case 'elevenlabs':
      await speakWithElevenLabs(text, settings);
      break;
    case 'google':
      await speakWithGoogle(text, settings);
      break;
    case 'aliyun':
      await speakWithAliyun(text, settings);
      break;
    case 'webspeech':
    default:
      await speakWithWebSpeech(text, settings.rate);
      break;
  }
}

/** Speak Chinese segment with correct voice per provider */
async function speakZhSegment(text: string, settings: SpeechSettings): Promise<void> {
  if (!text.trim()) return;

  switch (settings.provider) {
    case 'google':
      // Use dedicated Chinese voice for Google TTS
      await speakWithGoogleZh(text, settings);
      break;
    case 'webspeech':
      // Web Speech picks voice by utterance.lang, works well for Chinese
      await speakWithWebSpeech(text, settings.rate);
      break;
    default:
      // ElevenLabs/Aliyun handle Chinese reasonably in their multilingual voices
      await speakSegment(text, settings);
      break;
  }
}

// ==================== 统一接口 ====================

export async function speak(text: string): Promise<void> {
  const settings = getSpeechSettings();

  if (!text.trim()) return;

  // If text is bilingual (mixed Chinese + English), split and speak each segment
  if (isBilingual(text)) {
    const segments = splitByLanguage(text);
    for (const seg of segments) {
      if (seg.lang === 'zh') {
        await speakZhSegment(seg.text, settings);
      } else {
        await speakSegment(seg.text, settings);
      }
      // Small pause between language segments
      await new Promise(r => setTimeout(r, 200));
    }
    return;
  }

  // Single language - direct playback
  await speakSegment(text, settings);
}

export function stopAllAudio(): void {
  // 停止 Web Speech
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  // 停止 ElevenLabs 音频
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

export async function speakSequence(texts: string[]): Promise<void> {
  for (const text of texts) {
    if (text.trim()) {
      await speak(text);
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// 清理音频缓存（防止内存泄漏）
export function clearAudioCache(): void {
  audioCache.forEach((audio) => {
    if (audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src);
    }
  });
  audioCache.clear();
}

// 获取当前语音源名称
export function getProviderLabel(provider: SpeechProvider): string {
  switch (provider) {
    case 'elevenlabs': return 'ElevenLabs AI 语音';
    case 'google': return 'Google Cloud 语音';
    case 'aliyun': return '阿里云百炼 TTS';
    case 'webspeech': return '浏览器内置语音';
    default: return '浏览器内置语音';
  }
}

// 获取缓存大小
export function getAudioCacheSize(): number {
  return audioCache.size;
}
