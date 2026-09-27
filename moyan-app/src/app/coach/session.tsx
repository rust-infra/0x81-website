import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/build/react-navigation/core';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../../components/AppHeader';
import { CoachAvatar } from '../../components/coach/CoachAvatar';
import { CoachGlyph, PrimaryButton, SecondaryButton } from '../../components/coach/CoachUi';
import { EndSessionSheet } from '../../components/coach/EndSessionSheet';
import { FeedbackPanel } from '../../components/coach/FeedbackPanel';
import { getCoachQuota, listCoachScenarios, postCoachTurn } from '../../lib/coach-api-runtime';
import {
  appendHistory,
  hasUserTurn,
  initialSession,
  sessionReducer,
} from '../../lib/coach-session';
import { loadCoachPrefs, loadCustomScenarios } from '../../lib/coach-storage';
import type {
  CoachFeedback,
  CoachScenario,
  CoachTurn,
  InterviewContext,
  InterviewKind,
} from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { getSpeechSettings, speak, stopSpeaking } from '../../lib/speech';
import { startListening, sttLocaleFor, type SttSession } from '../../lib/coach-stt';
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
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [mode, setMode] = useState<'feedback' | 'immersion'>(
    params.interviewKind ? 'immersion' : 'feedback'
  );
  const [quotaRemaining, setQuotaRemaining] = useState<number | null | undefined>();
  const [error, setError] = useState('');
  const [showEnd, setShowEnd] = useState(false);
  const [turnIndex, setTurnIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [startedAt] = useState(() => Date.now());
  const [volume, setVolume] = useState(0);
  const sttRef = useRef<SttSession | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const chatRef = useRef<ScrollView | null>(null);
  const shouldScrollRef = useRef(true);
  const [exitMode, setExitMode] = useState<'summary' | 'discard' | null>(null);
  const finishedRef = useRef(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const hasConversation = hasUserTurn(history);

  useEffect(() => {
    void (async () => {
      const [presets, custom] = await Promise.all([
        listCoachScenarios(lang).catch(() => []),
        loadCustomScenarios(),
      ]);
      const found = [...presets, ...custom].find((item) => item.id === params.scenarioId);
      if (!found) return;
      setScenario(found);
      shouldScrollRef.current = true;
      setHistory([{ role: 'coach', content: found.opening_line }]);
    })();
  }, [lang, params.scenarioId]);

  useEffect(() => {
    void loadCoachPrefs().then((prefs) => {
      setAutoPlay(prefs.autoPlay);
      if (!params.interviewKind) setMode(prefs.defaultMode);
    });
  }, [params.interviewKind]);

  useEffect(() => {
    void getCoachQuota()
      .then((quota) => setQuotaRemaining(quota.remaining))
      .catch(() => setQuotaRemaining(undefined));
  }, []);

  useEffect(
    () => () => {
      sttRef.current?.abort();
      void stopSpeaking();
    },
    []
  );

  useEffect(() => {
    if (session.state !== 'listening') setVolume(0);
  }, [session.state]);

  usePreventRemove(!!scenario && hasConversation && !exitMode, () => {
    setShowEnd(true);
  });

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

  const submit = async (override?: string) => {
    if (!scenario || session.state === 'thinking') return;
    const text = (override ?? input).trim();
    if (!text) return;
    sttRef.current?.stop();
    sttRef.current = null;
    setInput('');
    setError('');
    setFeedback(null);
    await stopSpeaking();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    dispatch({ type: 'USER_SUBMIT', id, text });
    const nextHistory = appendHistory(history, { role: 'user', content: text });
    shouldScrollRef.current = true;
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
      setFeedback(mode === 'immersion' ? null : response.feedback ?? null);
      setTurnIndex(response.turn_index);
      shouldScrollRef.current = true;
      setHistory(
        appendHistory(nextHistory, { role: 'coach', content: response.reply })
      );
      dispatch({ type: 'TURN_SUCCESS', id });
      if (autoPlay) await play(response.reply);
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
      shouldScrollRef.current = true;
      setHistory((current) => {
        const last = current.at(-1);
        return last?.role === 'user' && last.content === text
          ? current.slice(0, -1)
          : current;
      });
      dispatch({ type: 'TURN_ERROR', id, message });
    }
  };

  const toggleMic = async () => {
    if (!scenario) return;
    if (session.state === 'listening') {
      sttRef.current?.stop();
      sttRef.current = null;
      dispatch({ type: 'STOP_LISTENING' });
      return;
    }

    await stopSpeaking();
    try {
      sttRef.current = await startListening(sttLocaleFor(scenario.persona.locale), {
        onInterim: (text) => setInput(text),
        onFinal: (text) => {
          setInput(text);
          sttRef.current = null;
          dispatch({ type: 'STOP_LISTENING' });
          void submit(text);
        },
        onVolume: setVolume,
        onError: (message) => {
          sttRef.current = null;
          dispatch({ type: 'RESET' });
          if (/not-allowed|permission|denied/i.test(message)) {
            setMicPermissionDenied(true);
          } else {
            console.warn('[coach-stt] native error', message);
            toast(t('coachMicError'));
          }
        },
        onEnd: () => {
          sttRef.current = null;
          dispatch({ type: 'STOP_LISTENING' });
        },
      });
      dispatch({ type: 'START_LISTENING' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/denied|restricted/.test(message)) {
        setMicPermissionDenied(true);
      } else {
        console.warn('[coach-stt] start failed', message);
        toast(t('coachMicError'));
      }
    }
  };

  useEffect(() => {
    if (!exitMode || finishedRef.current) return;
    finishedRef.current = true;
    void stopSpeaking();
    sttRef.current?.abort();
    sttRef.current = null;
    if (exitMode === 'discard') {
      router.replace('/(tabs)/coach');
      return;
    }
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
  }, [
    exitMode,
    history,
    params.interviewKind,
    params.profile,
    router,
    scenario?.id,
    startedAt,
  ]);

  const finish = () => {
    setShowEnd(false);
    setExitMode('summary');
  };

  const discard = () => {
    setShowEnd(false);
    setExitMode('discard');
  };

  const requestExit = () => {
    if (!hasConversation) {
      void stopSpeaking();
      sttRef.current?.abort();
      sttRef.current = null;
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/coach');
      return;
    }
    setShowEnd(true);
  };

  if (!scenario) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <BackButton onPress={() => router.back()} color={c.studyText} />
          <Text style={[styles.scenarioTitle, { color: c.studyText, fontFamily: serif }]}>
            {t('coachLoadFailed')}
          </Text>
        </View>
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
  const isInterview = !!params.interviewKind;
  const liveText =
    input.trim() ||
    (session.state === 'listening'
      ? t('coachListening')
      : session.pendingText && session.state === 'error'
        ? session.pendingText
        : '');
  const statusText =
    session.state === 'listening'
      ? t('coachListeningStatus')
      : session.state === 'thinking'
        ? t('coachThinkingStatus')
        : session.state === 'speaking'
          ? t('coachSpeakingStatus')
          : t('coachWaitingStatus');

  const stopAudio = () => {
    void stopSpeaking();
    sttRef.current?.abort();
    sttRef.current = null;
    setVolume(0);
    dispatch({ type: 'RESET' });
  };

  if (micPermissionDenied) {
    return (
      <PermissionState
        onBack={requestExit}
        onSettings={() => void Linking.openSettings()}
        onKeyboard={() => {
          setMicPermissionDenied(false);
          setKeyboardOpen(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <BackButton onPress={requestExit} color={c.studyText} />
          <Text
            numberOfLines={1}
            style={[styles.scenarioTitle, { color: c.studyText, fontFamily: serif }]}
          >
            {scenario.title}
          </Text>
          <View style={styles.topPills}>
            <Text style={[styles.headPill, { backgroundColor: c.tagBg, color: c.studyMuted }]}>
              {turnIndex} / {scenario.max_turns}
            </Text>
            {quotaRemaining !== undefined && quotaRemaining !== null ? (
              <Text style={[styles.headPill, { backgroundColor: c.tagBg, color: c.studyMuted }]}>
                {t('coachToday')} {quotaRemaining}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={requestExit}
            style={[styles.endChip, { borderColor: c.border }]}
          >
            <Text style={{ color: c.studyText, fontSize: 12 }}>{t('coachEnd')}</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={chatRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            if (shouldScrollRef.current) {
              chatRef.current?.scrollToEnd({ animated: true });
              shouldScrollRef.current = false;
            }
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            shouldScrollRef.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 36;
          }}
          scrollEventThrottle={16}
        >
          <View style={[styles.coachStrip, { backgroundColor: c.studyCard, borderColor: c.border }]}>
            <CoachAvatar
              state={avatarState}
              mood="friendly"
              size={54}
              volume={Math.max(0, Math.min(1, (volume + 2) / 12))}
            />
            <View style={styles.coachStripBody}>
              <Text style={[styles.coachName, { color: c.studyText }]}>
                {scenario.persona.name}
              </Text>
              <Text numberOfLines={1} style={[styles.coachRole, { color: c.studyMuted }]}>
                {scenario.persona.role} · {scenario.persona.locale}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <View style={[styles.liveDot, { backgroundColor: c.accent }]} />
              <Text style={{ color: c.studyMuted, fontSize: 10.5 }}>{statusText}</Text>
            </View>
          </View>

          <View style={styles.messages}>
            {history.map((turn, index) => {
              const isUser = turn.role === 'user';
              const latestCoach = !isUser && index === history.length - 1;
              return (
                <View
                  key={`${turn.role}-${index}-${turn.content.slice(0, 12)}`}
                  style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowCoach]}
                >
                  {!isUser ? (
                    <View style={[styles.messageAvatar, { backgroundColor: c.accentLight }]}>
                      <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                        {scenario.persona.name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.messageBubble,
                      isUser ? styles.userBubble : styles.coachBubble,
                      {
                        backgroundColor: isUser ? c.accentLight : c.studyCard,
                        borderColor: isUser ? c.accentLight : c.border,
                      },
                    ]}
                  >
                    <Text style={[styles.messageText, { color: c.studyText }]}>
                      {turn.content}
                    </Text>
                    {latestCoach ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void play(turn.content)}
                        style={[styles.bubbleReplay, { borderColor: c.border }]}
                      >
                        <CoachGlyph name="mic" color={c.inkLight} size={14} />
                        <Text style={{ color: c.inkLight, fontSize: 10.5 }}>
                          {t('coachReplay')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {liveText && session.state === 'listening' ? (
              <View style={[styles.messageRow, styles.messageRowUser]}>
                <View
                  style={[
                    styles.messageBubble,
                    styles.userBubble,
                    { backgroundColor: c.accentLight, borderColor: c.accentLight },
                  ]}
                >
                  <Text style={[styles.messageText, { color: c.studyText }]}>{liveText}</Text>
                  <Text style={{ color: c.studyMuted, fontSize: 10.5, marginTop: 4 }}>
                    {t('coachListening')}
                  </Text>
                </View>
              </View>
            ) : null}

            {session.state === 'thinking' ? (
              <View style={[styles.messageRow, styles.messageRowCoach]}>
                <View style={[styles.messageAvatar, { backgroundColor: c.accentLight }]}>
                  <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                    {scenario.persona.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.typingBubble, { backgroundColor: c.studyCard, borderColor: c.border }]}>
                  <Text style={{ color: c.studyMuted, fontSize: 13 }}>{t('coachThinking')}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {error ? (
            <View style={[styles.errorCard, { backgroundColor: c.accentLight, borderLeftColor: c.accent }]}>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{t('coachTurnFailedTitle')}</Text>
              <Text style={{ color: c.inkLight, lineHeight: 20, marginTop: 5 }}>
                {t('coachTurnFailedDesc')}
              </Text>
              <Pressable
                onPress={() => void submit()}
                style={[styles.retryButton, { backgroundColor: c.accentLight }]}
              >
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t('coachRetry')}</Text>
              </Pressable>
            </View>
          ) : null}

          {!isInterview && mode === 'feedback' ? (
            <FeedbackPanel feedback={feedback} onSpeak={(text) => void play(text)} />
          ) : null}

          {isInterview ? (
            <View style={[styles.modeNote, { backgroundColor: c.tagBg }]}>
              <Text style={{ color: c.studyMuted, fontSize: 12, lineHeight: 18 }}>
                {t('coachInterviewModeHint')}
              </Text>
            </View>
          ) : null}

        </ScrollView>

        <View style={[styles.controls, { borderTopColor: c.divider }]}>
          {!isInterview ? (
            <View style={styles.modes}>
              <Pressable
                onPress={() => setMode('feedback')}
                style={[
                  styles.modeButton,
                  { borderColor: c.border },
                  mode === 'feedback' && { backgroundColor: c.ink, borderColor: c.ink },
                ]}
              >
                <Text style={{ color: mode === 'feedback' ? c.paper : c.studyMuted, fontSize: 11.5 }}>
                  {t('coachFeedbackMode')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMode('immersion')}
                style={[
                  styles.modeButton,
                  { borderColor: c.border },
                  mode === 'immersion' && { backgroundColor: c.ink, borderColor: c.ink },
                ]}
              >
                <Text style={{ color: mode === 'immersion' ? c.paper : c.studyMuted, fontSize: 11.5 }}>
                  {t('coachImmersion')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {keyboardOpen ? (
            <>
              <View style={[styles.composer, { backgroundColor: c.studyCard, borderColor: c.border }]}>
                <TextInput
                  ref={inputRef}
                  accessibilityLabel="coach-input"
                  value={input}
                  onChangeText={setInput}
                  placeholder={t('coachInputPlaceholder')}
                  placeholderTextColor={c.studyMuted}
                  style={[styles.input, { color: c.studyText }]}
                  multiline
                  maxLength={2_000}
                  autoFocus
                />
                <Pressable
                  accessibilityLabel="coach-send"
                  disabled={!input.trim() || session.state === 'thinking'}
                  onPress={() => {
                    void submit();
                    setKeyboardOpen(false);
                  }}
                >
                  <Text
                    style={{
                      color: input.trim() ? c.accent : c.studyMuted,
                      fontWeight: '700',
                    }}
                  >
                    {t('coachSend')}
                  </Text>
                </Pressable>
              </View>
              <Text style={[styles.controlHint, { color: c.studyMuted }]}>
                {t('coachKeyboardHint')}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.voiceRow}>
                <Pressable
                  accessibilityLabel="coach-keyboard"
                  accessibilityRole="button"
                  onPress={() => setKeyboardOpen(true)}
                  style={[styles.roundControl, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <CoachGlyph name="keyboard" color={c.ink} size={20} />
                </Pressable>
                <View
                  style={[
                    styles.micRing,
                    {
                      borderColor: session.state === 'listening' ? c.accent : 'transparent',
                    },
                  ]}
                >
                  <Pressable
                    accessibilityLabel="coach-mic"
                    accessibilityRole="button"
                    onPress={() => void toggleMic()}
                    style={[styles.mic, { backgroundColor: c.buttonBg }]}
                  >
                    <CoachGlyph name="mic" color={c.buttonText} size={26} />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityLabel="coach-stop"
                  accessibilityRole="button"
                  onPress={stopAudio}
                  style={[styles.roundControl, { backgroundColor: c.card, borderColor: c.border }]}
                >
                  <CoachGlyph name="stop" color={c.ink} size={20} />
                </Pressable>
              </View>
              <Text style={[styles.controlHint, { color: c.studyMuted }]}>
                {isInterview ? t('coachInterviewEndHint') : t('coachVoiceControlHint')}
              </Text>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <EndSessionSheet
        visible={showEnd}
        onCancel={() => setShowEnd(false)}
        onConfirm={finish}
        onDiscard={hasConversation ? discard : undefined}
      />
    </SafeAreaView>
  );
}

function PermissionState({
  onBack,
  onSettings,
  onKeyboard,
}: {
  onBack: () => void;
  onSettings: () => void;
  onKeyboard: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <BackButton onPress={onBack} color={c.ink} />
        <Text style={[styles.scenarioTitle, { color: c.ink, fontFamily: serif }]}>
          {t('coachPageTitle')}
        </Text>
      </View>
      <View style={styles.permissionBody}>
        <View style={[styles.permissionIcon, { backgroundColor: c.card, borderColor: c.border }]}>
          <CoachGlyph name="micOff" color={c.ink} size={30} />
        </View>
        <Text style={[styles.permissionTitle, { color: c.ink }]}>
          {t('coachPermissionMicTitle')}
        </Text>
        <Text style={[styles.permissionText, { color: c.inkMuted }]}>
          {t('coachPermissionMicDesc')}
        </Text>
        <Text style={[styles.permissionFoot, { color: c.inkMuted }]}>
          {t('coachPermissionMicFootnote')}
        </Text>
        <View style={styles.permissionActions}>
          <PrimaryButton label={t('coachOpenSettings')} onPress={onSettings} variant="accent" />
          <SecondaryButton label={t('coachUseKeyboard')} onPress={onKeyboard} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  scenarioTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  topPills: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headPill: { fontSize: 10.5, borderRadius: 999, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  endChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  coachStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  coachStripBody: { flex: 1, minWidth: 0 },
  coachName: { fontSize: 13.5, fontWeight: '700' },
  coachRole: { fontSize: 10.5, marginTop: 2 },
  messages: { gap: 10, marginTop: 12 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowCoach: { justifyContent: 'flex-start' },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userBubble: { borderBottomRightRadius: 5 },
  coachBubble: { borderBottomLeftRadius: 5 },
  messageText: { fontSize: 14, lineHeight: 21 },
  bubbleReplay: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 8,
  },
  typingBubble: {
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  errorCard: { marginTop: 10, borderLeftWidth: 3, borderRadius: 14, padding: 13 },
  retryButton: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10 },
  modeNote: { marginTop: 10, borderRadius: 12, padding: 11 },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
  },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 12 },
  modeButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 5 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  roundControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    minHeight: 48,
    maxHeight: 110,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, maxHeight: 80, paddingTop: 0 },
  controlHint: { textAlign: 'center', fontSize: 11, marginTop: 11 },
  permissionBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 70 },
  permissionIcon: { width: 96, height: 96, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { fontSize: 20, fontWeight: '700', marginTop: 24, textAlign: 'center' },
  permissionText: { fontSize: 13, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  permissionFoot: { fontSize: 11.5, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  permissionActions: { alignSelf: 'stretch', gap: 9, marginTop: 24 },
});
