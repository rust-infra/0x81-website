import type { SyncedSpeechSettings, SyncedUserSettings } from './rehearse-types';
import type { SpeechSettings } from './speech';

/**
 * 这些键是凭据，**永不出本机**（设计稿 §7.5.1）。服务端也会拒绝带它们的文档，
 * 所以这里除了「不发」还负责「收回来时忽略」——两边都防一层。
 */
const SECRET_KEYS = [
  'googleKey',
  'elevenLabsKey',
  'aliyunKey',
  'googleCloudServiceAccountJson',
  'geminiApiKey',
] as const;

/**
 * 远端文档是别的设备写的，`Object.entries` 拿到的键里可能有原型链上的名字。
 * 直接赋值 `merged['__proto__']` 会改掉对象的原型，属于跨设备的原型污染。
 */
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

/** 把本机设置整理成上传文档：只挑非凭据字段。 */
export function buildSyncedSettings(
  theme: string,
  language: string,
  speech: SpeechSettings | null
): SyncedUserSettings {
  const doc: SyncedSpeechSettings = {};
  if (speech) {
    for (const [key, value] of Object.entries(speech)) {
      if (value === undefined || isIgnoredKey(key)) continue;
      (doc as Record<string, unknown>)[key] = value;
    }
  }
  return { theme, language, speech: doc };
}

/**
 * 把远端文档合并进本机设置。
 *
 * 凭据字段一律以本机为准：远端就算带了（旧版本或别的客户端写的），也不覆盖。
 * 非凭据字段以远端为准——调用方只在「远端比本机新」时才走到这里。
 */
export function applySyncedSettings(
  remote: SyncedUserSettings,
  local: SpeechSettings
): SpeechSettings {
  const merged: SpeechSettings = { ...local };
  const speech = remote.speech;
  // 服务端只放行对象，但文档是别的设备写的：非对象（含 null / 数组）直接忽略，
  // 别让 Object.entries 把字符串拆成字符键塞进设置。
  if (!speech || typeof speech !== 'object' || Array.isArray(speech)) return merged;
  for (const [key, value] of Object.entries(speech)) {
    if (value === undefined || isIgnoredKey(key)) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function isIgnoredKey(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key) || UNSAFE_KEYS.includes(key);
}
