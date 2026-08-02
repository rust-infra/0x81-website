import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { translations, type Lang } from './translations';

const LANG_KEY = 'app_language';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh-CN',
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh-CN');

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY)
      .then((v) => {
        if (v === 'zh-CN' || v === 'en') setLangState(v);
      })
      .catch(() => {});
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    let text = translations[lang][key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
