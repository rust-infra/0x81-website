import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UnavailableState } from '../../components/coach/UnavailableState';
import { getCoachQuota, listCoachScenarios } from '../../lib/coach-api';
import { canStartCoach, groupScenarios, quotaLabel } from '../../lib/coach-selection';
import {
  deleteCustomScenario,
  loadCoachHistory,
  loadCustomScenarios,
  saveCustomScenario,
} from '../../lib/coach-storage';
import type { CoachHistoryRecord, CoachQuotaStatus, CoachScenario } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { confirmAsync, useToast } from '../../lib/toast';
import { cardStyle, screen, serif } from '../../lib/ui';

const CATEGORY_LABEL = {
  daily: 'coachCategoryDaily',
  engineering: 'coachCategoryEngineering',
  high_stakes: 'coachCategoryHighStakes',
} as const;

export default function CoachScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
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

  const removeCustom = async (scenario: CoachScenario) => {
    const ok = await confirmAsync(t('coachDelete'), scenario.title);
    if (!ok) return;
    await deleteCustomScenario(scenario.id);
    setCustomScenarios((items) => items.filter((item) => item.id !== scenario.id));
    toast(t('saved'));
  };

  const startReason = quota ? canStartCoach({ quota, scenario: presets[0] }) : null;

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('tabCoach')}
          </Text>
          <View style={[styles.quotaPill, { backgroundColor: c.accentLight }]}>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>
              {!quota
                ? '—'
                : quotaLabel(quota) === 'unlimited'
                  ? t('coachUnlimited')
                  : t('coachQuota', {
                      remaining: quota.remaining ?? 0,
                      limit: quota.limit,
                    })}
            </Text>
          </View>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <ScrollView contentContainerStyle={[screen.body, styles.body]}>
          {loadError ? <UnavailableState kind="network" /> : null}
          {quota && startReason && !startReason.ok ? (
            <UnavailableState kind={startReason.reason} resetsAt={quota.resets_at} />
          ) : null}

          <Text style={[styles.sectionTitle, { color: c.inkLight }]}>
            {t('coachPresetScenarios')}
          </Text>
          {groupScenarios(presets).map((group) => (
            <View key={group.category} style={styles.group}>
              <Text style={[styles.groupTitle, { color: c.inkMuted }]}>
                {t(CATEGORY_LABEL[group.category])}
              </Text>
              {group.items.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  disabled={!!startReason && !startReason.ok}
                  onStart={() => start(scenario)}
                  onCopy={() => void copyToMine(scenario)}
                />
              ))}
            </View>
          ))}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.inkLight }]}>
              {t('coachMyScenarios')}
            </Text>
            <Pressable onPress={() => router.push('/coach/editor')}>
              <Text style={{ color: c.accent, fontWeight: '600' }}>{t('coachNew')}</Text>
            </Pressable>
          </View>
          {customScenarios.length === 0 ? (
            <Text style={[styles.empty, { color: c.inkMuted }]}>
              {t('coachNoCustomScenarios')}
            </Text>
          ) : (
            customScenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                disabled={!!startReason && !startReason.ok}
                onStart={() => start(scenario)}
                onCopy={() => router.push({ pathname: '/coach/editor', params: { scenarioId: scenario.id } })}
                onDelete={() => void removeCustom(scenario)}
              />
            ))
          )}

          <Text style={[styles.sectionTitle, { color: c.inkLight }]}>
            {t('coachRecentPractice')}
          </Text>
          {history.length === 0 ? (
            <Text style={[styles.empty, { color: c.inkMuted }]}>{t('coachNoHistory')}</Text>
          ) : (
            history.slice(0, 4).map((record) => (
              <View key={record.id} style={[cardStyle(c.card), styles.historyRow]}>
                <Text style={[styles.cardTitle, { color: c.ink }]} numberOfLines={1}>
                  {record.scenarioTitle}
                </Text>
                <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 4 }}>
                  {t('coachTurns', { count: record.summary.stats.turns })}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ScenarioCard({
  scenario,
  disabled,
  onStart,
  onCopy,
  onDelete,
}: {
  scenario: CoachScenario;
  disabled: boolean;
  onStart: () => void;
  onCopy: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const difficulty = {
    easy: 'coachDifficultyEasy',
    core: 'coachDifficultyCore',
    challenge: 'coachDifficultyChallenge',
  }[scenario.difficulty];

  return (
    <View style={[cardStyle(c.card, c.border), styles.card]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: c.ink }]}>{scenario.title}</Text>
        <Text style={[styles.meta, { color: c.inkMuted }]}>
          {scenario.persona.locale} · {t('coachTurns', { count: scenario.max_turns })}
        </Text>
      </View>
      <Text style={[styles.description, { color: c.inkLight }]}>{scenario.description}</Text>
      <Text style={[styles.meta, { color: c.inkMuted }]}>
        {scenario.persona.name} · {scenario.persona.role} · {t(difficulty)}
      </Text>
      <View style={styles.actions}>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Text style={{ color: c.accent, fontSize: 13 }}>{t('coachCopyScenario')}</Text>
        </Pressable>
        {onDelete ? (
          <Pressable onPress={onDelete} hitSlop={8}>
            <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t('coachDelete')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={disabled}
          onPress={onStart}
          style={[
            styles.startButton,
            { backgroundColor: disabled ? c.inkMuted : c.buttonBg },
          ]}
        >
          <Text style={{ color: c.buttonText, fontSize: 13, fontWeight: '600' }}>
            {t('coachStart')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quotaPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: 110 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 10, marginTop: 10 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  group: { marginBottom: 8 },
  groupTitle: { fontSize: 12, marginTop: 10, marginBottom: 8 },
  card: { marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600', fontFamily: serif },
  meta: { fontSize: 11, marginTop: 5 },
  description: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 14,
  },
  startButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  empty: { fontSize: 13, paddingVertical: 10 },
  historyRow: { marginBottom: 8 },
});
