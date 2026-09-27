import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

export interface SttPermission {
  granted: boolean;
  reason?: 'denied' | 'restricted';
}

export interface SttCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onVolume: (value: number) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}

export interface SttSession {
  stop: () => void;
  abort: () => void;
}

interface Subscription {
  remove: () => void;
}

export interface SpeechModuleLike {
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>;
  start: (options: ExpoSpeechRecognitionOptions) => void;
  stop: () => void;
  abort: () => void;
  addListener: (
    event: 'result' | 'volumechange' | 'error' | 'end',
    listener: (event: unknown) => void
  ) => Subscription;
}

export function createSttAdapter(module: SpeechModuleLike) {
  return {
    async requestPermissions(): Promise<SttPermission> {
      try {
        const result = await module.requestPermissionsAsync();
        return result.granted
          ? { granted: true }
          : { granted: false, reason: result.canAskAgain === false ? 'denied' : 'restricted' };
      } catch {
        return { granted: false, reason: 'restricted' };
      }
    },

    async start(locale: string, callbacks: SttCallbacks): Promise<SttSession> {
      const permission = await this.requestPermissions();
      if (!permission.granted) {
        throw new Error(permission.reason === 'denied' ? 'permission-denied' : 'permission-restricted');
      }

      const subscriptions: Subscription[] = [
        module.addListener('result', (raw) => {
          const event = raw as ExpoSpeechRecognitionResultEvent;
          const transcript = event.results[0]?.transcript ?? '';
          if (!transcript) return;
          if (event.isFinal) callbacks.onFinal(transcript.trim());
          else callbacks.onInterim(transcript.trim());
        }),
        module.addListener('volumechange', (raw) => {
          const event = raw as { value: number };
          callbacks.onVolume(Math.max(-2, Math.min(10, event.value)));
        }),
        module.addListener('error', (raw) => {
          const event = raw as ExpoSpeechRecognitionErrorEvent;
          callbacks.onError(event.message || event.error);
        }),
        module.addListener('end', () => callbacks.onEnd()),
      ];

      const cleanup = () => subscriptions.forEach((subscription) => subscription.remove());
      module.start({
        lang: locale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        requiresOnDeviceRecognition: false,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'measurement',
        },
        recordingOptions: { persist: false },
      });

      return {
        stop: () => {
          module.stop();
          cleanup();
        },
        abort: () => {
          module.abort();
          cleanup();
        },
      };
    },
  };
}

async function defaultAdapter() {
  const module = await import('expo-speech-recognition');
  return createSttAdapter(module.ExpoSpeechRecognitionModule);
}

export const requestMicPermissions = async () =>
  (await defaultAdapter()).requestPermissions();
export const startListening = async (locale: string, callbacks: SttCallbacks) =>
  (await defaultAdapter()).start(locale, callbacks);
