import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { applyTheme, setTheme, type ThemeName, type Theme, THEMES } from '../theme';

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[0],
  themeName: 'xuanzhi',
  setTheme: () => {},
  themes: THEMES,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('app_theme') as ThemeName | null;
    return saved || 'xuanzhi';
  });

  const theme = THEMES.find(t => t.name === themeName) || THEMES[0];

  useEffect(() => {
    applyTheme(themeName);
  }, [themeName]);

  const handleSetTheme = useCallback((name: ThemeName) => {
    setTheme(name);
    setThemeName(name);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeName, setTheme: handleSetTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
