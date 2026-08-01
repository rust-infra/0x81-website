import { useEffect, useState } from 'react';
import { Calendar, TrendingUp, BookOpen, Target, Flame, Keyboard } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import { db, getStudyStats } from '../db';
import { t } from '../i18n/translations';
import {
  getTypeStats,
  hasVocabularyBackend,
} from '../services/vocabularyApi';
import type { TypeStats } from '@/types/vocabulary';
import { getCurrentUser } from '../services/authService';

interface DayData {
  date: string;
  count: number;
}

export default function Stats() {
  const [stats, setStats] = useState({
    todayReviewed: 0,
    totalCards: 0,
    newCards: 0,
    dueCards: 0,
    todayAccuracy: '0',
  });
  const [weeklyData, setWeeklyData] = useState<DayData[]>([]);
  const [streak, setStreak] = useState(0);
  const [typeStats, setTypeStats] = useState<TypeStats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const s = await getStudyStats();
    setStats(s);

    if (hasVocabularyBackend() && getCurrentUser()) {
      try {
        setTypeStats(await getTypeStats());
      } catch {
        setTypeStats(null);
      }
    }

    // 生成近7天的学习数据
    const days: DayData[] = [];
    const logs = await db.reviewLogs.toArray();

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = logs.filter(l => {
        const d = new Date(l.reviewedAt);
        return d >= date && d < nextDate;
      }).length;

      days.push({
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        count,
      });
    }
    setWeeklyData(days);

    // 计算连续学习天数
    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const nextDate = new Date(checkDate);
      nextDate.setDate(nextDate.getDate() + 1);

      const hasStudy = logs.some(l => {
        const d = new Date(l.reviewedAt);
        return d >= checkDate && d < nextDate;
      });

      if (hasStudy) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
    }
    setStreak(currentStreak);
  };

  const maxCount = Math.max(...weeklyData.map(d => d.count), 1);
  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      {/* 顶部 */}
      <header className="px-6 pt-12 pb-4">
        <h1 className="font-serif-cn text-2xl font-bold text-[var(--ink)] mb-1">{t('stats.title')}</h1>
        <p className="text-xs text-[var(--ink-light)]">{t('app.desc')}</p>
      </header>

      {/* 连续学习 */}
      <section className="px-5 mb-5">
        <div className="bg-[var(--btn-bg)] rounded-2xl p-5 text-white flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[var(--card)]/10 flex items-center justify-center">
            <Flame size={28} className="text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-3xl font-bold font-serif-cn">{streak}</p>
            <p className="text-xs text-white/60">{t('stats.streak')}</p>
          </div>
        </div>
      </section>

      {/* 核心数据 */}
      <section className="px-5 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <Target size={16} className="text-[var(--accent)] mb-2" />
            <p className="text-xl font-bold text-[var(--ink)]">{stats.totalCards}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('home.stats.total')}</p>
          </div>
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <BookOpen size={16} className="text-[var(--accent)] mb-2" />
            <p className="text-xl font-bold text-[var(--ink)]">{stats.newCards}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('deck.detail.status.new')} {t('cards')}</p>
          </div>
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <TrendingUp size={16} className="text-[var(--accent)] mb-2" />
            <p className="text-xl font-bold text-[var(--ink)]">{stats.todayReviewed}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('stats.reviews')} {t('stats.today')}</p>
          </div>
          <div className="bg-[var(--card)] rounded-2xl p-4 shadow-sm">
            <Calendar size={16} className="text-[var(--tag-text)] mb-2" />
            <p className="text-xl font-bold text-[var(--ink)]">{stats.dueCards}</p>
            <p className="text-[11px] text-[var(--ink-light)]">{t('home.stats.due')}</p>
          </div>
        </div>
      </section>

      {/* 本周趋势 */}
      <section className="px-5 mb-5">
        <h2 className="font-serif-cn text-lg font-bold text-[var(--ink)] mb-3">{t('stats.week')}</h2>
        <div className="bg-[var(--card)] rounded-2xl p-5 shadow-sm">
          {weeklyData.length > 0 ? (
            <div className="flex items-end justify-between gap-2 h-32">
              {weeklyData.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex flex-col items-center">
                    {day.count > 0 && (
                      <span className="text-[10px] text-[var(--ink-light)] mb-0.5">{day.count}</span>
                    )}
                    <div
                      className="w-full max-w-[28px] rounded-full bg-[var(--btn-bg)] transition-all duration-500"
                      style={{ height: `${Math.max((day.count / maxCount) * 80, 4)}px`, opacity: day.count > 0 ? 0.8 : 0.15 }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--ink-light)]">{day.date}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-light)] text-center py-8">{t('stats.no.data')}</p>
          )}
        </div>
      </section>

      {/* 打字训练 */}
      {hasVocabularyBackend() && getCurrentUser() && (
        <section className="px-5 mb-5">
          <h2 className="font-serif-cn text-lg font-bold text-[var(--ink)] mb-3 flex items-center gap-1.5">
            <Keyboard size={16} className="text-[var(--accent)]" />
            {t('stats.type.title')}
          </h2>
          <div className="bg-[var(--card)] rounded-2xl p-5 shadow-sm space-y-5">
            {typeStats && (typeStats.recent_sessions.length > 0 || typeStats.daily_trend.length > 0) ? (
              <>
                {typeStats.daily_trend.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--ink-light)] mb-2">{t('stats.type.trend')}</p>
                    <div className="flex items-end justify-between gap-2 h-24">
                      {typeStats.daily_trend.map((day) => (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] text-[var(--ink-light)] tabular-nums">
                            {Math.round(day.avg_accuracy * 100)}%
                          </span>
                          <div
                            className="w-full max-w-[28px] rounded-full bg-[var(--btn-bg)] transition-all duration-500"
                            style={{ height: `${Math.max(day.avg_accuracy * 80, 4)}px` }}
                          />
                          <span className="text-[10px] text-[var(--ink-light)] tabular-nums">{day.date.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {typeStats.recent_sessions.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--ink-light)] mb-2">{t('stats.type.recent')}</p>
                    <ul className="space-y-2">
                      {typeStats.recent_sessions.slice(0, 10).map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--ink)] min-w-0 truncate">
                            {s.deck_name || t('type.all.cards')}
                            <span className="text-[var(--ink-light)] ml-2">
                              {s.mode === 'word' ? t('type.word.mode') : t('type.sentence.mode')}
                            </span>
                          </span>
                          <span className="text-[var(--ink-light)] tabular-nums shrink-0">
                            {Math.round(s.avg_accuracy * 100)}% · {Math.round(s.avg_wpm)} WPM · {s.created_at.slice(0, 10)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--ink-light)] text-center py-4">{t('stats.type.no.data')}</p>
            )}
          </div>
        </section>
      )}

      {/* 准确率 */}
      <section className="px-5 mb-5">
        <h2 className="font-serif-cn text-lg font-bold text-[var(--ink)] mb-3">{t('study.accuracy')} {t('stats.today')}</h2>
        <div className="bg-[var(--card)] rounded-2xl p-5 shadow-sm flex items-center gap-5">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="var(--divider)" strokeWidth="6" />
              <circle
                cx="40" cy="40" r="34" fill="none" stroke="var(--tag-text)" strokeWidth="6"
                strokeDasharray={`${Number(stats.todayAccuracy) * 2.14} 214`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[var(--ink)]">
              {stats.todayAccuracy}%
            </span>
          </div>
          <div>
            <p className="text-sm text-[var(--ink-light)]">{t('stats.reviews')} {t('stats.today')}: <span className="text-[var(--ink)] font-semibold">{stats.todayReviewed}</span> {t('cards')}</p>
            <p className="text-xs text-[var(--ink-light)] mt-1">{t('home.quote1')}</p>
          </div>
        </div>
      </section>

      <BottomNav />
    </div>
  );
}
