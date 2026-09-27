import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  clearCoachHistory,
  deleteCoachHistory,
  loadCoachHistory,
} from '../../lib/coach-storage';
import type { CoachHistoryRecord } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { confirmAsync } from '../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../lib/ui';

export default function CoachHistoryScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [records, setRecords] = useState<CoachHistoryRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      void loadCoachHistory().then(setRecords);
    }, [])
  );

  const remove = async (record: CoachHistoryRecord) => {
    const ok = await confirmAsync(t('coachDelete'), record.scenarioTitle);
    if (!ok) return;
    await deleteCoachHistory(record.id);
    setRecords((items) => items.filter((item) => item.id !== record.id));
  };

  const clear = async () => {
    const ok = await confirmAsync(t('coachDelete'), t('coachRecentPractice'));
    if (!ok) return;
    await clearCoachHistory();
    setRecords([]);
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={[roundButton, { backgroundColor: c.inputBg }]}>
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('coachRecentPractice')}
          </Text>
          <Pressable onPress={() => void clear()} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>{t('coachDelete')}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        {records.length === 0 ? (
          <Text style={{ color: c.inkMuted, textAlign: 'center', marginTop: 40 }}>
            {t('coachNoHistory')}
          </Text>
        ) : (
          records.map((record) => (
            <View key={record.id} style={[cardStyle(c.card, c.border), styles.card]}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() =>
                  router.push({
                    pathname: '/coach/summary',
                    params: { record: JSON.stringify(record) },
                  })
                }
              >
                <Text style={[styles.title, { color: c.ink, fontFamily: serif }]}>
                  {record.scenarioTitle}
                </Text>
                <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 5 }}>
                  {t('coachTurns', { count: record.summary.stats.turns })} · {record.durationSeconds}s
                </Text>
              </Pressable>
              <Pressable onPress={() => void remove(record)} hitSlop={10}>
                <Text style={{ color: c.inkMuted }}>{t('coachDelete')}</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  body: { paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '600' },
});
