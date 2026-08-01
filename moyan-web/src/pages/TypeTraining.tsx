import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  X, RotateCcw, Keyboard, Trophy,
  Volume2, VolumeX, Layers, CalendarDays, ArrowRight,
  Trash2,
} from 'lucide-react';
import { db } from '../db';
import type { Card as LocalCard, Deck as LocalDeck, SRSData } from '../db';
import { t } from '../i18n/translations';
import { getCurrentTheme } from '../theme';
import {
  speak,
  stopAllAudio,
  preloadWebSpeechVoices,
  getSpeechSettings,
} from '../services/speechService';
import {
  deleteTypeResume,
  hasVocabularyBackend,
  getTypeStats,
  getTypeResume,
  listDecks,
  listStudyCards,
  putTypeResume,
  syncTypePractice,
  upsertCardProgress,
} from '../services/vocabularyApi';
import type {
  CardProgress,
  Deck as ApiDeck,
  StudyCard,
  TypeEntry,
  TypeMastery,
  TypeResume,
} from '@/types/vocabulary';
import {
  buildTypeResume,
  buildTypeEntry,
  buildTypeSession,
  canResumeAt,
  egregiousSrsUpdates,
  newPrefixedId,
  toAgainUpsertBody,
  typedStatesFromCharInfos,
} from '../services/typePractice';
import { getCurrentUser } from '../services/authService';

/** Unified card shape for typing practice (API or local) */
interface TypeCard {
  id: string;
  deckId?: string;
  front: string;
  back: string;
  pronunciation?: string | null;
  /** Sentence example text for typing mode */
  exampleText?: string;
  /** Current SRS state (backend mode only) */
  srs?: SRSData;
  localNumericId?: number;
}

interface UiDeck {
  id: string;
  name: string;
  description: string;
  color?: string | null;
  cardCount: number;
}

function defaultSrs(): SRSData {
  return {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueDate: new Date(),
    status: 'new',
  };
}

function progressToSrs(progress: CardProgress | null): SRSData {
  if (!progress) return defaultSrs();
  return {
    interval: progress.interval,
    repetitions: progress.repetitions,
    easeFactor: progress.ease_factor,
    dueDate: new Date(progress.due_date),
    lastReviewed: progress.last_reviewed_at
      ? new Date(progress.last_reviewed_at)
      : undefined,
    status: (progress.srs_status as SRSData['status']) || 'new',
  };
}

function mapApiTypeCard(sc: StudyCard): TypeCard {
  const card = sc.card;
  return {
    id: card.id,
    deckId: card.deck_id,
    front: card.front,
    back: card.back,
    pronunciation: card.pronunciation,
    exampleText: card.examples?.[0]?.sentence_en || undefined,
    srs: progressToSrs(sc.progress),
  };
}

function mapLocalTypeCard(card: LocalCard): TypeCard {
  return {
    id: String(card.id),
    front: card.front,
    back: card.back,
    pronunciation: card.pronunciation,
    exampleText: card.example,
    localNumericId: card.id,
  };
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

// ---- Progress Persistence ----
const TYPE_PROGRESS_KEY = 'moyan_type_progress';
const TYPE_SYNC_INTERVAL_MS = 5000;

interface TypeProgress {
  [deckId: string]: {
    currentIndex: number;
    lastCardId: string;
    timestamp: number;
    resume?: TypeResume;
  };
}

function loadTypeProgress(): TypeProgress {
  try {
    return JSON.parse(localStorage.getItem(TYPE_PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}

function getTypeSavedIndex(deckId: string | null, cards: TypeCard[]): number {
  const key = deckId || 'all';
  const saved = loadTypeProgress()[key];
  if (!saved) return 0;
  const idx = cards.findIndex(c => c.id === String(saved.lastCardId));
  if (idx >= 0) return idx;
  return Math.min(saved.currentIndex, cards.length - 1);
}

function loadLocalResume(deckId: string | null): TypeResume | null {
  const key = deckId || 'all';
  return loadTypeProgress()[key]?.resume ?? null;
}

function clearTypeProgress(deckId: string | null) {
  const key = deckId || 'all';
  const all = loadTypeProgress();
  delete all[key];
  localStorage.setItem(TYPE_PROGRESS_KEY, JSON.stringify(all));
}

// Split example into EN/ZH segments
interface ExampleSegment { text: string; lang: 'en' | 'zh'; }

function splitExample(text: string): ExampleSegment[] {
  const firstCJK = text.search(/[\u4e00-\u9fff]/);
  if (firstCJK === -1) return [{ text, lang: 'en' }];
  const lastCJK = text.search(/[\u4e00-\u9fff][^\u4e00-\u9fff]*$/);
  const cjkEnd = lastCJK >= 0 ? lastCJK + 1 : text.length;
  const enPart = text.slice(0, firstCJK).trim().replace(/[\s—–]+$/, '');
  const zhPart = text.slice(firstCJK, cjkEnd).trim();
  const trailing = text.slice(cjkEnd).trim();
  const segs: ExampleSegment[] = [];
  if (enPart) segs.push({ text: enPart, lang: 'en' });
  if (zhPart || trailing) segs.push({ text: zhPart + (trailing ? ` ${trailing}` : ''), lang: 'zh' });
  return segs;
}

async function clearHistory() {
  await db.typeHistory.clear();
}

/**
 * Deterministic weighted sort for typing practice.
 * Cards needing more practice come first (higher weight = earlier).
 */
async function sortCardsSmart(cards: TypeCard[]): Promise<TypeCard[]> {
  const all = await db.typeHistory.toArray();
  const map: Record<number, { count: number; last: number }> = {};
  for (const h of all) {
    const e = map[h.cardId] || { count: 0, last: 0 };
    e.count++;
    const t = h.createdAt.getTime();
    if (t > e.last) e.last = t;
    map[h.cardId] = e;
  }
  const getWeight = (card: TypeCard): number => {
    if (card.localNumericId == null) return 1000;
    const s = map[card.localNumericId];
    if (!s) return 1000;
    const daysSince = Math.min((Date.now() - s.last) / 86400000, 60);
    return -s.count * 30 + daysSince * 5;
  };
  return [...cards].sort((a, b) => {
    const wa = getWeight(a);
    const wb = getWeight(b);
    if (wa !== wb) return wb - wa;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Backend mode sort: practiced cards come first by mastery score (ascending).
 * Cards without any typing record keep their original relative order.
 */
async function sortByMastery(
  cards: TypeCard[],
  mastery: TypeMastery[] | null
): Promise<TypeCard[]> {
  if (!mastery || mastery.length === 0) return cards;
  const score = new Map(mastery.map((m) => [m.card_id, m.score]));
  // Array#sort is stable: equal keys keep insertion order
  return [...cards].sort(
    (a, b) =>
      (score.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (score.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

type TrainMode = 'word' | 'sentence';
type CharState = 'pending' | 'correct' | 'wrong';

interface CharInfo {
  char: string;
  state: CharState;
  inputChar?: string;
}

interface SessionStats {
  totalChars: number;
  correctChars: number;
  wrongChars: number;
  startTime: number;
  endTime?: number;
  completedWords: number;
  skippedWords: number;
}

export default function TypeTraining() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deckId = searchParams.get('deck');
  const backend = hasVocabularyBackend();
  const theme = getCurrentTheme();
  const c = theme.colors;

  const [cards, setCards] = useState<TypeCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<TrainMode>('word');
  const [charInfos, setCharInfos] = useState<CharInfo[]>([]);
  const [inputIndex, setInputIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [shakeWrong, setShakeWrong] = useState(false);
  const [stats, setStats] = useState<SessionStats>({
    totalChars: 0, correctChars: 0, wrongChars: 0,
    startTime: 0, completedWords: 0, skippedWords: 0,
  });
  const [wpm, setWpm] = useState(0);
  const [accuracy, setAccuracy] = useState(100);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [autoPlay, setAutoPlay] = useState(() => getSpeechSettings().autoPlay);
  const [deckName, setDeckName] = useState<string>('');
  const [showDeckPicker, setShowDeckPicker] = useState(!deckId);
  const [decks, setDecks] = useState<UiDeck[]>([]);
  const [pickerReady, setPickerReady] = useState(false);
  const [loadError, setLoadError] = useState<string>('');

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<{
    cardId: string;
    correctChars: number;
    wrongChars: number;
    startedAt: number;
  } | null>(null);
  const entriesRef = useRef<TypeEntry[]>([]);
  const skippedCountRef = useRef(0);
  const startTimeRef = useRef(0);
  const syncedCountRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreatedAtRef = useRef('');
  const sessionFinishedRef = useRef(false);
  const syncTickRef = useRef<() => void>(() => {});
  const resumePutChainRef = useRef<Promise<void>>(Promise.resolve());

  const currentCard = cards[currentIndex];

  useEffect(() => {
    if (!deckId) {
      const load = async () => {
        try {
          if (backend) {
            if (!getCurrentUser()) {
              navigate('/login');
              return;
            }
            const remote = await listDecks();
            setDecks(remote.map(mapApiDeck));
          } else {
            const all = await db.decks.toArray();
            setDecks(all.map(mapLocalDeck));
          }
        } catch (err: unknown) {
          setLoadError('DB error: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setPickerReady(true);
        }
      };
      void load();
    }
  }, [deckId, backend]);

  const buildTarget = (card: TypeCard, trainMode: TrainMode): string => {
    if (trainMode === 'word') {
      return card.front;
    }
    const example = card.exampleText;
    if (example && example.toLowerCase().includes(card.front.toLowerCase())) {
      return example;
    }
    return `${card.back} (${card.front})`;
  };

  const isTargetChar = (card: TypeCard, fullText: string, pos: number): boolean => {
    if (mode !== 'sentence') return true;
    const word = card.front;
    const lowerText = fullText.toLowerCase();
    const lowerWord = word.toLowerCase();
    let idx = lowerText.indexOf(lowerWord);
    while (idx !== -1) {
      if (pos >= idx && pos < idx + word.length) return true;
      idx = lowerText.indexOf(lowerWord, idx + 1);
    }
    return false;
  };

  const initCharInfos = (card: TypeCard, trainMode: TrainMode) => {
    const target = buildTarget(card, trainMode);
    const infos: CharInfo[] = target.split('').map((char, i) => ({
      char,
      state: isTargetChar(card, target, i) ? 'pending' : 'correct',
    }));
    setCharInfos(infos);
    const firstPending = infos.findIndex(info => info.state === 'pending');
    setInputIndex(firstPending >= 0 ? firstPending : 0);
  };

  const initCharInfosFromResume = (
    card: TypeCard,
    trainMode: TrainMode,
    resume: TypeResume
  ) => {
    const target = buildTarget(card, trainMode);
    const infos: CharInfo[] = target.split('').map((char, i) => {
      const typed = i < resume.char_index ? resume.typed_states[i] : undefined;
      if (typed) {
        return { char, state: typed.state, inputChar: typed.input_char ?? undefined };
      }
      return { char, state: isTargetChar(card, target, i) ? 'pending' : 'correct' };
    });
    setCharInfos(infos);
    let next = Math.min(resume.char_index, target.length);
    while (next < target.length && !isTargetChar(card, target, next)) {
      next++;
    }
    setInputIndex(next >= target.length ? target.length : next);
  };

  const speakCurrent = async () => {
    if (!currentCard) return;
    try {
      await stopAllAudio();
      await speak(currentCard.front);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!deckId && showDeckPicker) return;
    const load = async () => {
      try {
        let loaded: TypeCard[];
        if (backend) {
          if (!getCurrentUser()) {
            navigate('/login');
            return;
          }
          if (deckId) {
            const studyCards = await listStudyCards(deckId);
            loaded = studyCards.map(mapApiTypeCard);
            const decksList = await listDecks();
            const d = decksList.find(x => x.id === deckId);
            if (d) setDeckName(d.name);
          } else {
            const decksList = await listDecks();
            const allCards: TypeCard[] = [];
            for (const d of decksList) {
              const studyCards = await listStudyCards(d.id);
              allCards.push(...studyCards.map(mapApiTypeCard));
            }
            loaded = allCards;
          }
        } else if (deckId) {
          const localCards = await db.cards.where('deckId').equals(Number(deckId)).toArray();
          loaded = localCards.map(mapLocalTypeCard);
          const d = await db.decks.get(Number(deckId));
          if (d) setDeckName(d.name);
        } else {
          const localCards = await db.cards.toArray();
          loaded = localCards.map(mapLocalTypeCard);
        }
        if (backend) {
          let mastery: TypeMastery[] | null = null;
          try {
            mastery = (await getTypeStats()).mastery;
          } catch {
            // stats unavailable → keep original order
          }
          loaded = await sortByMastery(loaded, mastery);
        } else {
          loaded = await sortCardsSmart(loaded);
        }
        setCards(loaded);
        if (loaded.length > 0) {
          const localResume = loadLocalResume(deckId);
          let resume: TypeResume | null = null;
          if (backend) {
            try {
              resume = await getTypeResume(deckId);
            } catch {
              resume = null;
            }
          }
          // prefer whichever checkpoint is newer (localStorage may be fresher
          // when the backend PUT failed or the page left before it landed)
          if (!resume || (localResume && localResume.updated_at > resume.updated_at)) {
            resume = localResume;
          }
          let savedIdx = getTypeSavedIndex(deckId, loaded);
          if (resume) {
            const idx = loaded.findIndex((c) => c.id === resume.card_id);
            if (idx >= 0) savedIdx = idx;
          }
          setCurrentIndex(savedIdx);
          const firstCard = loaded[savedIdx];
          if (
            firstCard &&
            resume &&
            canResumeAt(resume, mode, buildTarget(firstCard, mode))
          ) {
            initCharInfosFromResume(firstCard, mode, resume);
            wordRef.current = {
              cardId: firstCard.id,
              correctChars: resume.correct_chars,
              wrongChars: resume.wrong_chars,
              startedAt: Date.now(),
            };
          } else {
            initCharInfos(firstCard, mode);
          }
          if (autoPlay) {
            setTimeout(() => speak(firstCard.front).catch(() => {}), 300);
          }
        }
      } catch (err) {
        console.error('[Type] load failed:', err);
        setLoadError('Load error: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    void load();
    preloadWebSpeechVoices();
  }, [deckId, mode, showDeckPicker, backend]);

  useEffect(() => {
    if (currentCard) {
      initCharInfos(currentCard, mode);
    }
  }, [mode]);

  useEffect(() => {
    if (!isStarted || stats.startTime === 0) return;
    const interval = setInterval(() => {
      const elapsedMs = Date.now() - stats.startTime;
      const elapsed = elapsedMs / 1000 / 60;
      setElapsedSec(Math.floor(elapsedMs / 1000));
      if (elapsed > 0) {
        setWpm(Math.round(stats.correctChars / 5 / elapsed));
      }
      const total = stats.correctChars + stats.wrongChars;
      if (total > 0) {
        setAccuracy(Math.round((stats.correctChars / total) * 100));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isStarted, stats]);

  useEffect(() => {
    return () => stopAllAudio();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isStarted) {
      setIsStarted(true);
      const now = Date.now();
      startTimeRef.current = now;
      setStats(prev => ({ ...prev, startTime: now }));
    }
    if (isComplete || !currentCard) return;
    if (!wordRef.current || wordRef.current.cardId !== currentCard.id) {
      wordRef.current = {
        cardId: currentCard.id,
        correctChars: 0,
        wrongChars: 0,
        startedAt: Date.now(),
      };
    }

    const target = buildTarget(currentCard, mode);

    if (e.key === ' ') {
      const expected = target[inputIndex];
      if (expected !== ' ') {
        e.preventDefault();
        speakCurrent();
        return;
      }
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (inputIndex > 0) {
        let prevIndex = inputIndex - 1;
        while (prevIndex >= 0 && !isTargetChar(currentCard, target, prevIndex)) {
          prevIndex--;
        }
        if (prevIndex >= 0) {
          setCharInfos(prev => {
            const next = [...prev];
            next[prevIndex] = { ...next[prevIndex], state: 'pending', inputChar: undefined };
            return next;
          });
          setInputIndex(prevIndex);
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      goNextCard(true);
      return;
    }

    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();

    const expected = target[inputIndex];
    const typed = e.key;
    const isCorrect = typed === expected;

    setCharInfos(prev => {
      const next = [...prev];
      next[inputIndex] = { ...next[inputIndex], state: isCorrect ? 'correct' : 'wrong', inputChar: typed };
      return next;
    });

    setStats(prev => ({
      ...prev,
      totalChars: prev.totalChars + 1,
      correctChars: prev.correctChars + (isCorrect ? 1 : 0),
      wrongChars: prev.wrongChars + (isCorrect ? 0 : 1),
    }));
    if (wordRef.current) {
      wordRef.current.correctChars += isCorrect ? 1 : 0;
      wordRef.current.wrongChars += isCorrect ? 0 : 1;
    }

    if (!isCorrect) {
      setShakeWrong(true);
      setTimeout(() => setShakeWrong(false), 300);
    }

    let nextIdx = inputIndex + 1;
    while (nextIdx < target.length && !isTargetChar(currentCard, target, nextIdx)) {
      nextIdx++;
    }

    if (nextIdx >= target.length) {
      setStats(prev => ({ ...prev, completedWords: prev.completedWords + 1 }));
      setTimeout(() => goNextCard(false), 400);
    } else {
      setInputIndex(nextIdx);
    }
  };

  const buildCurrentResume = (): TypeResume | null => {
    if (!currentCard) return null;
    const target = buildTarget(currentCard, mode);
    const active =
      wordRef.current?.cardId === currentCard.id ? wordRef.current : null;
    return buildTypeResume({
      deckId: deckId ?? '',
      deckName: deckName || null,
      mode,
      cardId: currentCard.id,
      target,
      charIndex: inputIndex,
      correctChars: active?.correctChars ?? 0,
      wrongChars: active?.wrongChars ?? 0,
      typedStates: typedStatesFromCharInfos(charInfos, inputIndex),
      updatedAt: new Date().toISOString(),
    });
  };

  const persistResume = (resume: TypeResume, index: number) => {
    const key = deckId || 'all';
    const all = loadTypeProgress();
    all[key] = {
      currentIndex: index,
      lastCardId: resume.card_id,
      timestamp: Date.now(),
      resume,
    };
    localStorage.setItem(TYPE_PROGRESS_KEY, JSON.stringify(all));
    if (backend) {
      // serialize PUTs so an older checkpoint can never land after a newer one
      resumePutChainRef.current = resumePutChainRef.current
        .catch(() => {})
        .then(() => putTypeResume(resume))
        .catch(() => {});
    }
  };

  const clearResume = () => {
    if (backend) {
      deleteTypeResume(deckId).catch(() => {});
    }
  };

  const finalizeWord = (card: TypeCard, skipped: boolean) => {
    const w = wordRef.current;
    if (backend && w) {
      entriesRef.current.push(
        buildTypeEntry({
          id: newPrefixedId('te_'),
          cardId: card.id,
          deckId: card.deckId || deckId || 'all',
          mode,
          correctChars: w.correctChars,
          wrongChars: w.wrongChars,
          durationMs: Date.now() - w.startedAt,
          skipped,
          createdAt: new Date().toISOString(),
        })
      );
      if (skipped) skippedCountRef.current += 1;
    }
    wordRef.current = null;
  };

  const applySrsAgain = async (entries: TypeEntry[]) => {
    const srsByCard = new Map(
      cards.filter((c) => c.srs).map((c) => [c.id, c.srs!])
    );
    const updates = egregiousSrsUpdates(entries, srsByCard);
    if (updates.length > 0) {
      await Promise.allSettled(
        updates.map(({ cardId, srs }) =>
          upsertCardProgress(cardId, toAgainUpsertBody(srs))
        )
      );
    }
  };

  const ensureSessionMeta = () => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = newPrefixedId('ts_');
      sessionCreatedAtRef.current = new Date().toISOString();
    }
  };

  /** Upload one batch; the session summary covers all entries so far (idempotent upsert). */
  const pushSync = async (
    summaryEntries: TypeEntry[],
    sendEntries: TypeEntry[]
  ): Promise<boolean> => {
    if (sendEntries.length === 0) return true;
    ensureSessionMeta();
    const session = buildTypeSession({
      id: sessionIdRef.current!,
      deckId,
      deckName: deckName || null,
      mode,
      entries: summaryEntries,
      totalCards: cards.length,
      skipped: skippedCountRef.current,
      durationMs: Math.max(Date.now() - startTimeRef.current, 0),
      createdAt: sessionCreatedAtRef.current,
    });
    try {
      await syncTypePractice({ session, entries: sendEntries });
      return true;
    } catch {
      // silent: next throttled tick retries unsynced entries
      return false;
    }
  };

  /** Throttled sync of completed words + current checkpoint. */
  const syncIncremental = async () => {
    if (!backend || sessionFinishedRef.current) return;
    const all = entriesRef.current;
    const pending = all.slice(syncedCountRef.current);
    if (pending.length === 0) return;
    if (await pushSync(all, pending)) {
      syncedCountRef.current = all.length;
      await applySrsAgain(pending);
    }
  };

  /** Final flush: session end or page leave. */
  const flushSession = async (abandoned: boolean) => {
    if (!backend || sessionFinishedRef.current) return;
    const all = [...entriesRef.current];
    if (abandoned && wordRef.current) {
      const w = wordRef.current;
      const card = cards.find((c) => c.id === w.cardId);
      if (card) {
        all.push(
          buildTypeEntry({
            id: newPrefixedId('te_'),
            cardId: card.id,
            deckId: card.deckId || deckId || 'all',
            mode,
            correctChars: w.correctChars,
            wrongChars: w.wrongChars,
            durationMs: Date.now() - w.startedAt,
            skipped: true,
            createdAt: new Date().toISOString(),
          })
        );
      }
    }
    if (all.length === 0) {
      sessionFinishedRef.current = true;
      return;
    }
    const pending = all.slice(syncedCountRef.current);
    if (await pushSync(all, pending.length > 0 ? pending : all)) {
      syncedCountRef.current = all.length;
      await applySrsAgain(pending);
    }
    sessionFinishedRef.current = true;
  };

  useEffect(() => {
    syncTickRef.current = () => {
      void syncIncremental();
      if (wordRef.current || inputIndex > 0) {
        const resume = buildCurrentResume();
        if (resume) persistResume(resume, currentIndex);
      }
    };
  });

  useEffect(() => {
    if (!backend || !isStarted || isComplete) return;
    const id = setInterval(() => syncTickRef.current(), TYPE_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [backend, isStarted, isComplete]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentCard && !isComplete) {
        const resume = buildCurrentResume();
        if (resume) persistResume(resume, currentIndex);
      }
      void flushSession(true);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentCard, currentIndex, deckId, isComplete, backend, cards, deckName, mode, charInfos, inputIndex]);

  const applySort = async (list: TypeCard[]): Promise<TypeCard[]> => {
    if (backend) {
      let mastery: TypeMastery[] | null = null;
      try {
        mastery = (await getTypeStats()).mastery;
      } catch {
        // stats unavailable → keep original order
      }
      return sortByMastery(list, mastery);
    }
    return sortCardsSmart(list);
  };

  const goNextCard = (isSkip: boolean) => {
    stopAllAudio();
    if (currentCard) {
      finalizeWord(currentCard, isSkip);
    }
    if (currentIndex < cards.length - 1) {
      const nextIndex = currentIndex + 1;
      const nxt = cards[nextIndex];
      if (nxt) {
        persistResume(
          buildTypeResume({
            deckId: deckId ?? '',
            deckName: deckName || null,
            mode,
            cardId: nxt.id,
            target: buildTarget(nxt, mode),
            charIndex: 0,
            correctChars: 0,
            wrongChars: 0,
            typedStates: [],
            updatedAt: new Date().toISOString(),
          }),
          nextIndex
        );
      }
      setCurrentIndex(nextIndex);
      if (nxt) {
        initCharInfos(nxt, mode);
        if (autoPlay) {
          setTimeout(() => speak(nxt.front).catch(() => {}), 200);
        }
      }
      if (isSkip) {
        setStats(prev => ({ ...prev, skippedWords: prev.skippedWords + 1 }));
      }
    } else {
      clearTypeProgress(deckId);
      clearResume();
      void flushSession(false);
      setIsComplete(true);
      setStats(prev => ({ ...prev, endTime: Date.now() }));
    }
  };

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlay(next);
    const s = getSpeechSettings();
    s.autoPlay = next;
    localStorage.setItem('speech_settings', JSON.stringify(s));
    if (next && currentCard) {
      speak(currentCard.front).catch(() => {});
    }
  };

  const handleRestart = async () => {
    clearTypeProgress(deckId);
    clearResume();
    setCurrentIndex(0);
    setIsComplete(false);
    setIsStarted(false);
    setStats({ totalChars: 0, correctChars: 0, wrongChars: 0, startTime: 0, completedWords: 0, skippedWords: 0 });
    setWpm(0);
    setAccuracy(100);
    setElapsedSec(0);
    wordRef.current = null;
    entriesRef.current = [];
    skippedCountRef.current = 0;
    startTimeRef.current = 0;
    syncedCountRef.current = 0;
    sessionIdRef.current = null;
    sessionCreatedAtRef.current = '';
    sessionFinishedRef.current = false;
    const sorted = await applySort(cards);
    setCards(sorted);
    if (sorted.length > 0) {
      initCharInfos(sorted[0], mode);
      if (autoPlay) {
        setTimeout(() => speak(sorted[0].front).catch(() => {}), 300);
      }
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleGoHome = () => {
    stopAllAudio();
    window.location.href = '/';
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentIndex, mode, showDeckPicker]);

  if (!deckId && showDeckPicker) {
    const thirtyDayDecks = decks.filter(d => d.name === '30天词汇');
    const otherDecks = decks.filter(d => d.name !== '30天词汇');

    return (
      <div className="min-h-[100dvh] flex flex-col relative" style={{ backgroundColor: c.studyBg, color: c.studyText }}>
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <button
            onClick={handleGoHome}
            className="w-9 h-9 rounded-full flex items-center justify-center transition shrink-0"
            style={{ backgroundColor: `${c.studyText}15` }}
          >
            <X size={18} style={{ color: c.studyText }} />
          </button>
          <p className="text-sm font-medium" style={{ color: c.studyText }}>
            {t('type.select.deck')}
          </p>
          <div className="w-9" />
        </header>

        <main className="flex-1 px-5 py-4 overflow-y-auto">
          <div className="max-w-lg mx-auto space-y-4">
            <button
              onClick={() => {
                setShowDeckPicker(false);
                navigate('/type');
              }}
              className="w-full text-left p-4 rounded-2xl transition-all active:scale-[0.99]"
              style={{ backgroundColor: c.accent }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                  <Layers size={20} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-white">{t('type.all.cards')}</h3>
                  <p className="text-[11px] text-white/60">{t('type.all.cards.desc')}</p>
                </div>
                <ArrowRight size={18} className="text-white/60" />
              </div>
            </button>

            {thirtyDayDecks.length > 0 && (
              <div>
                <h3 className="text-xs font-medium mb-2 px-1 flex items-center gap-1" style={{ color: c.studyMuted }}>
                  <CalendarDays size={12} />30天词汇
                </h3>
                <div className="space-y-2">
                  {thirtyDayDecks.map(deck => (
                    <button
                      key={deck.id}
                      onClick={() => { setShowDeckPicker(false); navigate(`/type?deck=${deck.id}`); }}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.99]"
                      style={{ backgroundColor: `${c.studyText}08` }}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: deck.color || c.accent }} />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate" style={{ color: c.studyText }}>{deck.name}</h4>
                        <p className="text-[10px]" style={{ color: c.studyMuted }}>{deck.cardCount}{t('word')}</p>
                      </div>
                      <ArrowRight size={14} style={{ color: c.studyMuted }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {otherDecks.length > 0 && (
              <div>
                <h3 className="text-xs font-medium mb-2 px-1" style={{ color: c.studyMuted }}>{t('decks.title')}</h3>
                <div className="space-y-2">
                  {otherDecks.map(deck => (
                    <button
                      key={deck.id}
                      onClick={() => { setShowDeckPicker(false); navigate(`/type?deck=${deck.id}`); }}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.99]"
                      style={{ backgroundColor: `${c.studyText}08` }}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: deck.color || c.accent }} />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate" style={{ color: c.studyText }}>{deck.name}</h4>
                        <p className="text-[10px] truncate" style={{ color: c.studyMuted }}>{deck.description || ''}</p>
                      </div>
                      <span className="text-[10px] shrink-0" style={{ color: c.studyMuted }}>{deck.cardCount}{t('word')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadError && (
              <div className="text-center py-6 px-4 rounded-xl" style={{ backgroundColor: `${c.accent}15` }}>
                <p className="text-sm" style={{ color: c.accent }}>{loadError}</p>
              </div>
            )}
            {decks.length === 0 && pickerReady && !loadError && (
              <div className="text-center py-12">
                <Keyboard size={48} style={{ color: c.studyMuted }} className="mx-auto mb-4" />
                <p className="font-serif-cn text-xl" style={{ color: c.studyText }}>{t('type.no.decks')}</p>
                <p className="text-sm mt-2" style={{ color: c.studyMuted }}>{t('type.import.first')}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (isComplete) {
    const totalTime = stats.endTime ? Math.round((stats.endTime - stats.startTime) / 1000) : 0;
    const finalWpm = totalTime > 0 ? Math.round(stats.correctChars / 5 / (totalTime / 60)) : 0;
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6" style={{ backgroundColor: c.studyBg, color: c.studyText }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Trophy size={48} style={{ color: c.accent }} className="mx-auto mb-4" />
            <p className="font-serif-cn text-3xl font-bold mb-2" style={{ color: c.studyText }}>{t('study.complete')}</p>
            <p className="text-sm" style={{ color: c.studyMuted }}>
              {deckName ? `「${deckName}」· ` : ''}{mode === 'word' ? t('type.word.mode') : t('type.sentence.mode')}
            </p>
          </div>
          <div className="rounded-2xl p-5 mb-6 space-y-4" style={{ backgroundColor: `${c.studyText}0D` }}>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div><p className="text-2xl font-bold" style={{ color: c.accent }}>{finalWpm}</p><p className="text-xs" style={{ color: c.studyMuted }}>WPM</p></div>
              <div><p className="text-2xl font-bold" style={{ color: c.accent }}>{accuracy}%</p><p className="text-xs" style={{ color: c.studyMuted }}>{t('study.accuracy')}</p></div>
              <div><p className="text-2xl font-bold" style={{ color: c.studyText }}>{stats.completedWords}</p><p className="text-xs" style={{ color: c.studyMuted }}>{t('type.words.completed')}</p></div>
              <div><p className="text-2xl font-bold" style={{ color: c.studyText }}>{Math.round(totalTime / 60)}:{String(totalTime % 60).padStart(2, '0')}</p><p className="text-xs" style={{ color: c.studyMuted }}>{t('type.time')}</p></div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <button onClick={handleRestart} className="flex-1 py-3 rounded-full text-sm font-medium transition flex items-center justify-center gap-2" style={{ backgroundColor: `${c.studyText}15`, color: c.studyText }}>
                <RotateCcw size={16} />{t('study.restart')}
              </button>
              <button onClick={handleGoHome} className="flex-1 py-3 rounded-full text-sm font-medium transition" style={{ backgroundColor: c.studyText, color: c.studyBg }}>
                {t('study.back')}
              </button>
            </div>
            <button
              onClick={async () => {
                if (window.confirm(t('type.history.clear.confirm'))) {
                  await clearHistory();
                  handleRestart();
                }
              }}
              className="w-full py-2.5 rounded-full text-xs transition flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'transparent', color: c.studyMuted }}
            >
              <Trash2 size={13} />{t('type.history.clear')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const nextCard = cards[currentIndex + 1];
  const wordProgress = charInfos.length > 0
    ? Math.round((charInfos.filter(ch => ch.state !== 'pending').length / charInfos.length) * 100)
    : 0;
  const targetPendingTotal = charInfos.filter((_, i) => {
    if (!currentCard) return false;
    return isTargetChar(currentCard, buildTarget(currentCard, mode), i);
  }).length;
  const targetTyped = charInfos.filter((info, i) => {
    if (!currentCard) return false;
    if (!isTargetChar(currentCard, buildTarget(currentCard, mode), i)) return false;
    return info.state !== 'pending';
  }).length;
  const typedProgress = targetPendingTotal > 0 ? (targetTyped / targetPendingTotal) * 100 : 0;
  const timeLabel = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;
  const cardSurface = `${c.studyText}0D`;
  const cardBorder = `${c.studyText}14`;
  const correctColor = c.studyText === '#FFFFFF' ? '#4ade80' : '#2B5A3B';
  const pendingColor = c.studyMuted;

  return (
    <div
      className="min-h-[100dvh] flex flex-col relative"
      style={{ backgroundColor: c.studyBg, color: c.studyText }}
      onClick={handleContainerClick}
      ref={containerRef}
    >
      <input
        ref={inputRef}
        type="text"
        className="absolute opacity-0 w-0 h-0"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
      />

      <header className="px-4 pt-4 pb-2">
        <div
          className="max-w-3xl mx-auto flex items-center gap-2 sm:gap-3 px-3 py-2.5 rounded-2xl shadow-lg backdrop-blur-sm"
          style={{ backgroundColor: cardSurface, border: `1px solid ${cardBorder}` }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); handleGoHome(); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition"
            style={{ backgroundColor: `${c.studyText}12` }}
            aria-label="close"
          >
            <X size={16} style={{ color: c.studyText }} />
          </button>

          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto">
            <span
              className="text-xs px-2 py-1 rounded-lg whitespace-nowrap shrink-0"
              style={{ backgroundColor: `${c.studyText}10`, color: c.studyMuted }}
            >
              {deckName || t('type.all.cards')}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setMode(mode === 'word' ? 'sentence' : 'word'); }}
              className="text-xs px-2 py-1 rounded-lg whitespace-nowrap shrink-0 transition"
              style={{ backgroundColor: `${c.accent}18`, color: c.accent }}
            >
              {mode === 'word' ? t('type.word.mode') : t('type.sentence.mode')}
            </button>
            <span className="text-[11px] tabular-nums shrink-0" style={{ color: c.studyMuted }}>
              {currentIndex + 1}/{cards.length}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); if (currentCard) speak(currentCard.front).catch(() => {}); }}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition"
              style={{ backgroundColor: `${c.studyText}12`, color: c.studyMuted }}
              title={t('study.speak.all')}
            >
              <Volume2 size={15} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleAutoPlay(); }}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition"
              style={autoPlay
                ? { backgroundColor: `${c.accent}22`, color: c.accent }
                : { backgroundColor: `${c.studyText}12`, color: c.studyMuted }
              }
              title={autoPlay ? t('study.auto.play.on') : t('study.auto.play.off')}
            >
              {autoPlay ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNextCard(true); }}
              className="hidden sm:inline-flex h-9 px-3 rounded-xl text-xs font-medium items-center transition"
              style={{ backgroundColor: c.accent, color: '#fff' }}
            >
              {t('type.skip')}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 relative">
        {nextCard && (
          <div
            className="absolute top-2 right-6 max-w-[40%] text-right pointer-events-none opacity-30"
            aria-hidden
          >
            <p className="text-[10px] mb-0.5" style={{ color: c.studyMuted }}>{t('type.next')} →</p>
            <p className="text-sm font-mono truncate" style={{ color: c.studyText }}>{nextCard.front}</p>
            <p className="text-[11px] truncate" style={{ color: c.studyMuted }}>{nextCard.back}</p>
          </div>
        )}

        <div className="w-full max-w-2xl">
          {!isStarted && (
            <p className="text-center text-sm mb-8 animate-pulse" style={{ color: c.studyMuted }}>
              {t('type.press.any.key')}
            </p>
          )}

          <div className={`text-center select-none ${shakeWrong ? 'animate-shake' : ''}`}>
            <div className="inline-flex flex-wrap items-baseline justify-center font-mono text-4xl md:text-5xl tracking-wide leading-tight min-h-[3.5rem]">
              {charInfos.map((info, i) => {
                const isCursor = i === inputIndex;
                const isPreFilled = mode === 'sentence' && info.state === 'correct' && !info.inputChar;
                let color = pendingColor;
                if (isPreFilled) color = `${c.studyMuted}`;
                else if (info.state === 'correct') color = correctColor;
                else if (info.state === 'wrong') color = c.accent;
                else if (info.state === 'pending') color = pendingColor;

                return (
                  <span key={i} className="relative inline-block" style={{ color }}>
                    <span
                      className={isPreFilled ? 'text-lg md:text-xl opacity-50' : ''}
                      style={{
                        textDecoration: info.state === 'wrong' ? 'underline' : undefined,
                        textDecorationColor: info.state === 'wrong' ? c.accent : undefined,
                      }}
                    >
                      {info.char === ' ' ? '\u00A0' : info.char}
                    </span>
                    {isCursor && (
                      <span
                        className="absolute left-0 bottom-0 w-full h-[2px] rounded-full animate-pulse"
                        style={{ backgroundColor: c.accent }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {currentCard && (
            <div className="mt-6 text-center space-y-1.5">
              {currentCard.pronunciation && (
                <p className="text-sm font-mono" style={{ color: c.studyMuted }}>
                  {currentCard.pronunciation}
                </p>
              )}
              <p className="text-base md:text-lg" style={{ color: c.studyText, opacity: 0.85 }}>
                {currentCard.back}
              </p>
              {mode === 'sentence' && (
                <p className="text-xs pt-1" style={{ color: c.accent }}>
                  {t('type.target.word')}: <span className="font-mono font-semibold">{currentCard.front}</span>
                </p>
              )}
            </div>
          )}

          <div className="mt-8 mx-auto max-w-xs">
            <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: `${c.studyText}12` }}>
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${typedProgress || wordProgress}%`, backgroundColor: c.progressBar || c.accent }}
              />
            </div>
          </div>

          {currentCard?.exampleText && mode === 'word' && (
            <div className="mt-6 max-w-lg mx-auto space-y-1 opacity-60">
              {splitExample(currentCard.exampleText).map((seg, i) => (
                <div key={i} className="flex items-start justify-center gap-2">
                  <p
                    className={`text-xs flex-1 text-center leading-relaxed ${seg.lang === 'en' ? 'italic' : ''}`}
                    style={{ color: c.studyMuted }}
                  >
                    {seg.text}
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); speak(seg.text).catch(() => {}); }}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition"
                    style={{ backgroundColor: `${c.studyText}12`, color: c.studyMuted }}
                  >
                    <Volume2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="px-4 pb-6 pt-2">
        <div
          className="max-w-3xl mx-auto rounded-2xl shadow-lg px-2 py-4 backdrop-blur-sm"
          style={{ backgroundColor: cardSurface, border: `1px solid ${cardBorder}` }}
        >
          <div className="grid grid-cols-5 gap-1 text-center">
            {[
              { value: timeLabel, label: t('type.time') },
              { value: String(stats.totalChars), label: t('type.inputs') },
              { value: String(wpm), label: 'WPM' },
              { value: String(stats.correctChars), label: t('type.correct.count') },
              { value: `${accuracy}`, label: t('study.accuracy') },
            ].map((item) => (
              <div key={item.label} className="px-1">
                <p className="text-xl sm:text-2xl font-semibold tabular-nums tracking-tight" style={{ color: c.studyText }}>
                  {item.value}
                </p>
                <div className="mx-auto mt-1.5 mb-1 h-px w-8" style={{ backgroundColor: `${c.studyText}22` }} />
                <p className="text-[10px] sm:text-xs" style={{ color: c.studyMuted }}>{item.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3 text-[10px]" style={{ color: c.studyMuted }}>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: `${c.studyText}12` }}>Space</kbd>
              {t('type.speak')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: `${c.studyText}12` }}>Enter</kbd>
              {t('type.skip')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: `${c.studyText}12` }}>⌫</kbd>
              {t('type.delete')}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
