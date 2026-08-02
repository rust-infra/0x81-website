import { useLocation, useNavigate } from 'react-router';
import { Home, LibraryBig, BarChart3, Settings } from 'lucide-react';
import { t } from '../i18n/translations';

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', icon: Home, label: t('home.nav.decks') },
    { path: '/decks', icon: LibraryBig, label: t('decks.title') },
    { path: '/stats', icon: BarChart3, label: t('stats.title') },
    { path: '/settings', icon: Settings, label: t('settings.title') },
  ];

  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
      <div
        className="rounded-full px-6 py-3 flex items-center gap-8"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center gap-0.5 transition-all duration-300"
              style={{ color: isActive ? 'var(--ink)' : 'var(--ink-light)' }}
            >
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.5}
                className={`transition-transform duration-300 ${isActive ? 'scale-110' : ''}`}
              />
              <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
