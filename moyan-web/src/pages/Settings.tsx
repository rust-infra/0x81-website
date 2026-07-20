import { useState, useRef, useEffect } from 'react';
import { Download, Upload, Trash2, FileText, Mic, Palette, LogIn, LogOut, User, Cloud, Globe, Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import BottomNav from '../components/BottomNav';
import ThemePanel from '../components/ThemePanel';
import SpeechSettingsPanel from '../components/SpeechSettingsPanel';
import { db } from '../db';
import { exportAnkiPackage } from '../services/anki';
import { clearAudioCache } from '../services/speechService';
import { getCurrentUser, onAuthChange, logout, type User as UserType } from '../services/authService';
import { t, setLanguage, getLanguage, type Language } from '../i18n/translations';
import {
  formatSettingsSyncTimestamp,
  getSettingsSyncEventName,
  getLatestSettingsSavedTimestamp,
  getLatestSettingsSyncState,
  type SettingsSyncState,
} from '../services/userSettingsService';

type Tab = 'general' | 'voice' | 'theme';

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState<UserType | null>(null);
  const [settingsSyncState, setSettingsSyncState] = useState<SettingsSyncState | null>(
    () => getLatestSettingsSyncState()
  );
  const [lastSavedSettingsAt, setLastSavedSettingsAt] = useState<number | null>(
    () => getLatestSettingsSavedTimestamp()
  );

  useEffect(() => {
    setUser(getCurrentUser());
    const unsub = onAuthChange((u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    setSettingsSyncState(getLatestSettingsSyncState());
    setLastSavedSettingsAt(getLatestSettingsSavedTimestamp());

    const handleSettingsSync = (event: Event) => {
      const detail = (event as CustomEvent<SettingsSyncState>).detail;
      setSettingsSyncState(detail);
      if (detail.phase === 'save' && detail.status === 'success') {
        setLastSavedSettingsAt(detail.timestamp);
      }
    };

    window.addEventListener(getSettingsSyncEventName(), handleSettingsSync);
    return () =>
      window.removeEventListener(getSettingsSyncEventName(), handleSettingsSync);
  }, []);

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const decks = await db.decks.toArray();
      if (decks.length === 0) { showMsg('No decks to export'); return; }
      for (const deck of decks) {
        const blob = await exportAnkiPackage(deck.id!);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${deck.name}.apkg`;
        a.click();
        URL.revokeObjectURL(url);
      }
      showMsg('All decks exported');
    } catch (err: any) {
      showMsg('Export failed: ' + err.message);
    }
    setExporting(false);
  };

  const handleBackupAll = async () => {
    try {
      const data = { decks: await db.decks.toArray(), cards: await db.cards.toArray(), reviewLogs: await db.reviewLogs.toArray(), exportDate: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `moyan-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg('Backup file downloaded');
    } catch (err: any) {
      showMsg('Backup failed: ' + err.message);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm(t('settings.data.restore') + ' - ' + t('settings.danger.clear.confirm'))) return;
      await db.decks.clear();
      await db.cards.clear();
      await db.reviewLogs.clear();
      if (data.decks?.length) await db.decks.bulkAdd(data.decks);
      if (data.cards?.length) await db.cards.bulkAdd(data.cards);
      if (data.reviewLogs?.length) await db.reviewLogs.bulkAdd(data.reviewLogs);
      showMsg('Data restored');
      clearAudioCache();
      window.dispatchEvent(new CustomEvent('moyan:data-change'));
      window.dispatchEvent(new CustomEvent('moyan:lang-change', { detail: getLanguage() }));
    } catch (err: any) {
      showMsg('Restore failed: ' + err.message);
    }
    e.target.value = '';
  };

  const handleClearAll = async () => {
    if (!confirm(t('settings.danger.clear.confirm'))) return;
    await db.decks.clear();
    await db.cards.clear();
    await db.reviewLogs.clear();
    clearAudioCache();
    showMsg(t('settings.danger.clear'));
    window.dispatchEvent(new CustomEvent('moyan:data-change'));
  };

  const tabs: { key: Tab; label: string; icon: typeof Palette }[] = [
    { key: 'general', label: t('settings.tab.general'), icon: FileText },
    { key: 'voice', label: t('settings.tab.voice'), icon: Mic },
    { key: 'theme', label: t('settings.tab.theme'), icon: Palette },
  ];

  const getSettingsSyncLabel = () => {
    if (!settingsSyncState) return t('settings.sync.status.idle');
    if (settingsSyncState.status === 'loading') return t('settings.sync.status.loading');
    if (settingsSyncState.status === 'saving') return t('settings.sync.status.saving');
    if (settingsSyncState.status === 'success') {
      return settingsSyncState.phase === 'fetch'
        ? t('settings.sync.status.loaded')
        : t('settings.sync.status.saved');
    }
    return t('settings.sync.status.error');
  };

  const getSettingsSyncTone = () => {
    if (!settingsSyncState || settingsSyncState.status === 'idle') {
      return { bg: 'var(--paper)', fg: 'var(--ink-light)' };
    }
    if (settingsSyncState.status === 'error') {
      return { bg: 'var(--accent-light)', fg: 'var(--accent)' };
    }
    if (settingsSyncState.status === 'success' && settingsSyncState.phase === 'fetch') {
      return { bg: 'var(--paper)', fg: 'var(--ink-light)' };
    }
    if (settingsSyncState.status === 'success') {
      return { bg: 'rgba(43, 107, 79, 0.12)', fg: '#2B6B4F' };
    }
    return { bg: 'var(--paper)', fg: 'var(--ink)' };
  };

  const getSettingsSyncDotTone = () => {
    if (!settingsSyncState || settingsSyncState.status === 'idle') {
      return 'var(--ink-muted)';
    }
    if (settingsSyncState.status === 'error') {
      return 'var(--accent)';
    }
    if (settingsSyncState.status === 'success' && settingsSyncState.phase === 'fetch') {
      return 'var(--ink-light)';
    }
    if (settingsSyncState.status === 'success') {
      return '#2B6B4F';
    }
    return 'var(--ink)';
  };

  const isSettingsSaved = settingsSyncState?.status === 'success' && settingsSyncState.phase === 'save';

  const getLastSettingsSyncTime = () => {
    if (!lastSavedSettingsAt) {
      return t('settings.sync.status.never');
    }

    return formatSettingsSyncTimestamp(lastSavedSettingsAt, getLanguage());
  };

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      {/* 顶部 */}
      <header className="px-6 pt-12 pb-4">
        <h1 className="font-serif-cn text-2xl font-bold" style={{ color: 'var(--ink)' }}>{t('settings.title')}</h1>
      </header>

      {/* Tab 切换 */}
      <div className="px-5 mb-4">
        <div className="rounded-xl p-1 flex" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1"
              style={{
                backgroundColor: activeTab === tab.key ? 'var(--btn-bg)' : 'transparent',
                color: activeTab === tab.key ? 'var(--btn-text)' : 'var(--ink-light)',
              }}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 提示消息 */}
      {message && (
        <div className="px-5 mb-4">
          <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            {message}
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleRestore} />

      {/* 内容区域 */}
      <div className="px-5">
        {activeTab === 'general' && (
          <div className="space-y-6">
            {/* 语言设置 */}
            <section>
              <h2 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.lang.title')}</h2>
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div className="flex">
                  {(['zh-CN', 'en'] as Language[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => { setLanguage(lang); showMsg(lang === 'zh-CN' ? '语言已切换' : 'Language changed'); }}
                      className="flex-1 text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                      style={{
                        borderRight: lang === 'zh-CN' ? '1px solid var(--divider)' : 'none',
                        backgroundColor: getLanguage() === lang ? 'var(--accent-light)' : 'transparent',
                      }}
                    >
                      <Globe size={18} style={{ color: getLanguage() === lang ? 'var(--accent)' : 'var(--ink-light)' }} />
                      <span style={{ color: getLanguage() === lang ? 'var(--accent)' : 'var(--ink)' }} className="text-sm font-medium">
                        {lang === 'zh-CN' ? t('settings.lang.zh') : t('settings.lang.en')}
                      </span>
                      {getLanguage() === lang && (
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                          OK
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>

          {/* 账户管理 */}
            <section>
              <h2 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.account')}</h2>
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {user ? (
                  <>
                    {/* Logged in: show user info */}
                    <div className="px-4 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--divider)' }}>
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-light)' }}>
                          <User size={18} style={{ color: 'var(--accent)' }} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{user.name}</p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>{user.email}</p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full capitalize" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                        {user.provider}
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between gap-3 text-[11px]" style={{ borderBottom: '1px solid var(--divider)' }}>
                      <div className="min-w-0">
                        <p className="font-medium" style={{ color: 'var(--ink-muted)' }}>{t('settings.sync.status.title')}</p>
                        <p style={{ color: 'var(--ink-light)' }} className="mt-1.5">
                          {t('settings.sync.status.last')} · {getLastSettingsSyncTime()}
                        </p>
                      </div>
                      <span
                        className="px-2.5 py-1 rounded-full shrink-0 inline-flex items-center gap-1.5"
                        style={{
                          backgroundColor: getSettingsSyncTone().bg,
                          color: getSettingsSyncTone().fg,
                        }}
                      >
                        {isSettingsSaved ? (
                          <Check size={12} strokeWidth={2.4} className="shrink-0" />
                        ) : (
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: getSettingsSyncDotTone() }}
                          />
                        )}
                        {getSettingsSyncLabel()}
                      </span>
                    </div>
                    {/* Cloud sync buttons */}
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('moyan:sync-upload'))}
                      className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                      style={{ borderBottom: '1px solid var(--divider)' }}
                    >
                      <Cloud size={18} style={{ color: 'var(--ink-light)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--ink)' }}>{t('settings.sync.upload')}</p>
                        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{t('settings.sync.upload.desc')}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('moyan:sync-download'))}
                      className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                      style={{ borderBottom: '1px solid var(--divider)' }}
                    >
                      <Download size={18} style={{ color: 'var(--ink-light)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--ink)' }}>{t('settings.sync.download')}</p>
                        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{t('settings.sync.download.desc')}</p>
                      </div>
                    </button>
                    {/* Logout */}
                    <button
                      onClick={() => { logout(); window.location.href = '/'; }}
                      className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                    >
                      <LogOut size={18} style={{ color: 'var(--accent)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{t('settings.account.logout')}</p>
                        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{t('settings.account.logout.desc')}</p>
                      </div>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                  >
                    <LogIn size={18} style={{ color: 'var(--accent)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{t('settings.account.login')}</p>
                      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{t('settings.account.login.desc')}</p>
                    </div>
                  </button>
                )}
              </div>
            </section>

            {/* {t('settings.data.title')} */}
            <section>
              <h2 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.data.title')}</h2>
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                {[
                  { icon: Download, label: t('settings.data.export.anki'), action: handleExportAll, desc: t('settings.data.export.anki.desc') },
                  { icon: FileText, label: t('settings.data.backup'), action: handleBackupAll, desc: t('settings.data.backup.desc') },
                  { icon: Upload, label: t('settings.data.restore'), action: () => fileInputRef.current?.click(), desc: t('settings.data.restore.desc') },
                ].map((item, i, arr) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    disabled={exporting}
                    className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                    style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--divider)' : 'none' }}
                  >
                    <item.icon size={18} style={{ color: 'var(--ink-light)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: 'var(--ink)' }}>{item.label}</p>
                      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{item.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* 危险操作 */}
            <section>
              <h2 className="text-xs uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--ink-muted)' }}>{t('settings.danger.title')}</h2>
              <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--card)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <button
                  onClick={handleClearAll}
                  className="w-full text-left flex items-center gap-3 px-4 py-3.5 transition hover:opacity-80"
                >
                  <Trash2 size={18} style={{ color: 'var(--accent)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{t('settings.danger.clear')}</p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{t('settings.danger.clear.desc')}</p>
                  </div>
                </button>
              </div>
            </section>

            <div className="rounded-2xl p-4 text-xs leading-relaxed" style={{ backgroundColor: 'var(--card)', color: 'var(--ink-light)' }}>
              <p className="font-semibold mb-1" style={{ color: 'var(--ink)' }}>{t('app.name')}</p>
              <p>v1.3.0 · {t('app.desc')}</p>
              <p className="mt-1">Anki .apkg & CSV. Data stored locally.</p>
            </div>
          </div>
        )}

        {activeTab === 'voice' && <SpeechSettingsPanel />}
        {activeTab === 'theme' && <ThemePanel />}
      </div>

      <BottomNav />
    </div>
  );
}
