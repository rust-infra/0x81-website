import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createReviewLog,
  listStudyCards,
  upsertCardProgress,
} from '../../lib/api';
import { calculateSRS, progressToSrs } from '../../lib/srs';
import { speak, stopSpeaking } from '../../lib/speech';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';
import type { StudyCard } from '../../lib/types';

type Rating = 'again' | 'hard' | 'good' | 'easy';
const SPEAK_KEY = 'moyan_study_speak';

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
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const cardStartRef = useRef(Date.now());
  const flipAnim = useRef(new Animated.Value(0)).current;

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
      setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 });
      flipAnim.setValue(0);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [deckId, flipAnim]);

  useEffect(() => {
    void load();
    AsyncStorage.getItem(SPEAK_KEY)
      .then((v) => setSpeakEnabled(v !== '0'))
      .catch(() => {});
  }, [load]);

  const current = queue[index];

  useEffect(() => {
    if (current && !showAnswer) {
      cardStartRef.current = Date.now();
      flipAnim.setValue(0);
      if (speakEnabled) {
        speak(current.card.front, { language: 'en-US' });
      }
    }
  }, [current, showAnswer, speakEnabled, flipAnim]);

  const flipCard = () => {
    if (showAnswer || transitioning) return;
    setTransitioning(true);
    Animated.timing(flipAnim, {
      toValue: 90,
      duration: 140,
      useNativeDriver: true,
    }).start(() => {
      setShowAnswer(true);
      if (speakEnabled && current?.card.examples?.[0]) {
        speak(current.card.examples[0].sentence_en, { language: 'en-US' });
      }
      Animated.timing(flipAnim, {
        toValue: 180,
        duration: 140,
        useNativeDriver: true,
      }).start(() => setTransitioning(false));
    });
  };

  const toggleSpeak = () => {
    const next = !speakEnabled;
    setSpeakEnabled(next);
    AsyncStorage.setItem(SPEAK_KEY, next ? '1' : '0').catch(() => {});
    if (!next) stopSpeaking();
  };

  const handleRate = async (rating: Rating) => {
    if (!current || transitioning) return;
    setTransitioning(true);
    const timeTakenMs = Date.now() - cardStartRef.current;
    const updatedSRS = calculateSRS(progressToSrs(current.progress), rating);
    try {
      if (speakEnabled) stopSpeaking();
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
    flipAnim.setValue(0);
    setShowAnswer(false);
    setSessionStats((s) => ({ ...s, [rating]: s[rating] + 1 }));
    setIndex((i) => i + 1);
    setTransitioning(false);
  };

  const renderContent = () => {
    if (loading) {
      return <Text style={{ color: c.inkMuted }}>加载中...</Text>;
    }
    if (queue.length === 0 || index >= queue.length) {
      const total =
        sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy;
      const accuracy =
        total > 0 ? Math.round(((sessionStats.good + sessionStats.easy) / total) * 100) : 0;
      return (
        <View style={styles.center}>
          <Text style={[styles.doneTitle, { color: c.studyText, fontFamily: serif }]}>
            本次复习完成
          </Text>
          <Text style={[styles.doneMeta, { color: c.studyMuted }]}>
            共浸润 {total} 个词汇
          </Text>

          <View style={[styles.doneStats, { backgroundColor: `${c.studyText}0D` }]}>
            <View style={styles.doneStatRow}>
              <Text style={{ color: c.studyMuted }}>准确率</Text>
              <Text style={{ color: c.accent, fontWeight: '600' }}>{accuracy}%</Text>
            </View>
            <View style={[styles.doneDivider, { backgroundColor: `${c.studyText}10` }]} />
            <View style={styles.doneStatRow}>
              <Text style={{ color: c.studyMuted }}>模糊</Text>
              <Text style={{ color: c.studyText }}>{sessionStats.again + sessionStats.hard}</Text>
            </View>
            <View style={styles.doneStatRow}>
              <Text style={{ color: c.studyMuted }}>铭记</Text>
              <Text style={{ color: c.studyText }}>{sessionStats.good + sessionStats.easy}</Text>
            </View>
          </View>

          <View style={styles.doneButtons}>
            <Pressable
              style={[styles.button, { backgroundColor: `${c.studyText}15` }]}
              onPress={() => void load()}
            >
              <Text style={{ color: c.studyText }}>再来一轮</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: c.studyText }]}
              onPress={() => router.back()}
            >
              <Text style={{ color: c.studyBg }}>返回</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    if (!current) return null;

    const rotateY = flipAnim.interpolate({
      inputRange: [0, 180],
      outputRange: ['0deg', '180deg'],
    });

    return (
      <View style={styles.cardArea}>
        <View style={[styles.progressTrack, { backgroundColor: `${c.studyText}18` }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.progressBar, width: `${(index / queue.length) * 100}%` },
            ]}
          />
        </View>
        <Text style={[styles.progress, { color: c.inkMuted }]}>
          {index + 1} / {queue.length}
        </Text>
        <Pressable style={[styles.card, { backgroundColor: c.studyCard }]} onPress={flipCard}>
          <Animated.View
            style={[
              styles.cardInner,
              { transform: [{ perspective: 800 }, { rotateY }] },
            ]}
          >
            {!showAnswer ? (
              <View>
                <Text style={[styles.front, { color: c.studyText }]}>{current.card.front}</Text>
                {current.card.pronunciation ? (
                  <Text style={[styles.pron, { color: c.studyMuted }]}>
                    {current.card.pronunciation}
                  </Text>
                ) : null}
                <Text style={[styles.tapHint, { color: c.studyMuted }]}>点击查看释义</Text>
              </View>
            ) : (
              <View style={{ transform: [{ rotateY: '-180deg' }] }}>
                <Text style={[styles.back, { color: c.studyText }]}>{current.card.back}</Text>
                {current.card.examples?.[0] ? (
                  <View style={styles.exampleBox}>
                    <Text style={[styles.exampleEn, { color: c.studyMuted }]}>
                      {current.card.examples[0].sentence_en}
                    </Text>
                    <Text style={[styles.exampleZh, { color: c.studyMuted }]}>
                      {current.card.examples[0].translation_zh}
                    </Text>
                  </View>
                ) : null}
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
              </View>
            )}
          </Animated.View>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={{ color: c.studyMuted, fontSize: 16 }}>‹ 退出</Text>
          </Pressable>
          <Pressable onPress={toggleSpeak} hitSlop={12}>
            <Text style={{ color: c.studyMuted, fontSize: 16 }}>
              {speakEnabled ? '🔊' : '🔇'}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.content}>{renderContent()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: { flex: 1, justifyContent: 'center', padding: 20 },
  center: { alignItems: 'center' },
  doneTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  doneMeta: { fontSize: 13, marginBottom: 24 },
  doneStats: {
    alignSelf: 'stretch',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  doneStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 14,
    paddingVertical: 3,
  },
  doneDivider: { height: 1, marginVertical: 8 },
  doneButtons: { flexDirection: 'row', gap: 12 },
  button: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 40 },
  cardArea: { alignItems: 'center', alignSelf: 'stretch' },
  progressTrack: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: { height: '100%', borderRadius: 2 },
  progress: { fontSize: 13, marginBottom: 14 },
  card: {
    width: '100%',
    minHeight: 300,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInner: { width: '100%', alignItems: 'center' },
  front: { fontSize: 30, fontWeight: '700', textAlign: 'center' },
  pron: { fontSize: 16, marginTop: 10 },
  tapHint: { fontSize: 12, marginTop: 28 },
  back: { fontSize: 22, textAlign: 'center', lineHeight: 32 },
  exampleBox: { marginTop: 18, alignItems: 'center' },
  exampleEn: { fontSize: 14, fontStyle: 'italic', textAlign: 'center' },
  exampleZh: { fontSize: 13, marginTop: 6, textAlign: 'center' },
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
