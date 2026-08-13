import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router';
import { ThemeProvider } from './components/ThemeProvider';
import { SyncProvider } from './components/SyncProvider';
import { UserSettingsProvider } from './components/UserSettingsProvider';
import Home from './pages/Home';
import Study from './pages/Study';
import Decks from './pages/Decks';
import DeckDetail from './pages/DeckDetail';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"
import TypeTraining from './pages/TypeTraining';
import Podcast from './pages/Podcast';
import PodcastPlayer from './pages/PodcastPlayer';
import { getLanguage, type Language } from './i18n/translations';

export default function App() {
  const [lang, setLang] = useState<Language>(getLanguage());

  useEffect(() => {
    const handleLangChange = (e: Event) => {
      setLang((e as CustomEvent<Language>).detail);
    };
    window.addEventListener('moyan:lang-change', handleLangChange);
    return () => window.removeEventListener('moyan:lang-change', handleLangChange);
  }, []);

  return (
    <ThemeProvider>
      <UserSettingsProvider>
        <SyncProvider>
          <div key={lang}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/study" element={<Study />} />
              <Route path="/decks" element={<Decks />} />
              <Route path="/decks/:id" element={<DeckDetail />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/login" element={<Login />} />
              <Route path="/type" element={<TypeTraining />} />
              <Route path="/podcast" element={<Podcast />} />
              <Route path="/podcast/player" element={<PodcastPlayer />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </SyncProvider>
      </UserSettingsProvider>
    </ThemeProvider>
  );
}
