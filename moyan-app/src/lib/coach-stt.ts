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

export function sttLocaleFor(locale: string): string {
  return ['en-US', 'en-GB', 'en-IN', 'en-AU'].includes(locale)
    ? locale
    : 'en-US';
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

    async start(
      locale: string,
      callbacks: SttCallbacks,
      contextualStrings: string[] = []
    ): Promise<SttSession> {
      const permission = await this.requestPermissions();
      if (!permission.granted) {
        throw new Error(permission.reason === 'denied' ? 'permission-denied' : 'permission-restricted');
      }

      let cleaned = false;
      const cleanup = () => subscriptions.forEach((subscription) => subscription.remove());
      const finish = (callback: () => void) => {
        if (cleaned) return;
        cleaned = true;
        cleanup();
        callback();
      };

      const subscriptions: Subscription[] = [
        module.addListener('result', (raw) => {
          const event = raw as ExpoSpeechRecognitionResultEvent;
          const transcript = event.results[0]?.transcript ?? '';
          if (!transcript) return;
          if (event.isFinal) finish(() => callbacks.onFinal(transcript.trim()));
          else callbacks.onInterim(transcript.trim());
        }),
        module.addListener('volumechange', (raw) => {
          const event = raw as { value: number };
          callbacks.onVolume(Math.max(-2, Math.min(10, event.value)));
        }),
        module.addListener('error', (raw) => {
          const event = raw as ExpoSpeechRecognitionErrorEvent;
          finish(() => {
            module.abort();
            callbacks.onError(event.message || event.error);
          });
        }),
        module.addListener('end', () => finish(() => callbacks.onEnd())),
      ];
      module.start({
        lang: locale,
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
        requiresOnDeviceRecognition: false,
        maxAlternatives: 1,
        contextualStrings: Array.from(
          new Set(contextualStrings.map((value) => value.trim()).filter(Boolean))
        ).slice(0, 20),
        iosTaskHint: 'dictation',
        volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'voiceChat',
        },
        recordingOptions: { persist: false },
      });

      return {
        stop: () => {
          if (cleaned) return;
          cleaned = true;
          cleanup();
          module.stop();
        },
        abort: () => {
          if (cleaned) return;
          cleaned = true;
          cleanup();
          module.abort();
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
export const startListening = async (
  locale: string,
  callbacks: SttCallbacks,
  contextualStrings: string[] = []
) => (await defaultAdapter()).start(locale, callbacks, contextualStrings);
