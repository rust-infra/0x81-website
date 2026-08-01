import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createReviewLog,
  listStudyCards,
  upsertCardProgress,
} from '../../lib/api';
import { calculateSRS, progressToSrs } from '../../lib/srs';
import { useTheme } from '../../lib/theme-context';
import type { StudyCard } from '../../lib/types';

type Rating = 'again' | 'hard' | 'good' | 'easy';

export default function StudyScreen() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const cardStartRef = useRef(Date.now());

  const load = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const cards = await listStudyCards(deckId);
      const now = Date.now();
      const due = cards.filter(
        (sc) =>
          !sc.progress || new Date(sc.progress.due_date).getTime() <= now
      );
      // 到期优先，新词其次，保持稳定顺序
      const sorted = [...due].sort((a, b) => {
        const aDue = a.progress ? new Date(a.progress.due_date).getTime() : Infinity;
        const bDue = b.progress ? new Date(b.progress.due_date).getTime() : Infinity;
        if (aDue !== bDue) return aDue - bDue;
        if (!a.progress && !b.progress) return a.card.created_at.localeCompare(b.card.created_at);
        return 0;
      });
      setQueue(sorted);
      setIndex(0);
      setShowAnswer(false);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = queue[index];

  useEffect(() => {
    if (current && !showAnswer) {
      cardStartRef.current = Date.now();
      if (current.card.pronunciation) {
        Speech.speak(current.card.pronunciation, { language: 'en-US' });
      }
    }
  }, [current, showAnswer]);

  const handleRate = async (rating: Rating) => {
    if (!current || transitioning) return;
    setTransitioning(true);
    const timeTakenMs = Date.now() - cardStartRef.current;
    const updatedSRS = calculateSRS(progressToSrs(current.progress), rating);
    try {
      await upsertCardProgress(current.card.id, {
        srs_status: updatedSRS.status,
        interval: updatedSRS.interval,
        repetitions: updatedSRS.repetitions,
        ease_factor: updatedSRS.easeFactor,
        due_date: updatedSRS.dueDate.toISOString(),
        last_reviewed_at: new Date().toISOString(),
      });
      await createReviewLog({
        card_id: current.card.id,
        deck_id: current.card.deck_id,
        rating,
        time_ms: timeTakenMs,
      });
    } catch {
      // 静默失败，不打断学习
    }
    setShowAnswer(false);
    setIndex((i) => i + 1);
    setTransitioning(false);
  };

  const renderContent = () => {
    if (loading) {
      return <Text style={{ color: c.inkMuted }}>加载中...</Text>;
    }
    if (queue.length === 0 || index >= queue.length) {
      return (
        <View style={styles.center}>
          <Text style={[styles.doneTitle, { color: c.ink }]}>本次复习完成</Text>
          <Pressable style={[styles.button, { backgroundColor: c.accent }]} onPress={() => router.back()}>
            <Text style={styles.buttonText}>返回</Text>
          </Pressable>
        </View>
      );
    }
    if (!current) return null;

    return (
      <View style={styles.cardArea}>
        <Text style={[styles.progress, { color: c.inkMuted }]}>
          {index + 1} / {queue.length}
        </Text>
        <Pressable style={[styles.card, { backgroundColor: c.studyCard }]} onPress={() => setShowAnswer(true)}>
          {!showAnswer ? (
            <>
              <Text style={[styles.front, { color: c.studyText }]}>{current.card.front}</Text>
              {current.card.pronunciation ? (
                <Text style={[styles.pron, { color: c.studyMuted }]}>
                  {current.card.pronunciation}
                </Text>
              ) : null}
              <Text style={[styles.tapHint, { color: c.studyMuted }]}>点击查看释义</Text>
            </>
          ) : (
            <>
              <Text style={[styles.back, { color: c.studyText }]}>{current.card.back}</Text>
              <View style={styles.ratings}>
                {(['again', 'hard', 'good', 'easy'] as Rating[]).map((rating) => (
                  <Pressable
                    key={rating}
                    style={[styles.ratingBtn, { backgroundColor: `${c.accent}22` }]}
                    onPress={() => handleRate(rating)}
                  >
                    <Text style={{ color: c.accent }}>
                      {rating === 'again' ? '模糊' : rating === 'hard' ? '困难' : rating === 'good' ? '良好' : '简单'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: c.studyMuted, fontSize: 16 }}>‹ 退出</Text>
        </Pressable>
      </View>
      <View style={styles.content}>{renderContent()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  content: { flex: 1, justifyContent: 'center', padding: 20 },
  center: { alignItems: 'center' },
  doneTitle: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  button: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 40 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  cardArea: { alignItems: 'center' },
  progress: { fontSize: 13, marginBottom: 14 },
  card: {
    width: '100%',
    minHeight: 300,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  front: { fontSize: 30, fontWeight: '700', textAlign: 'center' },
  pron: { fontSize: 16, marginTop: 10 },
  tapHint: { fontSize: 12, marginTop: 28 },
  back: { fontSize: 22, textAlign: 'center', lineHeight: 32 },
  ratings: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 28,
    justifyContent: 'center',
  },
  ratingBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
});
