import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listCoachScenarios, postCoachSummary } from '../../lib/coach-api';
import { summaryRecordFromSession } from '../../lib/coach-history';
import { saveCoachHistory } from '../../lib/coach-storage';
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
import { cardStyle, roundButton, screen, serif } from '../../lib/ui';

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

  useEffect(() => {
    void (async () => {
      if (params.record) {
        try {
          const record = JSON.parse(params.record) as CoachHistoryRecord;
          setSummary(record.summary);
          setScenario({
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
          });
          setSaved(true);
          setLoading(false);
          return;
        } catch {
          // fall through to API summary
        }
      }

      const presets = await listCoachScenarios(lang).catch(() => []);
      const current = presets.find((item) => item.id === params.scenarioId) ?? null;
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
  }, [lang, params.history, params.interviewKind, params.profile, params.record, params.scenarioId]);

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
        scenarioTitle: scenario?.title ?? '',
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        startedAt,
      },
      summary
    );
    await saveCoachHistory(record);
    setSaved(true);
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={[roundButton, { backgroundColor: c.inputBg }]}
          >
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('coachFinishNow')}
          </Text>
          <View style={roundButton} />
        </View>
      </View>

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
        <ScrollView contentContainerStyle={[screen.body, styles.body]}>
          <Text style={[styles.title, { color: c.ink, fontFamily: serif }]}>
            {scenario?.title ?? params.scenarioTitle}
          </Text>
          <Text style={{ color: c.inkMuted, marginTop: 6 }}>
            {t('coachTurns', { count: summary.stats.turns })} · {summary.stats.corrections}
          </Text>

          <Section title={t('coachOverall')} color={c.ink} card={c.card}>
            <Text style={{ color: c.inkLight, lineHeight: 22 }}>
              {lang === 'en' ? summary.overall_en : summary.overall_zh}
            </Text>
          </Section>
          <ListSection
            title={t('coachHighlights')}
            items={summary.strengths}
            color={c.ink}
            card={c.card}
          />
          <ListSection
            title={t('coachImprovements')}
            items={summary.improvements}
            color={c.ink}
            card={c.card}
          />

          {summary.interview_feedback ? (
            <Section title={t('coachCorrections')} color={c.ink} card={c.card}>
              <Text style={{ color: c.inkLight, lineHeight: 22 }}>
                {summary.interview_feedback.star_structure}
              </Text>
              <Text style={{ color: c.inkLight, lineHeight: 22, marginTop: 8 }}>
                {summary.interview_feedback.quantified_impact}
              </Text>
              {summary.interview_feedback.weak_spots.map((item) => (
                <Text key={item} style={{ color: c.inkMuted, marginTop: 6 }}>
                  · {item}
                </Text>
              ))}
            </Section>
          ) : null}

          <Section title={t('coachExpressions')} color={c.ink} card={c.card}>
            {summary.expressions.map((expression) => (
              <Pressable
                key={expression.en}
                onPress={() => void play(expression.en)}
                style={styles.expressionRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink }}>{expression.en}</Text>
                  <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 2 }}>
                    {expression.zh}
                  </Text>
                </View>
                <Text style={{ color: c.accent }}>{t('coachReplay')}</Text>
              </Pressable>
            ))}
          </Section>

          <View style={styles.actions}>
            <Pressable
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
              style={[styles.primary, { backgroundColor: c.buttonBg }]}
            >
              <Text style={{ color: c.buttonText, fontWeight: '700' }}>{t('coachTryAgain')}</Text>
            </Pressable>
            <Pressable
              onPress={() => router.replace('/(tabs)/coach')}
              style={[styles.secondary, { borderColor: c.border }]}
            >
              <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachChangeScenario')}</Text>
            </Pressable>
            <Pressable
              disabled={saved}
              onPress={() => void save()}
              style={[styles.secondary, { borderColor: saved ? c.border : c.accent }]}
            >
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

function parseHistory(raw?: string): CoachTurn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CoachTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function Section({
  title,
  card,
  color,
  children,
}: {
  title: string;
  card: string;
  color: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[cardStyle(card, c.border), styles.section]}>
      <Text style={{ color, fontWeight: '700', marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

function ListSection({
  title,
  items,
  card,
  color,
}: {
  title: string;
  items: string[];
  card: string;
  color: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  if (items.length === 0) return null;
  return (
    <Section title={title} card={card} color={color}>
      {items.map((item) => (
        <Text key={item} style={{ color: c.inkLight, lineHeight: 22 }}>
          · {item}
        </Text>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  body: { paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700' },
  section: { marginTop: 14 },
  expressionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  actions: { gap: 10, marginTop: 20 },
  primary: { alignItems: 'center', borderRadius: 14, paddingVertical: 14 },
  secondary: { alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 13 },
});
