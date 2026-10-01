import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CoachGlyph,
  CoachHeader,
  PrimaryButton,
  SecondaryButton,
} from '../../components/coach/CoachUi';
import { listCoachScenarios, postCoachSummary } from '../../lib/coach-api-runtime';
import { summaryRecordFromSession } from '../../lib/coach-history';
import { loadCustomScenarios, saveCoachHistory } from '../../lib/coach-storage';
import type {
  CoachHistoryRecord,
  CoachScenario,
  CoachSummaryResponse,
  CoachTurn,
  InterviewContext,
  InterviewKind,
} from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { getSpeechSettings, speak } from '../../lib/speech';
import { useTheme } from '../../lib/theme-context';
import { cardStyle } from '../../lib/ui';

export default function CoachSummaryScreen() {
  const params = useLocalSearchParams<{
    record?: string;
    scenarioId?: string;
    scenarioTitle?: string;
    history?: string;
    startedAt?: string;
    interviewKind?: string;
    profile?: string;
  }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [summary, setSummary] = useState<CoachSummaryResponse | null>(null);
  const [scenario, setScenario] = useState<CoachScenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);

  useEffect(() => {
    void (async () => {
      if (params.record) {
        try {
          const record = JSON.parse(params.record) as CoachHistoryRecord;
          const [presets, custom] = await Promise.all([
            listCoachScenarios(lang).catch(() => []),
            loadCustomScenarios(),
          ]);
          const localized = [...presets, ...custom].find(
            (item) => item.id === record.scenarioId
          );
          setSummary(record.summary);
          setDurationSeconds(record.durationSeconds);
          setScenario(
            localized ?? {
              id: record.scenarioId,
              source: 'custom',
              category: 'daily',
              title: record.scenarioTitle,
              description: '',
              persona: { name: 'Coach', role: 'Coach', locale: 'en-US', tone: 'friendly' },
              setting: 'meeting',
              opening_line: '',
              focus_points: [],
              difficulty: 'core',
              max_turns: 10,
            }
          );
          setSaved(true);
          setLoading(false);
          return;
        } catch {
          // fall through to API summary
        }
      }

      setDurationSeconds(
        Math.max(1, Math.round((Date.now() - (Number(params.startedAt) || Date.now())) / 1000))
      );
      const [presets, custom] = await Promise.all([
        listCoachScenarios(lang).catch(() => []),
        loadCustomScenarios(),
      ]);
      const current = [...presets, ...custom].find((item) => item.id === params.scenarioId) ?? null;
      setScenario(current);
      const history = parseHistory(params.history);
      if (!current || history.length === 0) {
        setFailed(true);
        setLoading(false);
        return;
      }
      let interview: InterviewContext | undefined;
      if (params.interviewKind && params.profile) {
        interview = {
          kind: (params.interviewKind === 'job' || params.interviewKind === 'resume_job'
            ? params.interviewKind
            : 'resume') as InterviewKind | 'resume_job',
          profile: params.profile,
        };
      }
      try {
        const result = await postCoachSummary({
          scenario: current,
          scenario_id: current.source === 'preset' ? current.id : undefined,
          history,
          locale: lang,
          interview,
        });
        setSummary(result);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [lang, params.history, params.interviewKind, params.profile, params.record, params.scenarioId, params.startedAt]);

  const play = async (text: string) => {
    const settings = await getSpeechSettings();
    await speak(text, {
      language: scenario?.persona.locale ?? 'en-US',
      voiceId:
        scenario?.persona.locale === 'zh-CN'
          ? settings.speech_zh_voice
          : settings.speech_voice,
    });
  };

  const save = async () => {
    if (!summary || saved) return;
    const startedAt = Number(params.startedAt) || Date.now();
    const record = summaryRecordFromSession(
      {
        scenarioId: scenario?.id ?? params.scenarioId ?? 'unknown',
        scenarioTitle: scenario?.title ?? params.scenarioTitle ?? '',
        durationSeconds: Math.max(1, durationSeconds),
        startedAt,
      },
      summary
    );
    await saveCoachHistory(record);
    setSaved(true);
  };

  const isInterview = !!summary?.interview_feedback || !!params.interviewKind;
  const sceneLabel = (scenario?.id ?? 'coach').replace(/_/g, ' ').toUpperCase();
  const duration = `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader
        title={isInterview ? t('coachInterviewDebrief') : t('coachSessionSummary')}
        onBack={() => router.back()}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
          <Text style={{ color: c.inkMuted, marginTop: 12 }}>{t('coachSummaryLoading')}</Text>
        </View>
      ) : failed || !summary ? (
        <View style={styles.center}>
          <Text style={{ color: c.accent, textAlign: 'center' }}>{t('coachSummaryFailed')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[cardStyle(c.card, c.border), styles.hero]}>
            <Text style={[styles.scene, { color: c.inkMuted }]}>{sceneLabel}</Text>
            <Text style={[styles.heroTitle, { color: c.ink }]}>{scenario?.title}</Text>
            <View style={[styles.stats, { borderTopColor: c.divider }]}>
              <Stat value={String(summary.stats.turns)} label={t('coachRounds')} />
              <Stat value={String(summary.stats.corrections)} label={t('coachCorrections')} />
              <Stat value={duration} label={t('coachDuration')} />
            </View>
          </View>

          <SummaryPanel title={t('coachOverall')}>
            <Text style={[styles.bodyText, { color: c.ink }]}>{summary.overall_zh}</Text>
            <Text style={[styles.bodyText, styles.en, { color: c.inkMuted }]}>
              {summary.overall_en}
            </Text>
          </SummaryPanel>

          {summary.strengths.length ? (
            <SummaryPanel title={t('coachHighlights')}>
              {summary.strengths.map((item) => (
                <View key={item} style={styles.listItem}>
                  <Text style={[styles.marker, { color: c.accent }]}>✓</Text>
                  <Text style={[styles.itemText, { color: c.ink }]}>{item}</Text>
                </View>
              ))}
            </SummaryPanel>
          ) : null}

          {summary.improvements.length ? (
            <SummaryPanel title={t('coachImprovements')}>
              {summary.improvements.map((item) => (
                <View key={item} style={styles.listItem}>
                  <Text style={[styles.marker, { color: c.accent }]}>→</Text>
                  <Text style={[styles.itemText, { color: c.ink }]}>{item}</Text>
                </View>
              ))}
            </SummaryPanel>
          ) : null}

          {summary.interview_feedback ? (
            <SummaryPanel title={t('coachInterviewFeedback')}>
              <Text style={[styles.itemText, { color: c.ink }]}>
                {summary.interview_feedback.star_structure}
              </Text>
              <Text style={[styles.itemText, { color: c.ink, marginTop: 8 }]}>
                {summary.interview_feedback.quantified_impact}
              </Text>
              {summary.interview_feedback.weak_spots.map((item) => (
                <View key={item} style={styles.listItem}>
                  <Text style={[styles.marker, { color: c.accent }]}>→</Text>
                  <Text style={[styles.itemText, { color: c.ink }]}>{item}</Text>
                </View>
              ))}
            </SummaryPanel>
          ) : null}

          {summary.expressions.length ? (
            <SummaryPanel title={isInterview ? t('coachPhrasesToAdd') : t('coachExpressions')}>
              {summary.expressions.map((expression) => (
                <View
                  key={expression.en}
                  style={[styles.phrase, { backgroundColor: c.inputBg, borderColor: c.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.ink, fontSize: 13, fontWeight: '500' }}>
                      {expression.en}
                    </Text>
                    <Text style={{ color: c.inkMuted, fontSize: 11.5, marginTop: 2 }}>
                      {expression.zh}
                    </Text>
                  </View>
                  <Pressable onPress={() => void play(expression.en)} style={styles.phraseReplay}>
                    <CoachGlyph name="mic" color={c.inkLight} size={15} />
                    <Text style={{ color: c.inkLight, fontSize: 11 }}>{t('coachReplay')}</Text>
                  </Pressable>
                </View>
              ))}
            </SummaryPanel>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              label={t('coachTryAgain')}
              onPress={() =>
                router.replace({
                  pathname: '/coach/session',
                  params: {
                    scenarioId: scenario?.id ?? params.scenarioId ?? '',
                    source: scenario?.source ?? 'preset',
                    interviewKind: params.interviewKind,
                    profile: params.profile,
                  },
                })
              }
            />
            <SecondaryButton
              label={t('coachChangeScenario')}
              onPress={() => router.replace('/(tabs)/coach')}
            />
            <Pressable disabled={saved} onPress={() => void save()} style={styles.saveLink}>
              <Text style={{ color: saved ? c.inkMuted : c.accent, fontWeight: '600' }}>
                {saved ? t('coachHistorySaved') : t('coachSaveHistory')}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SummaryPanel({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[cardStyle(c.card, c.border), styles.panel]}>
      <Text style={[styles.panelTitle, { color: c.inkMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.inkMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function parseHistory(raw?: string): CoachTurn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CoachTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', padding: 18 },
  scene: { fontSize: 11, letterSpacing: 1.3, textAlign: 'center' },
  heroTitle: { fontSize: 19, fontWeight: '700', marginTop: 7, textAlign: 'center' },
  stats: { flexDirection: 'row', alignSelf: 'stretch', borderTopWidth: 1, marginTop: 16, paddingTop: 14 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 19, fontWeight: '700' },
  statLabel: { fontSize: 10.5, marginTop: 3 },
  panel: { marginTop: 12, padding: 15 },
  panelTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  bodyText: { fontSize: 13, lineHeight: 21 },
  en: { marginTop: 7 },
  listItem: { flexDirection: 'row', gap: 9, marginTop: 8 },
  marker: { width: 16, fontSize: 14, fontWeight: '700' },
  itemText: { flex: 1, fontSize: 13, lineHeight: 20 },
  phrase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
    marginTop: 8,
  },
  phraseReplay: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { gap: 10, marginTop: 18 },
  saveLink: { alignItems: 'center', paddingVertical: 8 },
});
