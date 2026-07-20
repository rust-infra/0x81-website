import { useTheme } from './ThemeProvider';
import { Check, Palette } from 'lucide-react';
import { t as translate } from '../i18n/translations';

export default function ThemePanel() {
  const { theme, themeName, setTheme, themes } = useTheme();

  return (
    <div className="space-y-5">
      {/* 当前主题展示 */}
      <div className="flex items-center gap-3 px-1">
        <div
          className="w-10 h-10 rounded-xl border-2 border-current/20 flex items-center justify-center transition"
          style={{ backgroundColor: theme.preview }}
        >
          <Palette size={18} style={{ color: theme.colors.ink }} />
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {theme.label}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--ink-light)' }}>
            {theme.description}
          </p>
        </div>
      </div>

      {/* 主题网格 */}
      <div className="grid grid-cols-2 gap-3">
        {themes.map(tm => {
          const isActive = tm.name === themeName;
          return (
            <button
              key={tm.name}
              onClick={() => setTheme(tm.name)}
              className="relative rounded-2xl p-4 text-left transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: tm.preview,
                border: `2px solid ${isActive ? tm.colors.accent : 'transparent'}`,
                boxShadow: isActive ? `0 0 0 1px ${tm.colors.accent}40` : 'none',
              }}
            >
              {/* Active indicator */}
              {isActive && (
                <div
                  className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: tm.colors.accent }}
                >
                  <Check size={12} color="#fff" strokeWidth={3} />
                </div>
              )}

              {/* Theme preview */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-1">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: tm.colors.ink }}
                  />
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: tm.colors.accent }}
                  />
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: tm.colors.card, border: `1px solid ${tm.colors.border}` }}
                  />
                </div>
              </div>

              <p
                className="text-sm font-medium mb-0.5"
                style={{ color: tm.colors.ink }}
              >
                {translate('theme.' + tm.name + '.label')}
              </p>
              <p
                className="text-[11px]"
                style={{ color: tm.colors.inkLight }}
              >
                {translate('theme.' + tm.name + '.desc')}
              </p>
            </button>
          );
        })}
      </div>

      {/* Theme hint */}
      <p className="text-[11px] text-center" style={{ color: 'var(--ink-muted)' }}>
        {translate('settings.theme.hint')}
      </p>
    </div>
  );
}
