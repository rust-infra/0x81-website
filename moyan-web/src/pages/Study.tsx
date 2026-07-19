import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { X, RotateCcw, Eye, EyeOff, Volume2 } from 'lucide-react';
import { db, getDueCards } from '../db';
import type { Card } from '../db';
import { calculateSRS, getIntervalPreview } from '../services/srs';
import SpeakButton from '../components/SpeakButton';
import {
  speakSequence,
  stopAllAudio,
  preloadWebSpeechVoices,
  getSpeechSettings,
} from '../services/speechService';
import { getCurrentTheme } from '../theme';
import { t } from '../i18n/translations';

// ---- Study History ----

async function recordStudy(
  cardId: number,
  cardFront: string,
  rating: 'again' | 'hard' | 'good' | 'easy',
  timeTakenMs: number,
  flipDelayMs: number,
  studyMode: 'en-zh' | 'zh-en'
) {
  await db.studyHistory.add({
    cardId,
    cardFront,
    rating,
    timeTakenMs,
    flipDelayMs,
    studyMode,
    createdAt: new Date(),
  });
}

/** 
 * Deterministic weighted sort: cards needing more practice come first.
 * Higher weight = higher priority (appears earlier).
 * Same history always produces the same order.
 */
async function sortCardsSmart(cards: Card[]): Promise<Card[]> {
  const all = await db.studyHistory.toArray();
  // Build score map: { cardId: { total, wrong, lastTime } }
  const map: Record<number, { total: number; wrong: number; last: number }> = {};
  for (const h of all) {
    const e = map[h.cardId] || { total: 0, wrong: 0, last: 0 };
    e.total++;
    if (h.rating === 'again' || h.rating === 'hard') e.wrong++;
    const t = h.createdAt.getTime();
    if (t > e.last) e.last = t;
    map[h.cardId] = e;
  }
  const getWeight = (card: Card): number => {
    const s = map[card.id!];
    if (!s) return 1000; // new card: highest priority
    const correct = s.total - s.wrong;
    const daysSince = Math.min((Date.now() - s.last) / 86400000, 60);
    // wrong +100 each, correct -30 each, days since +5 each
    return s.wrong * 100 - correct * 30 + daysSince * 5;
  };
  return [...cards].sort((a, b) => {
    const wa = getWeight(a);
    const wb = getWeight(b);
    if (wa !== wb) return wb - wa; // higher weight first
    return (a.id || 0) - (b.id || 0);
  });
}

// Split example text into English and Chinese segments with playback
interface ExampleSegment {
  text: string;
  lang: 'en' | 'zh';
}

function splitExample(text: string): ExampleSegment[] {
  const firstCJK = text.search(/[\u4e00-\u9fff]/);
  if (firstCJK === -1) return [{ text, lang: 'en' }];
  const lastCJK = text.search(/[\u4e00-\u9fff][^\u4e00-\u9fff]*$/);
  const cjkEnd = lastCJK >= 0 ? lastCJK + 1 : text.length;
  const enPart = text.slice(0, firstCJK).trim().replace(/[\s—–]+$/, '');
  const zhPart = text.slice(firstCJK, cjkEnd).trim();
  const trailing = text.slice(cjkEnd).trim();
  const segments: ExampleSegment[] = [];
  if (enPart) segments.push({ text: enPart, lang: 'en' });
  if (zhPart || trailing) segments.push({ text: zhPart + (trailing ? ` ${trailing}` : ''), lang: 'zh' });
  return segments;
}

type StudyMode = 'en-zh' | 'zh-en';
const MODE_KEY = 'moyan_study_mode';
const STUDY_PROGRESS_KEY = 'moyan_study_progress';

function getStudyMode(): StudyMode {
  return (localStorage.getItem(MODE_KEY) as StudyMode) || 'en-zh';
}
function setStudyMode(mode: StudyMode) {
  localStorage.setItem(MODE_KEY, mode);
}

// ---- Progress Persistence ----
interface StudyProgress {
  [deckId: string]: { currentIndex: number; lastCardId: number; timestamp: number };
}

function loadProgress(): StudyProgress {
  try {
    return JSON.parse(localStorage.getItem(STUDY_PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveProgressEntry(deckId: string | null, currentIndex: number, cardId: number) {
  const key = deckId || 'all';
  const all = loadProgress();
  all[key] = { currentIndex, lastCardId: cardId, timestamp: Date.now() };
  localStorage.setItem(STUDY_PROGRESS_KEY, JSON.stringify(all));
}

function getSavedIndex(deckId: string | null, cards: Card[]): number {
  const key = deckId || 'all';
  const saved = loadProgress()[key];
  if (!saved) return 0;
  // Check if the saved card still exists in the list
  const idx = cards.findIndex(c => c.id === saved.lastCardId);
  if (idx >= 0) return idx;
  // Fallback to saved index (clamp to valid range)
  return Math.min(saved.currentIndex, cards.length - 1);
}

function clearProgress(deckId: string | null) {
  const key = deckId || 'all';
  const all = loadProgress();
  delete all[key];
  localStorage.setItem(STUDY_PROGRESS_KEY, JSON.stringify(all));
}

export default function Study() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deckId = searchParams.get('deck');
  const theme = getCurrentTheme();
  const c = theme.colors;

  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [autoPlay, setAutoPlay] = useState(() => getSpeechSettings().autoPlay);
  const [deckName, setDeckName] = useState<string>('');
  const [studyMode, setStudyMode] = useState<StudyMode>(getStudyMode);
  const [avgFlipTime, setAvgFlipTime] = useState(0); // 平均思考时间(ms)

  const isZhEn = studyMode === 'zh-en';

  // Derived from current index — declared early since hooks below reference it
  const currentCard = cards[currentIndex];

  // Timer refs for tracking study metrics
  const cardStartTimeRef = useRef<number>(0);
  const flipTimeRef = useRef<number>(0);

  // Wrapper for revealing answer - records flip delay on first reveal
  const revealAnswer = () => {
    if (!showAnswer && flipTimeRef.current === 0) {
      flipTimeRef.current = Date.now();
    }
    setShowAnswer(prev => !prev);
  };

  const showAnswerOnly = () => {
    if (!showAnswer && flipTimeRef.current === 0) {
      flipTimeRef.current = Date.now();
    }
    setShowAnswer(true);
  };

  useEffect(() => {
    preloadWebSpeechVoices();
    loadCards();
    if (deckId) {
      db.decks.get(Number(deckId)).then(d => {
        if (d) setDeckName(d.name);
      });
    }
    return () => { stopAllAudio(); };
  }, [deckId]);

  // Save progress when user leaves the page
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentCard && !isComplete) {
        saveProgressEntry(deckId, currentIndex, currentCard.id!);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentCard, currentIndex, deckId, isComplete]);

  const loadCards = async () => {
    try {
      let loaded: Card[];
      if (deckId) {
        loaded = await db.cards.where('deckId').equals(Number(deckId)).toArray();
        console.log(`[Study] Deck ${deckId}: ${loaded.length} cards loaded`);
      } else {
        const due = await getDueCards();
        console.log(`[Study] Free mode: ${due.length} due cards`);
        if (due.length === 0) {
          loaded = await db.cards.filter(c => c.srs.status === 'new').limit(20).toArray();
        } else {
          loaded = due;
        }
      }
      loaded = await sortCardsSmart(loaded);
      console.log(`[Study] After sort: ${loaded.length} cards`);
      setCards(loaded);
      if (loaded.length > 0) {
        const savedIdx = getSavedIndex(deckId, loaded);
        setCurrentIndex(savedIdx);
        console.log(`[Study] Index: ${savedIdx + 1}/${loaded.length}`);
      }
    } catch (err) {
      console.error('[Study] loadCards failed:', err);
    }
  };

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Reset timer when card changes
  useEffect(() => {
    cardStartTimeRef.current = Date.now();
    flipTimeRef.current = 0;
  }, [currentIndex]);

  // Auto-speak
  useEffect(() => {
    if (!autoPlay || !showAnswer || !currentCard) return;
    const texts = isZhEn
      ? [currentCard.back, currentCard.front]
      : [currentCard.front, currentCard.back];
    if (currentCard.example) texts.push(currentCard.example);
    speakSequence(texts);
  }, [showAnswer, currentIndex, autoPlay, isZhEn]);

  const handleRate = async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!currentCard || isTransitioning) return;
    setIsTransitioning(true);
    stopAllAudio();

    const now = Date.now();
    const timeTakenMs = now - cardStartTimeRef.current;
    const flipDelayMs = flipTimeRef.current > 0 ? flipTimeRef.current - cardStartTimeRef.current : 0;

    try {
      const updatedSRS = calculateSRS(currentCard.srs, rating);
      await db.cards.update(currentCard.id!, {
        srs: updatedSRS,
        updatedAt: new Date(),
      });

      await db.reviewLogs.add({
        cardId: currentCard.id!,
        deckId: currentCard.deckId,
        rating,
        timeTaken: timeTakenMs,
        reviewedAt: new Date(),
        oldInterval: currentCard.srs.interval,
        newInterval: updatedSRS.interval,
        oldEaseFactor: currentCard.srs.easeFactor,
        newEaseFactor: updatedSRS.easeFactor,
      });

      // Save detailed study history
      await recordStudy(
        currentCard.id!,
        currentCard.front,
        rating,
        timeTakenMs,
        flipDelayMs,
        studyMode
      );

      // Update session stats
      setSessionStats(prev => ({ ...prev, [rating]: prev[rating] + 1 }));

      // Update average flip time for display
      setAvgFlipTime(prev => prev === 0 ? flipDelayMs : Math.round((prev + flipDelayMs) / 2));
    } catch (err) {
      console.error('Review save failed:', err);
    }

    setTimeout(() => {
      setShowAnswer(false);
      if (currentIndex < cards.length - 1) {
        const nextIdx = currentIndex + 1;
        // Save progress: current card ID = where we are now
        if (currentCard) {
          saveProgressEntry(deckId, currentIndex, currentCard.id!);
        }
        setCurrentIndex(nextIdx);
      } else {
        clearProgress(deckId);
        setIsComplete(true);
      }
      setIsTransitioning(false);
    }, 400);
  };

  const handleRestart = () => {
    clearProgress(deckId);
    setCurrentIndex(0);
    setIsComplete(false);
    setShowAnswer(false);
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 });
    stopAllAudio();
    loadCards();
  };

  const handleGoHome = () => {
    stopAllAudio();
    window.location.href = '/';
  };

  // Shared card style for semi-transparent surfaces
  const surfaceStyle = (opacity: number) => ({
    backgroundColor: `${c.studyText}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`,
  });

  // Rating button colors derived from theme accent
  const ratingButtons = [
    { key: 'again' as const, label: t('study.again'), preview: getIntervalPreview(currentCard?.srs, 'again'), color: c.accent },
    { key: 'hard' as const, label: t('study.hard'), preview: getIntervalPreview(currentCard?.srs, 'hard'), color: '#B8860B' },
    { key: 'good' as const, label: t('study.good'), preview: getIntervalPreview(currentCard?.srs, 'good'), color: '#2B5A3B' },
    { key: 'easy' as const, label: t('study.easy'), preview: getIntervalPreview(currentCard?.srs, 'easy'), color: '#3B5A7A' },
  ];

  if (cards.length === 0) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6" style={{ backgroundColor: c.studyBg, color: c.studyText }}>
        <RotateCcw size={48} style={{ color: c.studyMuted }} className="mb-4" />
        <p className="font-serif-cn text-xl mb-2" style={{ color: c.studyText }}>{t('study.no.cards')}</p>
        <p className="text-sm mb-6" style={{ color: c.studyMuted }}>{t('study.all.done')}</p>
        <button
          onClick={handleGoHome}
          className="px-6 py-3 rounded-full text-sm transition"
          style={{ backgroundColor: `${c.studyText}18`, color: c.studyText }}
        >
          {t('study.back.home')}
        </button>
      </div>
    );
  }

  if (isComplete) {
    const total = sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy;
    const accuracy = total > 0 ? ((sessionStats.good + sessionStats.easy) / total * 100).toFixed(0) : '0';
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6" style={{ backgroundColor: c.studyBg, color: c.studyText }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="font-serif-cn text-3xl font-bold mb-2" style={{ color: c.studyText }}>{t('study.complete')}</p>
            <p className="text-sm" style={{ color: c.studyMuted }}>
              {deckName ? `「${deckName}」· ` : ''}{t('study.total.words', { count: total })}
            </p>
          </div>

          <div className="rounded-2xl p-5 mb-6 space-y-3" style={{ backgroundColor: `${c.studyText}0D` }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: c.studyMuted }}>{t('study.accuracy')}</span>
              <span style={{ color: c.accent }} className="font-semibold">{accuracy}%</span>
            </div>
            <div className="h-px" style={{ backgroundColor: `${c.studyText}10` }} />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span style={{ color: c.studyMuted }}>{t('study.fuzzy')}</span>
                <span className="float-right" style={{ color: c.studyText }}>{sessionStats.again + sessionStats.hard}</span>
              </div>
              <div>
                <span style={{ color: c.studyMuted }}>{t('study.remember')}</span>
                <span className="float-right" style={{ color: c.studyText }}>{sessionStats.good + sessionStats.easy}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRestart}
              className="flex-1 py-3 rounded-full text-sm font-medium transition"
              style={{ backgroundColor: `${c.studyText}15`, color: c.studyText }}
            >
              {t('study.restart')}
            </button>
            <button
              onClick={handleGoHome}
              className="flex-1 py-3 rounded-full text-sm font-medium transition"
              style={{ backgroundColor: c.studyText, color: c.studyBg }}
            >
              {t('study.back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col relative" style={{ backgroundColor: c.studyBg, color: c.studyText }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <button
          onClick={handleGoHome}
          className="w-9 h-9 rounded-full flex items-center justify-center transition shrink-0"
          style={{ backgroundColor: `${c.studyText}15` }}
        >
          <X size={18} style={{ color: c.studyText }} />
        </button>
        <div className="flex-1 flex flex-col items-center mx-2 min-w-0">
          {/* 当前词库名称 */}
          {deckName && (
            <span className="text-[10px] mb-0.5 truncate max-w-full" style={{ color: c.studyMuted }}>
              {deckName}
            </span>
          )}
          <div className="flex items-center gap-2 w-full max-w-[140px]">
            <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: `${c.studyText}10` }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${((currentIndex + 1) / cards.length) * 100}%`, backgroundColor: c.progressBar }}
              />
            </div>
            <span className="text-[10px] shrink-0" style={{ color: c.studyMuted }}>{currentIndex + 1}/{cards.length}</span>
          </div>
          {/* Card status tag */}
          {currentCard && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full mt-0.5"
              style={{
                backgroundColor: currentCard.srs.status === 'new' ? `${c.studyText}08`
                  : currentCard.srs.interval < 3 ? `${c.accent}15`
                  : `${c.studyText}08`,
                color: currentCard.srs.status === 'new' ? c.studyMuted
                  : currentCard.srs.interval < 3 ? c.accent
                  : c.studyMuted,
              }}
            >
              {currentCard.srs.status === 'new' ? t('study.card.new')
                : currentCard.srs.interval < 3 ? t('study.card.weak')
                : t('study.card.mastered')}
            </span>
          )}
          {/* Study mode toggle */}
          <button
            onClick={() => {
              const next = studyMode === 'en-zh' ? 'zh-en' : 'en-zh';
              setStudyMode(next);
              setStudyMode(next);
              setShowAnswer(false);
              stopAllAudio();
            }}
            className="text-[10px] px-2 py-0.5 rounded-full mt-0.5 transition"
            style={{ backgroundColor: `${c.studyText}12`, color: c.studyMuted }}
            title={isZhEn ? t('study.mode.zhen.desc') : t('study.mode.enzh.desc')}
          >
            {isZhEn ? t('study.mode.zhen') : t('study.mode.enzh')}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* Auto-play toggle */}
          <button
            onClick={() => setAutoPlay(!autoPlay)}
            className="w-9 h-9 rounded-full flex items-center justify-center transition"
            style={autoPlay
              ? { backgroundColor: `${c.accent}20`, color: c.accent }
              : { backgroundColor: `${c.studyText}15`, color: c.studyMuted }
            }
            title={autoPlay ? t('study.auto.play.on') : t('study.auto.play.off')}
          >
            <Volume2 size={16} />
          </button>
          <button
            onClick={revealAnswer}
            className="w-9 h-9 rounded-full flex items-center justify-center transition"
            style={{ backgroundColor: `${c.studyText}15`, color: c.studyText }}
          >
            {showAnswer ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </header>

      {/* Card body */}
      <main className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <div className={`text-center transition-all duration-500 ${isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
            {/* Front side - question */}
            <div className="flex items-center justify-center gap-3 mb-1">
              <h1 className="font-serif-cn text-5xl font-bold tracking-tight" style={{ color: c.studyText }}>
                {isZhEn ? currentCard.back : currentCard.front}
              </h1>
              <SpeakButton text={isZhEn ? currentCard.back : currentCard.front} size={22} />
            </div>
            {!isZhEn && currentCard.pronunciation && (
              <p className="text-sm font-sans mb-4" style={{ color: c.studyMuted }}>{currentCard.pronunciation}</p>
            )}

            {/* Answer area - back side */}
            <div className={`transition-all duration-500 overflow-hidden ${showAnswer ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className="pt-4" style={{ borderTop: `1px solid ${c.studyText}10` }}>
                {/* Answer word + speak */}
                <div className="flex items-center justify-center gap-2 mb-4">
                  <p className="text-xl font-medium leading-relaxed" style={{ color: c.studyText }}>
                    {isZhEn ? currentCard.front : currentCard.back}
                  </p>
                  <SpeakButton text={isZhEn ? currentCard.front : currentCard.back} size={16} />
                </div>

                {/* Example - split EN/ZH with independent play buttons */}
                {currentCard.example && (
                  <div className="mb-4">
                    {splitExample(currentCard.example).map((seg, i) => (
                      <div key={i} className="flex items-start justify-center gap-2 mb-1">
                        <p
                          className={`text-sm flex-1 text-left leading-relaxed ${seg.lang === 'en' ? 'italic' : ''}`}
                          style={{ color: c.studyMuted, opacity: seg.lang === 'zh' ? 0.8 : 1 }}
                        >
                          {seg.text}
                        </p>
                        <SpeakButton text={seg.text} size={14} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Speak all button */}
                <button
                  onClick={() => {
                    const texts = isZhEn
                      ? [currentCard.back, currentCard.front]
                      : [currentCard.front, currentCard.back];
                    if (currentCard.example) texts.push(currentCard.example);
                    speakSequence(texts);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs transition mb-3"
                  style={{ backgroundColor: `${c.studyText}12`, color: c.studyMuted }}
                >
                  <Volume2 size={12} />
                  {t('study.speak.all')}
                </button>

                {currentCard.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {currentCard.tags.map(tag => (
                      <span
                        key={tag}
                        className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: c.tagBg, color: c.tagText }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Show answer hint */}
          {!showAnswer && (
            <button
              onClick={showAnswerOnly}
              className="w-full mt-12 text-center text-sm py-4 transition"
              style={{ color: c.studyMuted }}
            >
              {t('study.tap.answer')}
            </button>
          )}
        </div>
      </main>

      {/* Rating buttons */}
      {showAnswer && (
        <footer className="px-5 pb-8 pt-4">
          <div className="grid grid-cols-4 gap-2">
            {ratingButtons.map(({ key, label, color, preview }) => (
              <button
                key={key}
                onClick={() => handleRate(key)}
                className="rounded-xl py-3 px-1 text-center hover:opacity-90 active:scale-95 transition-all"
                style={{ backgroundColor: color }}
              >
                <p className="text-xs mb-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{preview}</p>
                <p className="text-sm font-semibold text-white">{label}</p>
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
