import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoachGroup, CoachHeader, CoachRow, SectionLabel } from '../../components/coach/CoachUi';
import {
  deleteCoachHistory,
  loadCoachHistory,
} from '../../lib/coach-storage';
import type { CoachHistoryRecord } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { confirmAsync } from '../../lib/toast';

type Filter = 'all' | 'coach' | 'interview';

export default function CoachHistoryScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [records, setRecords] = useState<CoachHistoryRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

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

  const visible = useMemo(() => {
    return records.filter((record) => {
      const interview =
        !!record.summary.interview_feedback || record.scenarioId.startsWith('interview_');
      if (filter === 'coach') return !interview;
      if (filter === 'interview') return interview;
      return true;
    });
  }, [filter, records]);

  const thisWeek = visible.filter((record) => Date.now() - new Date(record.createdAt).getTime() < 7 * 86400_000);
  const earlier = visible.filter((record) => !thisWeek.includes(record));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('coachHistoryPageTitle')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.filters}>
          {([
            ['all', t('coachFilterAll')],
            ['coach', t('coachFilterCoach')],
            ['interview', t('coachFilterInterview')],
          ] as Array<[Filter, string]>).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              style={[
                styles.filter,
                {
                  backgroundColor: filter === value ? c.accentLight : c.tagBg,
                  borderColor: filter === value ? c.accent : 'transparent',
                },
              ]}
            >
              <Text style={{ color: filter === value ? c.accent : c.inkMuted, fontSize: 12 }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <View style={[styles.empty, { borderColor: c.border }]}>
            <Text style={{ color: c.inkLight }}>{t('coachNoHistory')}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 6 }}>
              {t('coachStartHint')}
            </Text>
          </View>
        ) : (
          <>
            {thisWeek.length ? (
              <>
                <SectionLabel>{t('coachThisWeek')}</SectionLabel>
                <CoachGroup>
                  {thisWeek.map((record) => (
                    <HistoryRow key={record.id} record={record} lang={lang} onOpen={router.push} onDelete={remove} />
                  ))}
                </CoachGroup>
              </>
            ) : null}
            {earlier.length ? (
              <>
                <SectionLabel>{t('coachEarlier')}</SectionLabel>
                <CoachGroup>
                  {earlier.map((record) => (
                    <HistoryRow key={record.id} record={record} lang={lang} onOpen={router.push} onDelete={remove} />
                  ))}
                </CoachGroup>
              </>
            ) : null}
            <Text style={[styles.footer, { color: c.inkMuted }]}>
              {t('coachHistoryLocalOnly', { count: visible.length })}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function HistoryRow({
  record,
  lang,
  onOpen,
  onDelete,
}: {
  record: CoachHistoryRecord;
  lang: 'zh-CN' | 'en';
  onOpen: (options: { pathname: string; params: { record: string } }) => void;
  onDelete: (record: CoachHistoryRecord) => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const interview =
    !!record.summary.interview_feedback || record.scenarioId.startsWith('interview_');
  const date = new Date(record.createdAt);
  const day =
    date.toDateString() === new Date().toDateString()
      ? t('coachToday')
      : date.toLocaleDateString(lang, { weekday: 'short' });
  const duration = `${Math.floor(record.durationSeconds / 60)}:${String(
    record.durationSeconds % 60
  ).padStart(2, '0')}`;
  return (
    <CoachRow
      plain
      icon={
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: c.accent,
          }}
        />
      }
      title={record.scenarioTitle}
      subtitle={`${record.summary.stats.corrections} ${t('coachCorrections')} · ${duration}`}
      meta={`${day} · ${t('coachTurns', { count: record.summary.stats.turns })}`}
      badge={interview ? t('coachFilterInterview') : undefined}
      onPress={() => onOpen({ pathname: '/coach/summary', params: { record: JSON.stringify(record) } })}
      onLongPress={() => onDelete(record)}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  filters: { flexDirection: 'row', gap: 7, marginTop: 4 },
  filter: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 34,
    marginTop: 24,
  },
  footer: { textAlign: 'center', fontSize: 11, marginTop: 20 },
});
