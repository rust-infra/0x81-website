import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyQueue } from '../../lib/api';
import { useTheme } from '../../lib/theme-context';
import { screen, serif } from '../../lib/ui';

export default function StatsScreen() {
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

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          统计
        </Text>
      </View>

      {!stats ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <ScrollView contentContainerStyle={[screen.body, styles.body]}>
          <View style={[styles.streakCard, { backgroundColor: c.buttonBg }]}>
            <View style={styles.streakIcon}>
              <Text style={styles.streakEmoji}>🔥</Text>
            </View>
            <View>
              <Text style={styles.streakValue}>{stats.today}</Text>
              <Text style={styles.streakLabel}>今日复习</Text>
            </View>
          </View>

          <View style={styles.grid}>
            {[
              { label: '总词汇量', value: stats.total },
              { label: '新词', value: stats.fresh },
              { label: '今日复习', value: stats.today },
              { label: '待复习', value: stats.due },
            ].map((item) => (
              <View key={item.label} style={[styles.statCard, { backgroundColor: c.card }]}>
                <Text style={[styles.statValue, { color: c.ink }]}>{item.value}</Text>
                <Text style={[styles.statLabel, { color: c.inkLight }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.quote, { color: c.inkMuted }]}>
            不积跬步，无以至千里
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: 120 },
  streakCard: {
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  streakIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakEmoji: { fontSize: 26 },
  streakValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', fontFamily: serif },
  streakLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
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
  quote: { textAlign: 'center', fontSize: 13, marginTop: 28, fontFamily: serif },
});
