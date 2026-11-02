import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { migrateThemeName, THEMES, type Theme, type ThemeName } from './theme';

const THEME_KEY = 'app_theme';
const DEFAULT_THEME: ThemeName = 'light';

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[0],
  themeName: DEFAULT_THEME,
  setTheme: () => {},
  themes: THEMES,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((saved) => {
        // 老版本存的是 4 套皮肤的名字，迁移成 light/dark 而不是丢弃。
        const migrated = migrateThemeName(saved);
        if (migrated && migrated !== saved) {
          AsyncStorage.setItem(THEME_KEY, migrated).catch(() => {});
        }
        if (migrated) setThemeName(migrated);
      })
      .catch(() => {});
  }, []);

  const setTheme = (name: ThemeName) => {
    setThemeName(name);
    AsyncStorage.setItem(THEME_KEY, name).catch(() => {});
  };

  const theme = THEMES.find((t) => t.name === themeName) || THEMES[0];

  return (
    <ThemeContext.Provider value={{ theme, themeName, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
