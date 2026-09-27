import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useReducer, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoachAvatar } from '../../components/coach/CoachAvatar';
import { EndSessionSheet } from '../../components/coach/EndSessionSheet';
import { FeedbackPanel } from '../../components/coach/FeedbackPanel';
import { getCoachQuota, listCoachScenarios, postCoachTurn } from '../../lib/coach-api';
import {
  appendHistory,
  initialSession,
  sessionReducer,
} from '../../lib/coach-session';
import { loadCustomScenarios } from '../../lib/coach-storage';
import type {
  CoachFeedback,
  CoachScenario,
  CoachTurn,
  InterviewContext,
  InterviewKind,
} from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { getSpeechSettings, speak, stopSpeaking } from '../../lib/speech';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { roundButton, serif } from '../../lib/ui';

export default function CoachSessionScreen() {
  const params = useLocalSearchParams<{
    scenarioId?: string;
    source?: string;
    interviewKind?: string;
    profile?: string;
  }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [scenario, setScenario] = useState<CoachScenario | null>(null);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [history, setHistory] = useState<CoachTurn[]>([]);
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [mode, setMode] = useState<'feedback' | 'immersion'>(
    params.interviewKind ? 'immersion' : 'feedback'
  );
  const [quotaRemaining, setQuotaRemaining] = useState<number | null | undefined>();
  const [error, setError] = useState('');
  const [showEnd, setShowEnd] = useState(false);
  const [turnIndex, setTurnIndex] = useState(0);
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    void (async () => {
      const [presets, custom] = await Promise.all([
        listCoachScenarios(lang).catch(() => []),
        loadCustomScenarios(),
      ]);
      const found = [...presets, ...custom].find((item) => item.id === params.scenarioId);
      if (!found) return;
      setScenario(found);
      setReply(found.opening_line);
      setHistory([{ role: 'coach', content: found.opening_line }]);
    })();
  }, [lang, params.scenarioId]);

  useEffect(() => {
    void getCoachQuota()
      .then((quota) => setQuotaRemaining(quota.remaining))
      .catch(() => setQuotaRemaining(undefined));
  }, []);

  useEffect(() => () => void stopSpeaking(), []);

  const play = async (text: string) => {
    if (!scenario || !text.trim()) return;
    const settings = await getSpeechSettings();
    await speak(text, {
      language: scenario.persona.locale,
      voiceId:
        scenario.persona.locale === 'zh-CN'
          ? settings.speech_zh_voice
          : settings.speech_voice,
    });
  };

  const interview = (): InterviewContext | undefined => {
    if (!params.interviewKind || !params.profile) return undefined;
    const kind: InterviewKind | 'resume_job' =
      params.interviewKind === 'job' || params.interviewKind === 'resume_job'
        ? params.interviewKind
        : 'resume';
    return { kind, profile: params.profile };
  };

  const submit = async () => {
    if (!scenario || !input.trim() || session.state === 'thinking') return;
    const text = input.trim();
    setInput('');
    setError('');
    await stopSpeaking();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    dispatch({ type: 'USER_SUBMIT', id, text });
    const nextHistory = appendHistory(history, { role: 'user', content: text });
    setHistory(nextHistory);

    try {
      const response = await postCoachTurn({
        scenario,
        scenario_id: scenario.source === 'preset' ? scenario.id : undefined,
        history,
        user_text: text,
        coach_mode: mode,
        locale: lang,
        interview: interview(),
      });
      setReply(response.reply);
      setFeedback(mode === 'immersion' ? null : response.feedback ?? null);
      setTurnIndex(response.turn_index);
      setHistory(
        appendHistory(nextHistory, { role: 'coach', content: response.reply })
      );
      dispatch({ type: 'TURN_SUCCESS', id });
      await play(response.reply);
      dispatch({ type: 'START_LISTENING' });
      dispatch({ type: 'STOP_LISTENING' });
      void getCoachQuota()
        .then((quota) => setQuotaRemaining(quota.remaining))
        .catch(() => undefined);
      if (response.limit_reached) setShowEnd(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setInput(text);
      dispatch({ type: 'TURN_ERROR', id, message });
    }
  };

  const finish = () => {
    void stopSpeaking();
    router.replace({
      pathname: '/coach/summary',
      params: {
        scenarioId: scenario?.id ?? '',
        history: JSON.stringify(history),
        startedAt: String(startedAt),
        interviewKind: params.interviewKind ?? '',
        profile: params.profile ?? '',
      },
    });
  };

  if (!scenario) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]}>
        <Text style={{ color: c.studyMuted, textAlign: 'center', marginTop: 80 }}>
          {t('loadFailed')}
        </Text>
      </SafeAreaView>
    );
  }

  const avatarState =
    session.state === 'listening'
      ? 'listening'
      : session.state === 'thinking'
        ? 'thinking'
        : session.state === 'speaking'
          ? 'speaking'
          : 'idle';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => setShowEnd(true)} hitSlop={10}>
            <Text style={{ color: c.studyMuted, fontWeight: '600' }}>{t('coachEnd')}</Text>
          </Pressable>
          <View style={styles.topCenter}>
            <Text style={[styles.scenarioTitle, { color: c.studyText, fontFamily: serif }]} numberOfLines={1}>
              {scenario.title}
            </Text>
            <Text style={{ color: c.studyMuted, fontSize: 11, marginTop: 3 }}>
              {turnIndex}/{scenario.max_turns}
              {quotaRemaining !== undefined
                ? ` · ${quotaRemaining === null ? t('coachUnlimited') : quotaRemaining}`
                : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => setMode((value) => (value === 'feedback' ? 'immersion' : 'feedback'))}
            style={[styles.modeChip, { borderColor: c.studyMuted }]}
          >
            <Text style={{ color: c.studyMuted, fontSize: 11 }}>
              {mode === 'immersion' ? t('coachImmersion') : t('coachFeedbackMode')}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.avatarWrap}>
            <CoachAvatar state={avatarState} mood="friendly" size={210} />
          </View>
          <Pressable onPress={() => void play(reply)} style={styles.replyBlock}>
            <Text style={[styles.reply, { color: c.studyText }]}>{reply}</Text>
            <Text style={{ color: c.accent, fontSize: 12, marginTop: 8 }}>{t('coachReplay')}</Text>
          </Pressable>

          {session.state === 'thinking' ? (
            <Text style={{ color: c.studyMuted, textAlign: 'center' }}>{t('coachThinking')}</Text>
          ) : null}
          {error ? (
            <View style={styles.errorRow}>
              <Text style={{ color: c.accent, flex: 1 }}>{t('coachSessionError')}</Text>
              <Pressable onPress={() => void submit()}>
                <Text style={{ color: c.studyText, fontWeight: '700' }}>{t('coachRetry')}</Text>
              </Pressable>
            </View>
          ) : null}
          {mode === 'feedback' ? (
            <FeedbackPanel feedback={feedback} onSpeak={(text) => void play(text)} />
          ) : null}
        </ScrollView>

        <View style={[styles.controls, { borderTopColor: c.border }]}>
          <Pressable
            onPress={() => toast(t('coachVoiceUnavailable'))}
            style={[styles.mic, { backgroundColor: c.studyCard, borderColor: c.studyMuted }]}
          >
            <Text style={{ color: c.studyMuted, fontSize: 22 }}>◉</Text>
          </Pressable>
          <View style={[styles.inputWrap, { backgroundColor: c.studyCard }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('coachInputPlaceholder')}
              placeholderTextColor={c.studyMuted}
              style={[styles.input, { color: c.studyText }]}
              multiline
              maxLength={2_000}
            />
            <Pressable
              disabled={!input.trim() || session.state === 'thinking'}
              onPress={() => void submit()}
            >
              <Text style={{ color: input.trim() ? c.accent : c.studyMuted, fontWeight: '700' }}>
                {t('coachSend')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <EndSessionSheet
        visible={showEnd}
        onCancel={() => setShowEnd(false)}
        onConfirm={() => {
          setShowEnd(false);
          finish();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 10,
  },
  topCenter: { flex: 1, alignItems: 'center' },
  scenarioTitle: { fontSize: 16, fontWeight: '700', maxWidth: '80%' },
  modeChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  avatarWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 10 },
  replyBlock: { alignItems: 'center', paddingHorizontal: 8, marginBottom: 8 },
  reply: { fontSize: 18, lineHeight: 27, textAlign: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  mic: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    minHeight: 48,
    maxHeight: 110,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, maxHeight: 80, paddingTop: 0 },
});
