import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyQueue } from '../../lib/api';
import { useTheme } from '../../lib/theme-context';

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
          // 登录失效等错误静默处理
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const items = stats
    ? [
        { label: '今日复习', value: stats.today },
        { label: '待复习', value: stats.due },
        { label: '新词', value: stats.fresh },
        { label: '总词汇', value: stats.total },
      ]
    : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.ink }]}>统计</Text>
      </View>
      {!stats ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <View key={item.label} style={[styles.card, { backgroundColor: c.card }]}>
              <Text style={[styles.value, { color: c.ink }]}>{item.value}</Text>
              <Text style={[styles.label, { color: c.inkMuted }]}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },
  card: {
    width: '47%',
    borderRadius: 14,
    padding: 18,
  },
  value: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 12, marginTop: 4 },
});
