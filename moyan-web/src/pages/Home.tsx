import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, BookOpen, Target, TrendingUp, X, CalendarDays, Layers, Keyboard } from 'lucide-react';
import InkProgress from '../components/shaders/InkProgress';
import BottomNav from '../components/BottomNav';
import { UserMenu } from '../components/UserMenu';
import { db, getDueCards, getStudyStats } from '../db';
import { initVocabularyDecks } from '../services/vocabularyLoader';
import { getCurrentUser, onAuthChange, type User } from '../services/authService';
import { hasVocabularyBackend, listDecks } from '../services/vocabularyApi';
import type { Deck as ApiDeck } from '@/types/vocabulary';
import type { Deck as LocalDeck } from '../db';
import { t, getLanguage } from '../i18n/translations';

type UiDeck = {
  id: string;
  name: string;
  description: string;
  color?: string | null;
  cardCount: number;
};

function formatDate() {
  const d = new Date();
  return d.toLocaleDateString(getLanguage() === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });
}

function mapApiDeck(deck: ApiDeck): UiDeck {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    color: deck.color,
    cardCount: deck.card_count,
  };
}

function mapLocalDeck(deck: LocalDeck): UiDeck {
  return {
    id: String(deck.id),
    name: deck.name,
    description: deck.description,
    color: deck.color,
    cardCount: deck.cardCount,
  };
}

export default function Home() {
  const navigate = useNavigate();
  const backend = hasVocabularyBackend();
  const [dueCount, setDueCount] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [todayReviewed, setTodayReviewed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dailyWords] = useState(['concurrency', 'idempotent', 'eventual consistency', 'backpressure', 'memory safety']);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  // 词库选择面板
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [decks, setDecks] = useState<UiDeck[]>([]);

  useEffect(() => {
    setUser(getCurrentUser());
    const unsub = onAuthChange((u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    void loadData();
    // 切换展示单词
    const wordInterval = setInterval(() => {
      setCurrentWordIndex(prev => (prev + 1) % dailyWords.length);
    }, 3000);
    return () => clearInterval(wordInterval);
  }, []);

  const loadData = async () => {
    try {
      if (backend) {
        if (!getCurrentUser()) {
          // Keep home browsable; deck study requires login (same as Decks)
          setDecks([]);
          setDueCount(0);
          setTotalCards(0);
          setTodayReviewed(0);
          setProgress(0);
          return;
        }
        const remote = await listDecks();
        const mapped = remote.map(mapApiDeck);
        setDecks(mapped);
        const total = mapped.reduce((sum, d) => sum + d.cardCount, 0);
        setTotalCards(total);
        // Due/progress from server study-cards is expensive across all decks;
        // show card totals for now and keep due at 0 until per-deck study.
        setDueCount(0);
        setTodayReviewed(0);
        setProgress(0);
      } else {
        await initVocabularyDecks();
        const due = await getDueCards();
        setDueCount(due.length);
        const allCards = await db.cards.count();
        setTotalCards(allCards);
        const stats = await getStudyStats();
        setTodayReviewed(stats.todayReviewed);
        const reviewedCards = await db.cards.filter(c => c.srs.status !== 'new').count();
        setProgress(allCards > 0 ? reviewedCards / allCards : 0);
        const allDecks = await db.decks.toArray();
        setDecks(allDecks.map(mapLocalDeck));
      }
    } catch (err) {
      console.error('[Home] loadData failed:', err);
    }
  };

  const thirtyDayDecks = decks.filter(d => d.name === '30天词汇');
  const otherDecks = decks.filter(d => d.name !== '30天词汇');

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      {/* 顶部状态栏 */}
      <header className="px-6 pt-12 pb-4">
        <div className="flex items-center justify-end mb-6">
          {user ? (
            <UserMenu />
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-9 h-9 rounded-full border border-[var(--divider)] overflow-hidden flex items-center justify-center"
              style={{ background: 'var(--card)' }}
            >
              <img src="/scholar.jpg" alt="avatar" className="w-full h-full object-cover" />
            </button>
          )}
        </div>
        <h1 className="font-serif-cn text-3xl font-bold text-[var(--ink)] mb-1">
          {t('greeting')}，{user?.name?.split(' ')[0] || 'User'}。
        </h1>
        <p className="text-sm text-[var(--ink-light)]">
          {formatDate()} · {t('home.daily.due', { count: dueCount })}
        </p>
      </header>

      {/* 记忆进度模块 - 水墨着色器 */}
      <section className="px-5 mb-6">
        <div className="relative rounded-3xl overflow-hidden shadow-lg shadow-[var(--ink-muted)]/10">
          <InkProgress progress={progress} className="w-full h-40" />
          <div className="absolute inset-0 flex flex-col justify-end p-5 pointer-events-none">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-white/70 mb-1">{t('home.stats.total')}</p>
                <p className="text-2xl font-serif-cn font-bold text-white">
                  {totalCards > 0 ? Math.round(progress * 100) : 0}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70">{t('stats.streak')}</p>
                <p className="text-lg font-semibold text-white">{todayReviewed} {t('word')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 核心学习入口 */}
      <section className="px-5 mb-4">
        <button
          onClick={() => setShowDeckPicker(true)}
          className="w-full relative rounded-3xl overflow-hidden bg-[var(--btn-bg)] h-52 shadow-xl shadow-[var(--ink)]/20 active:scale-[0.98] transition-transform"
        >
          {/* 动态文字背景 */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              {dailyWords.map((word, i) => (
                <span
                  key={word}
                  className={`absolute text-white font-serif-cn text-4xl md:text-5xl whitespace-nowrap transition-all duration-1000 ${
                    i === currentWordIndex ? 'opacity-100 scale-110' : 'opacity-0 scale-90'
                  }`}
                  style={{
                    top: `${30 + Math.sin(i * 1.5) * 20}%`,
                    left: `${10 + (i * 20) % 60}%`,
                    transform: `rotate(${-10 + i * 5}deg)`,
                  }}
                >
                  {word}
                </span>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 flex flex-col justify-between p-6">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-white/60" />
              <span className="text-xs text-white/60 tracking-wider">{t('home.daily.required')}</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-serif-cn text-xl text-white font-semibold mb-1">{t('home.daily.start')}</p>
                <p className="text-xs text-white/50">
                  {dueCount > 0 ? t('home.daily.due', { count: dueCount }) : t('home.daily.done')}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-[var(--card)]/10 flex items-center justify-center backdrop-blur-sm">
                <ArrowRight size={20} className="text-white" />
              </div>
            </div>
          </div>
        </button>
      </section>

      {/* 打字训练入口 */}
      <section className="px-5 mb-6">
        <button
          onClick={() => navigate('/type')}
          className="w-full rounded-2xl p-4 flex items-center gap-4 transition-all active:scale-[0.98] hover:shadow-md"
          style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--accent-light)' }}
          >
            <Keyboard size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 text-left">
            <p className="font-medium text-[var(--ink)]">{t('type.training')}</p>
            <p className="text-xs text-[var(--ink-muted)]">{t('type.training.desc')}</p>
          </div>
          <ArrowRight size={18} style={{ color: 'var(--ink-muted)' }} />
        </button>
      </section>

      {/* 快捷统计 */}
      <section className="px-5 mb-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <Target size={18} className="text-[var(--accent)] mb-2" />
            <p className="text-lg font-bold text-[var(--ink)]">{dueCount}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('home.stats.due')}</p>
          </div>
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <BookOpen size={18} className="text-[var(--accent)] mb-2" />
            <p className="text-lg font-bold text-[var(--ink)]">{totalCards}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('home.stats.total')}</p>
          </div>
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <TrendingUp size={18} className="text-[var(--accent)] mb-2" />
            <p className="text-lg font-bold text-[var(--ink)]">{todayReviewed}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('home.stats.today')}</p>
          </div>
        </div>
      </section>

      {/* 词库选择面板 */}
      {showDeckPicker && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
          onClick={() => setShowDeckPicker(false)}
        >
          <div
            className="bg-[var(--card)] rounded-t-3xl w-full max-w-lg p-6 animate-fade-in-up max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif-cn text-xl font-bold text-[var(--ink)]">{t('decks.title')}</h2>
              <button
                onClick={() => setShowDeckPicker(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--paper)] transition"
              >
                <X size={18} className="text-[var(--ink-light)]" />
              </button>
            </div>

            {/* 可滚动内容 */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* 自由练习 */}
              <button
                onClick={() => {
                  setShowDeckPicker(false);
                  if (backend && !getCurrentUser()) {
                    navigate('/login');
                    return;
                  }
                  navigate('/study');
                }}
                className="w-full text-left p-4 rounded-2xl hover:shadow-md transition-all active:scale-[0.99]"
                style={{ backgroundColor: 'var(--btn-bg)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                    <Layers size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{t('decks.title')}</h3>
                    <p className="text-[11px] text-white/60">{t('decks.no.desc')}</p>
                  </div>
                </div>
              </button>

              {/* 30天词汇 */}
              {thirtyDayDecks.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--ink-muted)] mb-2 px-1 flex items-center gap-1">
                    <CalendarDays size={12} />
                    30天词汇
                  </h3>
                  <div className="space-y-2">
                    {thirtyDayDecks.map((deck) => (
                      <button
                        key={deck.id}
                        onClick={() => {
                          if (backend && !getCurrentUser()) {
                            setShowDeckPicker(false);
                            navigate('/login');
                            return;
                          }
                          setShowDeckPicker(false);
                          navigate(`/study?deck=${deck.id}`);
                        }}
                        className="w-full text-left flex items-center gap-3 p-3 rounded-xl hover:shadow-md transition-all active:scale-[0.99]"
                        style={{ backgroundColor: 'var(--paper)' }}
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: deck.color || '#2B2B2B' }}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-[var(ink)]">{deck.name}</h4>
                          <p className="text-[10px] text-[var(--ink-muted)]">程序员高频词汇30天计划</p>
                        </div>
                        <span className="text-[10px] text-[var(--ink-muted)] shrink-0">{deck.cardCount}词</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 其他牌组 */}
              {otherDecks.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-[var(--ink-muted)] mb-2 px-1">其他词库</h3>
                  <div className="space-y-2">
                    {otherDecks.map((deck) => (
                      <button
                        key={deck.id}
                        onClick={() => {
                          if (backend && !getCurrentUser()) {
                            setShowDeckPicker(false);
                            navigate('/login');
                            return;
                          }
                          setShowDeckPicker(false);
                          navigate(`/study?deck=${deck.id}`);
                        }}
                        className="w-full text-left flex items-center gap-3 p-3 rounded-xl hover:shadow-md transition-all active:scale-[0.99]"
                        style={{ backgroundColor: 'var(--paper)' }}
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: deck.color || '#2B2B2B' }}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-[var(--ink)] truncate">{deck.name}</h4>
                          {deck.description && (
                            <p className="text-[10px] text-[var(--ink-muted)] truncate">{deck.description}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--ink-muted)] shrink-0">{deck.cardCount}词</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
