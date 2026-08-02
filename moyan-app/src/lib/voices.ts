// 语音音色列表（与 moyan-web speechService 一致）

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
}

/** 获取系统（webspeech）可用音色：原生走 expo-speech，web 走 speechSynthesis */
export async function getWebspeechVoices(): Promise<VoiceOption[]> {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = (window as unknown as {
      speechSynthesis?: {
        getVoices?: () => Array<{ voiceURI: string; name: string; lang: string }>;
        addEventListener?: (ev: string, cb: () => void) => void;
        removeEventListener?: (ev: string, cb: () => void) => void;
      };
    }).speechSynthesis;
    const mapVoices = () =>
      (synth?.getVoices?.() || []).map((v) => ({
        id: v.voiceURI,
        name: `${v.name} (${v.lang})`,
        language: v.lang,
      }));
    if (!synth || !synth.getVoices) return [];
    const initial = mapVoices();
    if (initial.length > 0) return initial;
    // 浏览器音色异步加载，等待 voiceschanged（超时兜底）
    return await new Promise<VoiceOption[]>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(mapVoices());
      };
      const cleanup = () => {
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', finish);
      };
      const timer = setTimeout(finish, 3000);
      synth.addEventListener?.('voiceschanged', finish);
    });
  }
  try {
    const Speech = await import('expo-speech');
    const list = await Speech.getAvailableVoicesAsync();
    return list.map((v: { identifier: string; name: string; language: string }) => ({
      id: v.identifier,
      name: `${v.name} (${v.language})`,
      language: v.language,
    }));
  } catch {
    return [];
  }
}

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

export const GOOGLE_VOICES: VoiceOption[] = [
  { id: 'en-US-Neural2-D', name: 'Neural2-D (Male)', language: 'en-US' },
  { id: 'en-US-Neural2-F', name: 'Neural2-F (Female)', language: 'en-US' },
  { id: 'en-US-Neural2-A', name: 'Neural2-A (Male)', language: 'en-US' },
  { id: 'en-US-Neural2-C', name: 'Neural2-C (Male)', language: 'en-US' },
  { id: 'en-US-Journey-D', name: 'Journey-D (Male)', language: 'en-US' },
  { id: 'en-US-Journey-F', name: 'Journey-F (Female)', language: 'en-US' },
  { id: 'en-US-Studio-O', name: 'Studio-O (Female)', language: 'en-US' },
  { id: 'en-US-Studio-Q', name: 'Studio-Q (Male)', language: 'en-US' },
  { id: 'en-GB-Neural2-B', name: 'Neural2-B (Male, British)', language: 'en-GB' },
  { id: 'en-GB-Neural2-C', name: 'Neural2-C (Female, British)', language: 'en-GB' },
  { id: 'en-AU-Neural2-A', name: 'Neural2-A (Female, Australian)', language: 'en-AU' },
  { id: 'en-AU-Neural2-B', name: 'Neural2-B (Male, Australian)', language: 'en-AU' },
];

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

export function voicesForProvider(
  provider: string | undefined,
  zh: boolean
): VoiceOption[] {
  switch (provider) {
    case 'google':
      return zh ? GOOGLE_ZH_VOICES : GOOGLE_VOICES;
    case 'elevenlabs':
      return ELEVENLABS_VOICES;
    case 'aliyun':
      return ALIYUN_VOICES;
    default:
      return [];
  }
}
