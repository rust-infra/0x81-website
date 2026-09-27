import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyQueue } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

const DAILY_WORDS = [
  'concurrency',
  'idempotent',
  'eventual consistency',
  'backpressure',
  'memory safety',
];

function formatDate(lang: 'zh-CN' | 'en') {
  const d = new Date();
  if (lang === 'zh-CN') {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`;
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' });
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [stats, setStats] = useState<{
    due: number;
    fresh: number;
    total: number;
    today: number;
  } | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const wordOpacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const id = setInterval(() => {
      setWordIndex((i) => (i + 1) % DAILY_WORDS.length);
      Animated.sequence([
        Animated.timing(wordOpacity, { toValue: 0.06, duration: 250, useNativeDriver: true }),
        Animated.timing(wordOpacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]).start();
    }, 3000);
    return () => clearInterval(id);
  }, [wordOpacity]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const queue = await getStudyQueue();
          if (!cancelled) {
            setStats({
              due: queue.due_count,
              fresh: queue.new_count,
              total: queue.total_cards,
              today: queue.today_reviewed,
            });
          }
        } catch {
          // ignore
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const progress = stats && stats.total > 0
    ? Math.min(100, Math.round(((stats.total - stats.fresh) / stats.total) * 100))
    : 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: c.ink, fontFamily: serif }]}>
          {t('greeting')}
          {lang === 'zh-CN' ? '，' : ', '}
          {user?.name?.split(' ')[0] || 'User'}
          {lang === 'zh-CN' ? '。' : '.'}
        </Text>
        <Text style={[styles.date, { color: c.inkLight }]}>
          {formatDate(lang)} · {t('dailyDue', { count: stats?.due ?? 0 })}
        </Text>
      </View>

      {!stats ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.progressCard, { backgroundColor: c.buttonBg }]}>
            <View style={styles.progressRow}>
              <View>
                <Text style={[styles.progressLabel, { color: `${c.buttonText}B3` }]}>{t('totalWords')}</Text>
                <Text style={[styles.progressValue, { color: c.buttonText }]}>{progress}%</Text>
              </View>
              <View style={styles.progressRight}>
                <Text style={[styles.progressLabel, { color: `${c.buttonText}B3` }]}>{t('todayReview')}</Text>
                <Text style={[styles.progressToday, { color: c.buttonText }]}>{stats.today} {t('wordUnit')}</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.cta, { backgroundColor: c.buttonBg }]}
            onPress={() => router.push('/decks')}
          >
            <Animated.Text
              numberOfLines={1}
              style={[styles.ctaWord, { color: c.buttonText, opacity: wordOpacity }]}
            >
              {DAILY_WORDS[wordIndex]}
            </Animated.Text>
            <Text style={[styles.ctaTitle, { color: c.buttonText }]}>{t('dailyRequired')}</Text>
            <Text style={[styles.ctaDesc, { color: `${c.buttonText}B3` }]}>
              {stats.due > 0
                ? t('dailyDue', { count: stats.due })
                : t('dailyDone')}
            </Text>
            <Text style={[styles.ctaGo, { color: `${c.buttonText}D9` }]}>{t('chooseDeck')}</Text>
          </Pressable>

          <View style={styles.grid}>
            <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.due}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('due')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.fresh}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('new')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.total}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('totalWords')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.today}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('todayReview')}</Text>
            </View>
          </View>
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18 },
  greeting: { fontSize: 25, fontWeight: '700', marginBottom: 7 },
  date: { fontSize: 12.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 140 },
  progressCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel: { fontSize: 12, marginBottom: 4 },
  progressValue: { fontSize: 26, fontWeight: '700', fontFamily: serif },
  progressRight: { alignItems: 'flex-end' },
  progressToday: { fontSize: 18, fontWeight: '600' },
  cta: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 14,
    overflow: 'hidden',
  },
  ctaWord: {
    position: 'absolute',
    top: 14,
    right: 16,
    fontSize: 22,
    fontFamily: serif,
    transform: [{ rotate: '-8deg' }],
  },
  ctaTitle: { fontSize: 18, fontWeight: '700', fontFamily: serif },
  ctaDesc: { fontSize: 13, marginTop: 6 },
  ctaGo: { fontSize: 13, marginTop: 18, fontWeight: '500' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 15,
  },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11.5, marginTop: 4 },
});
