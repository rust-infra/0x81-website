import type { RecordingOptions } from 'expo-audio';

export const CLOUD_RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'aac ',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
} satisfies RecordingOptions;

export function sttMimeTypeForUri(uri: string): string {
  const path = uri.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.webm')) return 'audio/webm';
  if (path.endsWith('.3gp')) return 'audio/3gpp';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.flac')) return 'audio/flac';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/m4a';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + chunk)));
  }
  return btoa(binary);
}

export async function readRecordingBase64(uri: string): Promise<{
  audioBase64: string;
  mimeType: string;
}> {
  // Web 的录音器给的是 `blob:` URL，expo-file-system 的 File 不认它
  // （`this.validatePath is not a function`）。blob/data URL 直接 fetch，
  // 顺带用响应头里的类型——blob URL 的路径里没有扩展名，按扩展名猜会得到 m4a。
  if (uri.startsWith('blob:') || uri.startsWith('data:')) {
    const response = await fetch(uri);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const headerType = response.headers.get('content-type')?.split(';')[0]?.trim();
    return {
      audioBase64: bytesToBase64(bytes),
      mimeType: headerType || 'audio/webm',
    };
  }
  const { File } = await import('expo-file-system');
  const bytes = new Uint8Array(await new File(uri).arrayBuffer());
  return {
    audioBase64: bytesToBase64(bytes),
    mimeType: sttMimeTypeForUri(uri),
  };
}
