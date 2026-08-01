import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyQueue } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { theme } = useTheme();
  const c = theme.colors;
  const [stats, setStats] = useState<{
    due: number;
    fresh: number;
    total: number;
    today: number;
  } | null>(null);

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
          你好，{user?.name?.split(' ')[0] || 'User'}。
        </Text>
        <Text style={[styles.date, { color: c.inkLight }]}>
          {formatDate()} · 还有 {stats?.due ?? 0} 个词汇待复习
        </Text>
      </View>

      {!stats ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <View style={styles.body}>
          <View style={[styles.progressCard, { backgroundColor: c.buttonBg }]}>
            <View style={styles.progressRow}>
              <View>
                <Text style={styles.progressLabel}>总词汇</Text>
                <Text style={styles.progressValue}>{progress}%</Text>
              </View>
              <View style={styles.progressRight}>
                <Text style={styles.progressLabel}>今日复习</Text>
                <Text style={styles.progressToday}>{stats.today} 词</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.cta, { backgroundColor: c.buttonBg }]}
            onPress={() => router.push('/decks')}
          >
            <Text style={styles.ctaTitle}>今日必修</Text>
            <Text style={styles.ctaDesc}>
              {stats.due > 0
                ? `还有 ${stats.due} 个词汇待浸润`
                : '今日已浸润完毕'}
            </Text>
            <Text style={styles.ctaGo}>选择词库开始 →</Text>
          </Pressable>

          <View style={styles.grid}>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.due}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>待复习</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.fresh}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>新词</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.total}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>总词汇</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.today}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>今日复习</Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 20 },
  greeting: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  date: { fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20 },
  progressCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 4 },
  progressValue: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', fontFamily: serif },
  progressRight: { alignItems: 'flex-end' },
  progressToday: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  cta: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
  },
  ctaTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontFamily: serif },
  ctaDesc: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 6 },
  ctaGo: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 18, fontWeight: '500' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '47.5%',
    borderRadius: 16,
    padding: 16,
  },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 4 },
});
