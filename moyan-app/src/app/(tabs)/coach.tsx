import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CoachGlyph,
  CoachGroup,
  CoachRow,
  type CoachGlyphName,
  SectionLabel,
} from '../../components/coach/CoachUi';
import { UnavailableState } from '../../components/coach/UnavailableState';
import { getCoachQuota, listCoachScenarios } from '../../lib/coach-api-runtime';
import { canStartCoach, groupScenarios, quotaLabel } from '../../lib/coach-selection';
import {
  loadCoachHistory,
  loadCustomScenarios,
  saveCustomScenario,
} from '../../lib/coach-storage';
import type { CoachHistoryRecord, CoachQuotaStatus, CoachScenario } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

const CATEGORY_LABEL = {
  daily: 'coachCategoryDaily',
  engineering: 'coachCategoryEngineering',
  high_stakes: 'coachCategoryHighStakes',
} as const;

const SCENARIO_ORDER: Record<string, number> = {
  remote_small_talk: 0,
  ask_for_help: 1,
  one_on_one: 2,
  standup_update: 0,
  code_review: 1,
  design_discussion: 2,
  incident_sync: 0,
  scope_deadline: 1,
};

const SCENARIO_ICONS: Record<string, CoachGlyphName> = {
  ask_for_help: 'person',
  one_on_one: 'manager',
  remote_small_talk: 'chat',
  standup_update: 'standup',
  code_review: 'review',
  design_discussion: 'design',
  incident_sync: 'alert',
  scope_deadline: 'deadline',
  interview_screening: 'person',
  interview_behavioral: 'person',
  interview_technical: 'person',
};

export default function CoachScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [quota, setQuota] = useState<CoachQuotaStatus | null>(null);
  const [presets, setPresets] = useState<CoachScenario[]>([]);
  const [customScenarios, setCustomScenarios] = useState<CoachScenario[]>([]);
  const [history, setHistory] = useState<CoachHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [quotaResult, scenarioResult, customResult, historyResult] =
      await Promise.allSettled([
        getCoachQuota(),
        listCoachScenarios(lang),
        loadCustomScenarios(),
        loadCoachHistory(),
      ]);

    if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
    if (scenarioResult.status === 'fulfilled') setPresets(scenarioResult.value);
    if (customResult.status === 'fulfilled') setCustomScenarios(customResult.value);
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    if (quotaResult.status === 'rejected' && scenarioResult.status === 'rejected') {
      setLoadError(true);
    }
    setLoading(false);
  }, [lang]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const start = (scenario: CoachScenario) => {
    if (!quota) return;
    const check = canStartCoach({ quota, scenario });
    if (!check.ok) return;
    router.push({
      pathname: '/coach/session',
      params: { scenarioId: scenario.id, source: scenario.source },
    });
  };

  const copyToMine = async (scenario: CoachScenario) => {
    const copy: CoachScenario = {
      ...scenario,
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: 'custom',
      title: `${scenario.title} · Copy`,
    };
    await saveCustomScenario(copy);
    router.push({ pathname: '/coach/editor', params: { scenarioId: copy.id } });
  };

  const startReason = quota ? canStartCoach({ quota, scenario: presets[0] }) : null;
  const available = !!quota && !!startReason?.ok;
  const groups = groupScenarios(
    presets.filter((scenario) => !scenario.id.startsWith('interview_'))
  );
  const unavailableKind = loadError
    ? 'network'
    : quota && startReason && !startReason.ok
      ? startReason.reason
      : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.tabHead}>
        <Text style={[styles.tabTitle, { color: c.ink, fontFamily: serif }]}>{t('coachPageTitle')}</Text>
        <View style={[styles.quotaPill, { backgroundColor: c.tagBg }]}>
          {!quota ? (
            <Text style={[styles.quotaText, { color: c.inkMuted }]}>—</Text>
          ) : quotaLabel(quota) === 'unlimited' ? (
            <Text style={[styles.quotaText, { color: c.inkMuted }]}>{t('coachUnlimited')}</Text>
          ) : (
            <>
              <Text style={[styles.quotaText, { color: c.inkMuted }]}>{t('coachToday')} </Text>
              <Text style={[styles.quotaStrong, { color: c.ink }]}>{quota.remaining ?? 0}</Text>
              <Text style={[styles.quotaText, { color: c.inkMuted }]}> / {quota.limit}</Text>
            </>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : unavailableKind ? (
        <UnavailableState
          kind={unavailableKind}
          resetsAt={quota?.resets_at}
          quota={quota ?? undefined}
          onRetry={() => void load()}
          onHistory={() => router.push('/coach/history')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/coach/interview')}
            style={[styles.entry, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={[styles.entryIcon, { backgroundColor: c.accentLight }]}>
              <CoachGlyph name="person" color={c.accent} size={20} />
            </View>
            <View style={styles.entryBody}>
              <Text style={[styles.entryTitle, { color: c.ink }]}>{t('coachInterviewTitle')}</Text>
              <Text numberOfLines={1} style={[styles.entryDesc, { color: c.inkMuted }]}>
                {t('coachInterviewIntro')}
              </Text>
            </View>
            <CoachGlyph name="arrowRight" color={c.accent} size={18} />
          </Pressable>

          {groups.map((group) => (
            <View key={group.category}>
              <SectionLabel>{t(CATEGORY_LABEL[group.category])}</SectionLabel>
              <CoachGroup>
                {group.items
                  .slice()
                  .sort(
                    (a, b) =>
                      (SCENARIO_ORDER[a.id] ?? Number.MAX_SAFE_INTEGER) -
                      (SCENARIO_ORDER[b.id] ?? Number.MAX_SAFE_INTEGER)
                  )
                  .map((scenario) => (
                  <CoachRow
                    key={scenario.id}
                    icon={SCENARIO_ICONS[scenario.id] ?? 'chat'}
                    title={scenario.title}
                    subtitle={scenario.description}
                    meta={`${scenario.persona.locale} · ${t('coachTurns', {
                      count: scenario.max_turns,
                    })}`}
                    badge={scenario.id === 'standup_update' ? t('coachRecommended') : undefined}
                    onPress={() => start(scenario)}
                    onLongPress={() => void copyToMine(scenario)}
                  />
                  ))}
              </CoachGroup>
            </View>
          ))}

          <SectionLabel>{t('coachMyScenarios')}</SectionLabel>
          <CoachGroup>
            {customScenarios.map((scenario) => (
              <CoachRow
                key={scenario.id}
                icon={SCENARIO_ICONS[scenario.id] ?? 'chat'}
                title={scenario.title}
                subtitle={scenario.description}
                meta={`${scenario.persona.locale} · ${t('coachTurns', {
                  count: scenario.max_turns,
                })}`}
                onPress={() => (available ? start(scenario) : undefined)}
                onLongPress={() => router.push({ pathname: '/coach/editor', params: { scenarioId: scenario.id } })}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/coach/editor')}
              style={[styles.addRow, { borderColor: c.accent, backgroundColor: c.card }]}
            >
              <View style={[styles.addIcon, { backgroundColor: c.accentLight }]}>
                <CoachGlyph name="plus" color={c.accent} size={18} />
              </View>
              <Text style={[styles.addText, { color: c.accent }]}>{t('coachNewScenario')}</Text>
            </Pressable>
          </CoachGroup>
          {customScenarios.length === 0 ? (
            <Text style={[styles.help, { color: c.inkMuted }]}>{t('coachNoCustomScenarios')}</Text>
          ) : null}

          <SectionLabel>{t('coachRecentPractice')}</SectionLabel>
          <CoachGroup>
            {history.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={[styles.emptyHistoryTitle, { color: c.inkLight }]}>
                  {t('coachNoHistory')}
                </Text>
                <Text style={[styles.help, { color: c.inkMuted }]}>{t('coachStartHint')}</Text>
              </View>
            ) : (
              history.slice(0, 4).map((record) => (
                <CoachRow
                  key={record.id}
                  plain
                  icon="history"
                  title={record.scenarioTitle}
                  meta={`${t('coachTurns', {
                    count: record.summary.stats.turns,
                  })} · ${record.summary.stats.corrections} ${t('coachCorrections')}`}
                  onPress={() =>
                    router.push({
                      pathname: '/coach/summary',
                      params: { record: JSON.stringify(record) },
                    })
                  }
                />
              ))
            )}
          </CoachGroup>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabHead: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabTitle: { fontSize: 24, fontWeight: '700', flex: 1 },
  quotaPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quotaText: { fontSize: 10.5 },
  quotaStrong: { fontSize: 13, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingBottom: 150 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 2,
  },
  entryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryBody: { flex: 1, minWidth: 0 },
  entryTitle: { fontSize: 15, fontWeight: '600' },
  entryDesc: { fontSize: 11.5, marginTop: 3 },
  addRow: {
    minHeight: 54,
    marginHorizontal: 10,
    marginVertical: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  addIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { fontSize: 13, fontWeight: '600' },
  help: { fontSize: 11.5, lineHeight: 18, marginTop: 9 },
  emptyHistory: { paddingVertical: 22, paddingHorizontal: 16, alignItems: 'center' },
  emptyHistoryTitle: { fontSize: 13 },
});
