// 跨平台朗读：原生用 expo-speech，Web 调试用浏览器 speechSynthesis
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

export function speak(
  text: string,
  opts?: { language?: string; rate?: number }
): void {
  if (!text.trim()) return;
  if (Platform.OS === 'web') {
    const w = window as unknown as {
      speechSynthesis?: {
        cancel: () => void;
        speak: (u: unknown) => void;
      };
      SpeechSynthesisUtterance?: new (t: string) => {
        lang: string;
        rate: number;
      };
    };
    if (w.speechSynthesis && w.SpeechSynthesisUtterance) {
      w.speechSynthesis.cancel();
      const u = new w.SpeechSynthesisUtterance(text);
      u.lang = opts?.language || 'en-US';
      u.rate = opts?.rate ?? 1;
      w.speechSynthesis.speak(u);
    }
    return;
  }
  Speech.stop();
  Speech.speak(text, { language: opts?.language || 'en-US', rate: opts?.rate ?? 1 });
}

export function stopSpeaking(): void {
  if (Platform.OS === 'web') {
    const w = window as unknown as {
      speechSynthesis?: { cancel: () => void };
    };
    w.speechSynthesis?.cancel();
    return;
  }
  Speech.stop();
}
