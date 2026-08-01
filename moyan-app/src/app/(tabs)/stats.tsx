import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDailyTrend, getStudyQueue } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { screen, serif } from '../../lib/ui';
import type { DailyTrendPoint } from '../../lib/types';

export default function StatsScreen() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const c = theme.colors;
  const [stats, setStats] = useState<{
    due: number;
    fresh: number;
    total: number;
    today: number;
  } | null>(null);
  const [trend, setTrend] = useState<DailyTrendPoint[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const queue = await getStudyQueue();
          const trendData = await getDailyTrend(7);
          if (!cancelled) {
            setStats({
              due: queue.due_count,
              fresh: queue.new_count,
              total: queue.total_cards,
              today: queue.today_reviewed,
            });
            setTrend(trendData);
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

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const byDate = new Map(trend.map((t) => [t.date, t]));
  const filled = days.map((date) => byDate.get(date) || { date, reviews: 0, accuracy: 0 });
  const maxReviews = Math.max(...filled.map((d) => d.reviews), 1);
  const overallAccuracy =
    filled.length > 0
      ? Math.round(
          (filled.reduce((sum, d) => sum + d.accuracy * d.reviews, 0) /
            Math.max(filled.reduce((sum, d) => sum + d.reviews, 0), 1)) *
            100
        )
      : 0;

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          {t('tabStats')}
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
              <Text style={styles.streakLabel}>{t('todayReview')}</Text>
            </View>
          </View>

          <View style={styles.grid}>
            {[
              { label: t('totalWords'), value: stats.total },
              { label: t('new'), value: stats.fresh },
              { label: t('todayReview'), value: stats.today },
              { label: t('due'), value: stats.due },
            ].map((item) => (
              <View key={item.label} style={[styles.statCard, { backgroundColor: c.card }]}>
                <Text style={[styles.statValue, { color: c.ink }]}>{item.value}</Text>
                <Text style={[styles.statLabel, { color: c.inkLight }]}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.trendCard, { backgroundColor: c.card }]}>
            <View style={styles.trendHeader}>
              <Text style={[styles.trendTitle, { color: c.ink }]}>{t('weekTrend')}</Text>
              <Text style={[styles.trendAcc, { color: c.accent }]}>{t('accuracy')} {overallAccuracy}%</Text>
            </View>
            <View style={styles.bars}>
              {filled.map((day) => (
                <View key={day.date} style={styles.barCol}>
                  {day.reviews > 0 && (
                    <Text style={[styles.barLabel, { color: c.inkMuted }]}>{day.reviews}</Text>
                  )}
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: c.buttonBg,
                        height: `${Math.max((day.reviews / maxReviews) * 80, 4)}%`,
                      },
                    ]}
                  />
                  <Text style={[styles.barDate, { color: c.inkMuted }]}>{day.date.slice(5)}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={[styles.quote, { color: c.inkMuted }]}>
            {t('quote')}
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
  trendCard: {
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  trendTitle: { fontSize: 15, fontWeight: '600' },
  trendAcc: { fontSize: 12, fontWeight: '600' },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 110,
    gap: 6,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barLabel: { fontSize: 10, marginBottom: 4 },
  bar: { width: '100%', maxWidth: 26, borderRadius: 999 },
  barDate: { fontSize: 10, marginTop: 6 },
});
