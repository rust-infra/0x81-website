import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/build/react-navigation/core';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../../components/AppHeader';
import { CoachAvatar } from '../../components/coach/CoachAvatar';
import { CoachGlyph, PrimaryButton, SecondaryButton } from '../../components/coach/CoachUi';
import { EndSessionSheet } from '../../components/coach/EndSessionSheet';
import { InlineFeedback } from '../../components/coach/InlineFeedback';
import { NextLinesPanel } from '../../components/coach/NextLinesPanel';
import { ApiError } from '../../lib/api-error';
import { CLOUD_RECORDING_OPTIONS, readRecordingBase64 } from '../../lib/coach-recorder';
import { getCoachQuota, listCoachScenarios, postCoachTurn } from '../../lib/coach-api-runtime';
import {
  appendHistory,
  createTurnRequestGate,
  filterNextLines,
  hasUserTurn,
  initialSession,
  latestFeedbackTurnIndex,
  latestNextLines,
  matchNextLine,
  newTurnId,
  prepareHistoryForTurn,
  restorableDraft,
  sessionReducer,
  turnLimitReached,
  wireHistory,
  type SessionTurn,
} from '../../lib/coach-session';
import {
  clearSessionDraft,
  loadCoachPrefs,
  loadCustomScenarios,
  loadSessionDraft,
  saveSessionDraft,
} from '../../lib/coach-storage';
import type {
  CoachExpression,
  CoachScenario,
  CoachSessionDraft,
  InterviewContext,
  InterviewKind,
} from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { getSpeechSettings, speak, stopSpeaking } from '../../lib/speech';
import { transcribeWithGoogleCloud } from '../../lib/coach-stt-google-cloud';
import { transcribeWithGemini } from '../../lib/coach-stt-cloud';
import { startListening, sttLocaleFor, type SttSession } from '../../lib/coach-stt';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { roundButton, serif } from '../../lib/ui';

const COMMON_STT_HINTS = [
  'API',
  'UI',
  'PR',
  'pull request',
  'code review',
  'standup',
  'blocker',
  'rollback',
  'latency',
  'throughput',
  'deployment',
  'incident',
  'customer impact',
  'trade-off',
  'migration',
];

function scenarioSttHints(scenario: CoachScenario): string[] {
  return [
    ...COMMON_STT_HINTS,
    scenario.persona.name,
    scenario.persona.role,
    ...scenario.focus_points,
    ...(scenario.opening_next_lines ?? []).map((line) => line.en),
  ];
}

/**
 * 消息列表（单独抽出来 memo 化）。
 *
 * 为什么要拆：会话页上还有几个**高频变化**的状态 —— 输入框每一键、STT 实时识别
 * 文本、麦克风音量采样。它们原本和消息列表在同一个组件里，于是每次变化都会让整列
 * 气泡跟着重渲染/重挂载，看上去就是"一闪一闪"。这里只依赖真正影响列表的 props，
 * 再配合稳定的 turn.id 做 key，列表就不再被无关状态牵着走。
 *
 * 注意：`onSpeakText` 必须由页面用 useCallback 固定引用，否则 memo 会被击穿。
 */
const Messages = memo(function Messages({
  history,
  showFeedback,
  showNextLines,
  personaInitial,
  onSpeakText,
}: {
  history: SessionTurn[];
  showFeedback: boolean;
  showNextLines: boolean;
  personaInitial: string;
  onSpeakText: (text: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { t } = useI18n();
  // 推荐语属于「最新一条教练回复」：按角色找最后一条，而不是只看列表末尾 ——
  // 用户刚说完、教练还在思考时，末尾是用户消息，但推荐语仍应挂在上一条回复上。
  const lastCoachIndex = history.reduce(
    (found, turn, index) => (turn.role === 'coach' ? index : found),
    -1
  );
  const lastFeedbackIndex = latestFeedbackTurnIndex(history);
  return (
    <>
            {history.map((turn, index) => {
              const isUser = turn.role === 'user';
              const latestCoach = !isUser && index === lastCoachIndex;
              const turnFeedback =
                isUser && showFeedback ? turn.feedback ?? null : null;
              // 连续同角色的消息贴紧，换角色时多留白：让「一问一答」在视觉上成组，
              // 头像也只出现在每一组的头一条（主流聊天应用的做法）。
              const previous = history[index - 1];
              const startsTurn = !previous || previous.role !== turn.role;
              const showAvatar = !isUser && startsTurn;
              return (
                <View
                  key={turn.id ?? `${turn.role}-${index}`}
                  style={[
                    styles.messageRow,
                    isUser ? styles.messageRowUser : styles.messageRowCoach,
                    // 并进推荐语后这张卡变高：头像跟着贴底会像是另一块，
                    // 所以这一行改成顶部对齐，头像与回复首行齐平。
                    latestCoach && showNextLines ? styles.messageRowTop : null,
                    !showAvatar && !isUser ? styles.messageRowIndent : null,
                    index === 0 ? null : startsTurn ? styles.turnGap : styles.sameRoleGap,
                  ]}
                >
                  {showAvatar ? (
                    <View style={[styles.messageAvatar, { backgroundColor: c.accentLight }]}>
                      <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                        {personaInitial}
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
                    {turn.matchedSuggestion ? (
                      <View style={[styles.matchedSuggestion, { backgroundColor: c.inputBg }]}>
                        <CoachGlyph name="chat" color={c.accent} size={12} />
                        <View style={styles.matchedSuggestionText}>
                          <Text style={[styles.matchedSuggestionLabel, { color: c.accent }]}>
                            {t('coachUsedSuggestion')}
                          </Text>
                          <Text style={[styles.messageText, { color: c.studyText }]}>
                            {turn.matchedSuggestion.en}
                          </Text>
                          {turn.matchedSuggestion.zh ? (
                            <Text style={[styles.messageZh, { color: c.studyMuted }]}>
                              {turn.matchedSuggestion.zh}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                    {turn.contentZh ? (
                      <Text style={[styles.messageZh, { color: c.studyMuted }]}>
                        {turn.contentZh}
                      </Text>
                    ) : null}
                    {turnFeedback ? (
                      <InlineFeedback
                        feedback={turnFeedback}
                        defaultOpen={index === lastFeedbackIndex}
                        onSpeak={(text) => void onSpeakText(text)}
                      />
                    ) : null}
                    {latestCoach ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void onSpeakText(turn.content)}
                        style={[styles.bubbleReplay, { borderColor: c.border }]}
                      >
                        <CoachGlyph name="mic" color={c.inkLight} size={14} />
                        <Text style={{ color: c.inkLight, fontSize: 10.5 }}>
                          {t('coachReplay')}
                        </Text>
                      </Pressable>
                    ) : null}
                    {/* 推荐语并进同一条回复的卡片里：被回复的是这一句，分成两张卡会像两条消息。
                        最新一条默认展开；旧卡只留一行折叠入口，点开还能回看当时的推荐语。 */}
                    {showNextLines && (turn.nextLines?.length ?? 0) > 0 ? (
                      <NextLinesPanel
                        embedded
                        lines={turn.nextLines ?? []}
                        defaultOpen={latestCoach}
                        onSpeak={(text) => void onSpeakText(text)}
                      />
                    ) : null}
                  </View>
                </View>
              );
            })}
    </>
  );
});

function ThinkingDots({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const progress = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.forEach((value) => value.setValue(0.65));
      return;
    }
    const animations = progress.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 110),
          Animated.timing(value, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 110),
        ])
      )
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [progress, reduceMotion]);

  return (
    <View style={styles.thinkingDots}>
      {progress.map((value, dot) => (
        <Animated.View
          key={dot}
          style={[
            styles.thinkingDot,
            {
              backgroundColor: color,
              opacity: value.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1],
              }),
              transform: [
                {
                  translateY: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, -3],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

interface TurnErrorState {
  message: string;
  status?: number;
}

interface CoachSttConfig {
  provider: 'system' | 'google-cloud' | 'gemini';
  apiKey: string;
  model: string;
  serviceAccountJson: string;
  projectId: string;
  location: string;
  recognizer: string;
  languageCode: string;
}

export default function CoachSessionScreen() {
  const params = useLocalSearchParams<{
    scenarioId?: string;
    source?: string;
    interviewKind?: string;
    profile?: string;
  }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mountedRef.current) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [scenario, setScenario] = useState<CoachScenario | null>(null);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [history, setHistory] = useState<SessionTurn[]>([]);
  const [input, setInput] = useState('');
  const [pendingRetryText, setPendingRetryText] = useState('');
  const [turnError, setTurnError] = useState<TurnErrorState | null>(null);
  const [mode, setMode] = useState<'feedback' | 'immersion'>(
    params.interviewKind ? 'immersion' : 'feedback'
  );
  const [quotaRemaining, setQuotaRemaining] = useState<number | null | undefined>();
  const [showEnd, setShowEnd] = useState(false);
  const [turnIndex, setTurnIndex] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [volume, setVolume] = useState(0);
  const sttRef = useRef<SttSession | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const chatRef = useRef<ScrollView | null>(null);
  const shouldScrollRef = useRef(true);
  const [exitMode, setExitMode] = useState<'summary' | 'discard' | null>(null);
  const finishedRef = useRef(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [startingMic, setStartingMic] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sttConfig, setSttConfig] = useState<CoachSttConfig>({
    provider: 'system',
    apiKey: '',
    model: 'gemini-3.8-flash',
    serviceAccountJson: '',
    projectId: '',
    location: 'us-central1',
    recognizer: '_',
    languageCode: 'en-US',
  });
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasConversation = hasUserTurn(history);

  const [turnGate] = useState(() => createTurnRequestGate());
  const pendingUserTurnIdRef = useRef<string | null>(null);
  const pendingUserTurnTextRef = useRef('');
  const historyBeforeTurnRef = useRef<SessionTurn[]>([]);
  const sttStartSeqRef = useRef(0);
  const sttStartingRef = useRef(false);
  const cloudRecordingRef = useRef(false);
  /** 录音器已经 prepare 过（在录，或录完待停止）—— 决定 stop 到底该不该调。 */
  const recorderArmedRef = useRef(false);
  const mountedRef = useRef(true);
  const audioRecorder = useAudioRecorder(CLOUD_RECORDING_OPTIONS);

  /**
   * 停止录音的唯一入口。
   *
   * expo-audio 的 `stop()` 在「没在录」或「shared object 已经随卸载释放」时会 reject
   * （`Cannot use shared object that was already released`）。页面里原本有 4 处
   * fire-and-forget 的 stop（卸载、退出、放弃、取消启动），它们都不做状态判断，
   * 于是日志里持续刷未捕获的 promise rejection。收成一个幂等入口：
   * 只在确实 prepare 过时调一次，并吞掉「已经无法停止」。
   */
  const stopRecording = useCallback(async (): Promise<boolean> => {
    if (!recorderArmedRef.current) return false;
    recorderArmedRef.current = false;
    cloudRecordingRef.current = false;
    try {
      await audioRecorder.stop();
      return true;
    } catch {
      // 录音对象可能已经随卸载释放；此时没有可停止的会话。
      return false;
    }
  }, [audioRecorder]);

  const scenarioLoadIdRef = useRef<string | undefined>(undefined);
  /** 草稿读取完成前不要落盘，否则会用空历史覆盖掉还没恢复的草稿。 */
  const draftReadyRef = useRef(false);
  /** 本局是从草稿恢复的（决定默认练习模式不要覆盖草稿里的模式）。 */
  const restoredDraftRef = useRef<CoachSessionDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [presets, custom, draft] = await Promise.all([
        listCoachScenarios(lang).catch(() => []),
        loadCustomScenarios(),
        loadSessionDraft().catch(() => null),
      ]);
      if (cancelled) return;
      const found = [...presets, ...custom].find((item) => item.id === params.scenarioId);
      if (!found) return;
      setScenario(found);
      // Locale changes may refresh localized scenario metadata, but must not
      // replace the opening line/history of an active conversation.
      if (scenarioLoadIdRef.current !== params.scenarioId) {
        scenarioLoadIdRef.current = params.scenarioId;
        shouldScrollRef.current = true;
        // 重挂载/重开 App 后接着练：只有「同场景 + 未过期 + 已经说过话」的草稿才恢复，
        // 否则照常从开场白开始（开场白本身是随机变体，不该被旧草稿固定住）。
        const resume = restorableDraft(draft, params.scenarioId, Date.now());
        restoredDraftRef.current = resume;
        if (resume) {
          setHistory(resume.history);
          setTurnIndex(resume.turnIndex ?? 0);
          setMode(resume.mode ?? 'feedback');
          setStartedAt(resume.startedAt);
          setPendingRetryText(resume.pendingText ?? '');
          setLimitReached(turnLimitReached(resume.turnIndex ?? 0, found.max_turns));
        } else {
          setPendingRetryText('');
          setLimitReached(false);
          setHistory([
            {
              id: newTurnId(),
              role: 'coach',
              content: found.opening_line,
              contentZh: found.opening_line_zh?.trim() || undefined,
              // 开场白也带上配套推荐语：第一句就要能照着说。
              nextLines: found.opening_next_lines ?? [],
            },
          ]);
        }
      }
      draftReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [lang, params.scenarioId]);

  useEffect(() => {
    void Promise.all([loadCoachPrefs(), getSpeechSettings()])
      .then(([prefs, speech]) => {
        setAutoPlay(prefs.autoPlay);
        setSttConfig({
          provider:
            speech.sttProvider === 'google-cloud'
              ? 'google-cloud'
              : speech.sttProvider === 'gemini'
                ? 'gemini'
                : 'system',
          apiKey: speech.geminiApiKey?.trim() || '',
          model:
            speech.sttProvider === 'google-cloud'
              ? speech.googleCloudSttModel?.trim() || 'chirp_3'
              : speech.geminiSttModel?.trim() || 'gemini-3.8-flash',
          serviceAccountJson: speech.googleCloudServiceAccountJson?.trim() || '',
          projectId: speech.googleCloudProjectId?.trim() || '',
          location: speech.googleCloudLocation?.trim() || 'us-central1',
          recognizer: speech.googleCloudRecognizer?.trim() || '_',
          languageCode: prefs.accentPreference,
        });
        // 恢复草稿时以草稿里的模式为准，别被默认模式覆盖。
        if (!params.interviewKind && !restoredDraftRef.current) setMode(prefs.defaultMode);
      })
      .catch(() => undefined);
  }, [params.interviewKind]);

  /**
   * 会话进度落盘：重挂载（开发期刷新）、App 被系统回收、误退出后都能接着练。
   * 只有说过话的会话才值得存 —— 仅开场白等于还没开始。
   */
  useEffect(() => {
    if (!scenario || !draftReadyRef.current || exitMode) return;
    const trailing = history.at(-1);
    const pendingText =
      pendingRetryText.trim() || (trailing?.role === 'user' ? trailing.content : '');
    if (!hasUserTurn(history) && !pendingText) return;
    void saveSessionDraft({
      scenarioId: scenario.id,
      history,
      pendingText: pendingText || undefined,
      turnIndex,
      mode,
      startedAt,
      savedAt: Date.now(),
    }).catch(() => undefined);
  }, [scenario, history, pendingRetryText, turnIndex, mode, startedAt, exitMode]);

  useEffect(() => {
    void getCoachQuota()
      .then((quota) => setQuotaRemaining(quota.remaining))
      .catch(() => setQuotaRemaining(undefined));
  }, []);

  useEffect(
    () => () => {
      turnGate.cancel();
      void stopRecording();
      sttRef.current?.abort();
      void stopSpeaking();
    },
    [stopRecording, turnGate]
  );

  useEffect(() => {
    if (session.state !== 'listening') setVolume(0);
  }, [session.state]);

  /**
   * 麦克风音量只驱动头像，但它是**高频**回调：原来直接 setVolume，等于每次采样都把
   * 整个会话页（含全部气泡）重渲染一遍，观感就是聊天列表"一闪一闪"。
   * 这里做量化 + 阈值过滤，把更新频率压到肉眼够用的档位。
   */
  const onVolumeSample = useCallback((value: number) => {
    const quantized = Math.round(value / 1.5) * 1.5;
    setVolume((prev) => (Math.abs(quantized - prev) < 1.5 ? prev : quantized));
  }, []);

  usePreventRemove(!!scenario && hasConversation && !exitMode, () => {
    setShowEnd(true);
  });

    // useCallback 不是装饰：消息列表是 memo 的，回调每次换新引用会把它整片击穿，
  // 又回到"点一下、整列重渲染"的老路。
  const play = useCallback(
    async (text: string) => {
      if (!scenario || !text.trim()) return;
      const settings = await getSpeechSettings();
      await speak(text, {
        language: scenario.persona.locale,
        voiceId:
          scenario.persona.locale === 'zh-CN'
            ? settings.speech_zh_voice
            : settings.speech_voice,
      });
    },
    [scenario]
  );

  const interview = (): InterviewContext | undefined => {
    if (!params.interviewKind || !params.profile) return undefined;
    const kind: InterviewKind | 'resume_job' =
      params.interviewKind === 'job' || params.interviewKind === 'resume_job'
        ? params.interviewKind
        : 'resume';
    return { kind, profile: params.profile };
  };

  const cancelActiveTurn = (restoreInput: boolean) => {
    const request = turnGate.cancel();
    if (!request) return null;
    const pendingId = pendingUserTurnIdRef.current;
    const pendingText = pendingUserTurnTextRef.current;
    pendingUserTurnIdRef.current = null;
    pendingUserTurnTextRef.current = '';
    if (pendingId) {
      setHistory(historyBeforeTurnRef.current);
    }
    if (restoreInput && pendingText) setInput(pendingText);
    return request;
  };

  const submit = async (override?: string) => {
    if (!scenario || limitReached || turnGate.active()) return;
    const text = (override ?? input).trim();
    if (!text) return;
    if (pendingRetryText && text !== pendingRetryText) return;
    sttRef.current?.stop();
    sttRef.current = null;
    setInput('');
    setTurnError(null);
    setPendingRetryText('');
    const matchedSuggestion = matchNextLine(text, latestNextLines(history));
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const id = newTurnId();
    const request = turnGate.begin();
    if (!request) return;
    pendingUserTurnIdRef.current = id;
    pendingUserTurnTextRef.current = text;
    historyBeforeTurnRef.current = history;
    dispatch({ type: 'USER_SUBMIT', id, text });
    const requestHistory = prepareHistoryForTurn(history, text);
    const nextHistory = appendHistory(requestHistory, {
      id,
      role: 'user',
      content: text,
      matchedSuggestion,
    });
    shouldScrollRef.current = true;
    setHistory(nextHistory);
    await stopSpeaking();

    try {
      const response = await postCoachTurn(
        {
          scenario,
          scenario_id: scenario.source === 'preset' ? scenario.id : undefined,
          history: wireHistory(requestHistory),
          user_text: text,
          completed_turns: turnIndex,
          coach_mode: mode,
          locale: lang,
          interview: interview(),
        },
        request.controller.signal
      );
      if (!turnGate.isCurrent(request)) return;
      const turnFeedback = mode === 'immersion' ? null : response.feedback ?? null;
      const nextLines = filterNextLines(
        response.next_lines ?? [],
        turnFeedback,
        response.reply
      );
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTurnIndex(response.turn_index);
      setLimitReached(response.limit_reached || turnLimitReached(response.turn_index, scenario.max_turns));
      shouldScrollRef.current = true;
      const tagged = nextHistory.map((turn, index) =>
        index === nextHistory.length - 1
          ? { ...turn, feedback: turnFeedback, matchedSuggestion }
          : turn
      );
      setHistory(
        appendHistory(tagged, {
          id: newTurnId(),
          role: 'coach',
          content: response.reply,
          contentZh: response.reply_zh?.trim() || undefined,
          // 推荐语跟着这条回复走：之后它在列表里变成旧卡时，仍能看到当时的建议。
          nextLines,
        })
      );
      dispatch({ type: 'TURN_SUCCESS', id });
      turnGate.finish(request);
      pendingUserTurnIdRef.current = null;
      pendingUserTurnTextRef.current = '';
      if (autoPlay) await play(response.reply);
      dispatch({ type: 'START_LISTENING' });
      dispatch({ type: 'STOP_LISTENING' });
      void getCoachQuota()
        .then((quota) => setQuotaRemaining(quota.remaining))
        .catch(() => undefined);
      if (response.limit_reached) setShowEnd(true);
    } catch (err) {
      if (!turnGate.isCurrent(request)) return;
      turnGate.finish(request);
      pendingUserTurnIdRef.current = null;
      pendingUserTurnTextRef.current = '';
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ApiError ? err.status : undefined;
      setTurnError({ message, status });
      setPendingRetryText(text);
      shouldScrollRef.current = true;
      setHistory(historyBeforeTurnRef.current);
      dispatch({ type: 'TURN_ERROR', id, message });
    }
  };

  const startCloudRecording = async () => {
    if (!scenario) return;
    const configured =
      sttConfig.provider === 'google-cloud'
        ? !!sttConfig.serviceAccountJson
        : !!sttConfig.apiKey;
    if (!configured) {
      toast(
        sttConfig.provider === 'google-cloud'
          ? t('googleCloudKeyMissing')
          : t('geminiKeyMissing')
      );
      setKeyboardOpen(true);
      return;
    }
    if (sttStartingRef.current || cloudRecordingRef.current || transcribing) return;
    if (turnGate.active()) {
      cancelActiveTurn(false);
      setTurnError(null);
      dispatch({ type: 'RESET' });
    }

    await stopSpeaking();
    const startSeq = sttStartSeqRef.current + 1;
    sttStartSeqRef.current = startSeq;
    sttStartingRef.current = true;
    setStartingMic(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMicPermissionDenied(true);
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
      await audioRecorder.prepareToRecordAsync(CLOUD_RECORDING_OPTIONS);
      recorderArmedRef.current = true;
      if (!mountedRef.current || startSeq !== sttStartSeqRef.current) {
        await stopRecording();
        return;
      }
      audioRecorder.record();
      cloudRecordingRef.current = true;
      dispatch({ type: 'START_LISTENING' });
    } catch (error) {
      console.warn('[coach-stt] cloud recording start failed', error);
      toast(t('coachMicError'));
    } finally {
      if (startSeq === sttStartSeqRef.current) {
        sttStartingRef.current = false;
        setStartingMic(false);
      }
    }
  };

  const stopCloudRecording = async (transcribe: boolean) => {
    if (!scenario || !cloudRecordingRef.current) return;
    const hints = scenarioSttHints(scenario);
    // 立刻置位：并发进来的第二次调用会在上面那行被判掉。
    cloudRecordingRef.current = false;
    const requestSeq = sttStartSeqRef.current;
    setTranscribing(transcribe);
    try {
      await stopRecording();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });
      if (!transcribe) {
        if (mountedRef.current) dispatch({ type: 'RESET' });
        return;
      }
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('recording-uri-missing');
      const recording = await readRecordingBase64(uri);
      const languageCode = sttLocaleFor(sttConfig.languageCode);
      const result =
        sttConfig.provider === 'google-cloud'
          ? await transcribeWithGoogleCloud(
              { ...recording, languageCode },
              {
                serviceAccountJson: sttConfig.serviceAccountJson,
                projectId: sttConfig.projectId,
                location: sttConfig.location,
                model: sttConfig.model,
                recognizer: sttConfig.recognizer,
              }
            )
          : await transcribeWithGemini(
              { ...recording, languageCode, hints },
              { apiKey: sttConfig.apiKey, model: sttConfig.model }
            );
      if (!mountedRef.current || requestSeq !== sttStartSeqRef.current) return;
      dispatch({ type: 'STOP_LISTENING' });
      await submit(result.text);
    } catch (error) {
      if (!mountedRef.current || requestSeq !== sttStartSeqRef.current) return;
      console.warn('[coach-stt] cloud transcription failed', error);
      toast(
        sttConfig.provider === 'google-cloud'
          ? t('cloudTranscriptionFailed')
          : t('geminiTranscriptionFailed')
      );
      dispatch({ type: 'RESET' });
    } finally {
      if (mountedRef.current) setTranscribing(false);
    }
  };

  const toggleCloudMic = async () => {
    if (sttStartingRef.current || transcribing) return;
    if (cloudRecordingRef.current) {
      await stopCloudRecording(true);
      return;
    }
    await startCloudRecording();
  };

  const toggleMic = async () => {
    if (!scenario || limitReached || startingMic || sttStartingRef.current) return;
    if (sttConfig.provider !== 'system') {
      await toggleCloudMic();
      return;
    }
    if (session.state === 'listening') {
      sttStartSeqRef.current += 1;
      sttRef.current?.stop();
      sttRef.current = null;
      dispatch({ type: 'STOP_LISTENING' });
      return;
    }
    if (turnGate.active()) {
      cancelActiveTurn(false);
      setTurnError(null);
      dispatch({ type: 'RESET' });
    }

    await stopSpeaking();
    const startSeq = sttStartSeqRef.current + 1;
    sttStartSeqRef.current = startSeq;
    sttStartingRef.current = true;
    setStartingMic(true);
    try {
      const nextSession = await startListening(
        sttLocaleFor(sttConfig.languageCode),
        {
          onInterim: (text) => setInput(text),
          onFinal: (text) => {
            setInput(text);
            sttRef.current = null;
            dispatch({ type: 'STOP_LISTENING' });
            void submit(text);
          },
          onVolume: onVolumeSample,
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
        },
        scenarioSttHints(scenario)
      );
      if (!mountedRef.current || startSeq !== sttStartSeqRef.current) {
        nextSession.abort();
        return;
      }
      sttRef.current = nextSession;
      dispatch({ type: 'START_LISTENING' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/denied|restricted/.test(message)) {
        setMicPermissionDenied(true);
      } else {
        console.warn('[coach-stt] start failed', message);
        toast(t('coachMicError'));
      }
    } finally {
      if (startSeq === sttStartSeqRef.current) {
        sttStartingRef.current = false;
        setStartingMic(false);
      }
    }
  };

  useEffect(() => {
    if (!exitMode || finishedRef.current) return;
    finishedRef.current = true;
    const pendingId = pendingUserTurnIdRef.current;
    turnGate.cancel();
    sttStartSeqRef.current += 1;
    sttStartingRef.current = false;
    void stopRecording();
    void stopSpeaking();
    sttRef.current?.abort();
    sttRef.current = null;
    const finalHistory = pendingId
      ? history.filter((turn) => turn.id !== pendingId)
      : history;
    void (async () => {
      // Wait for every queued save, then clear. Clearing first can lose a race
      // with an older save and resurrect an already-finished session.
      await clearSessionDraft().catch(() => undefined);
      if (!mountedRef.current) return;
      if (exitMode === 'discard') {
        router.replace('/(tabs)/coach');
        return;
      }
      router.replace({
        pathname: '/coach/summary',
        params: {
          scenarioId: scenario?.id ?? '',
          history: JSON.stringify(wireHistory(finalHistory)),
          startedAt: String(startedAt),
          interviewKind: params.interviewKind ?? '',
          profile: params.profile ?? '',
        },
      });
    })();
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
      sttStartSeqRef.current += 1;
      sttStartingRef.current = false;
      void stopRecording();
      sttRef.current?.abort();
      sttRef.current = null;
      setStartingMic(false);
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
    transcribing
      ? 'thinking'
      : session.state === 'listening'
      ? 'listening'
      : session.state === 'thinking'
        ? 'thinking'
        : session.state === 'speaking'
          ? 'speaking'
          : 'idle';
  const isInterview = !!params.interviewKind;
  // 逐轮反馈只存在于非面试 + 反馈模式；它同时管住消息内联的那张卡。
  const showFeedback = !isInterview && mode === 'feedback';
  const liveText =
    input.trim() ||
    (session.state === 'listening'
      ? t('coachListening')
      : session.pendingText && session.state === 'error'
        ? session.pendingText
        : '');
  const statusText =
    transcribing
      ? t('cloudTranscribing')
      : session.state === 'listening'
      ? t('coachListeningStatus')
      : session.state === 'thinking'
        ? t('coachThinkingStatus')
        : session.state === 'speaking'
          ? t('coachSpeakingStatus')
          : t('coachWaitingStatus');

  const stopAudio = () => {
    const cancelled = cancelActiveTurn(true);
    if (cancelled) {
      setTurnError(null);
      setPendingRetryText('');
    }
    void stopSpeaking();
    sttStartSeqRef.current += 1;
    sttStartingRef.current = false;
    void stopCloudRecording(false);
    sttRef.current?.abort();
    sttRef.current = null;
    setStartingMic(false);
    setTranscribing(false);
    setVolume(0);
    dispatch({ type: 'RESET' });
  };

  const openKeyboard = () => {
    sttStartSeqRef.current += 1;
    sttStartingRef.current = false;
    void stopCloudRecording(false);
    sttRef.current?.abort();
    sttRef.current = null;
    setStartingMic(false);
    dispatch({ type: 'STOP_LISTENING' });
    if (pendingRetryText) {
      setInput(pendingRetryText);
      setPendingRetryText('');
    }
    setKeyboardOpen(true);
  };

  if (micPermissionDenied) {
    return (
      <PermissionState
        onBack={requestExit}
        onSettings={() => void Linking.openSettings()}
        onKeyboard={() => {
          setMicPermissionDenied(false);
          openKeyboard();
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
              reduceMotion={reduceMotion}
            />
            <View style={styles.coachStripBody}>
              <Text style={[styles.coachName, { color: c.studyText }]}>
                {scenario.persona.name}
              </Text>
              <Text numberOfLines={1} style={[styles.coachRole, { color: c.studyMuted }]}>
                {scenario.persona.role} · {scenario.persona.locale}
              </Text>
            </View>
            <View style={styles.coachMeta}>
              <View style={styles.statusRow}>
                <View style={[styles.liveDot, { backgroundColor: c.accent }]} />
                <Text numberOfLines={1} style={{ color: c.studyMuted, fontSize: 10.5 }}>
                  {statusText}
                </Text>
              </View>
              {quotaRemaining !== undefined && quotaRemaining !== null ? (
                <Text numberOfLines={1} style={{ color: c.studyMuted, fontSize: 10.5 }}>
                  {t('coachToday')} {quotaRemaining}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.messages}>
            <Messages
              history={history}
              showFeedback={showFeedback}
              showNextLines={!isInterview}
              personaInitial={scenario.persona.name.slice(0, 1).toUpperCase()}
              onSpeakText={play}
            />

            {liveText && session.state === 'listening' ? (
              <View style={[styles.messageRow, styles.messageRowUser, styles.turnGap]}>
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

            {session.state === 'thinking' || transcribing ? (
              <View style={[styles.messageRow, styles.messageRowCoach, styles.turnGap]}>
                <View style={[styles.messageAvatar, { backgroundColor: c.accentLight }]}>
                  <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                    {scenario.persona.name.slice(0, 1).toUpperCase()}
                  </Text>
              </View>
              <View style={[styles.typingBubble, { backgroundColor: c.studyCard, borderColor: c.border }]}>
                <Text style={{ color: c.studyMuted, fontSize: 13 }}>
                  {transcribing ? t('cloudTranscribing') : t('coachThinking')}
                </Text>
                <ThinkingDots color={c.accent} reduceMotion={reduceMotion} />
              </View>
              </View>
            ) : null}
          </View>

          {turnError ? (
            <View style={[styles.errorCard, { backgroundColor: c.accentLight, borderLeftColor: c.accent }]}>
              <Text style={{ color: c.ink, fontWeight: '700' }}>
                {turnError.status === 429
                  ? t('coachQuotaReachedTitle')
                  : turnError.status === 400
                    ? t('coachRequestInvalidTitle')
                    : t('coachTurnFailedTitle')}
              </Text>
              <Text style={{ color: c.inkLight, lineHeight: 20, marginTop: 5 }}>
                {turnError.status === 429
                  ? t('coachQuotaReachedDesc')
                  : turnError.status === 400
                    ? t('coachRequestInvalidDesc')
                    : t('coachTurnFailedDesc')}
              </Text>
              {turnError.status !== 429 && turnError.status !== 400 ? (
                <Pressable
                  onPress={() => void submit(pendingRetryText || input)}
                  style={[styles.retryButton, { backgroundColor: c.accentLight }]}
                >
                  <Text style={{ color: c.accent, fontWeight: '700' }}>{t('coachRetry')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {pendingRetryText && !turnError ? (
            <View style={[styles.errorCard, { backgroundColor: c.tagBg, borderLeftColor: c.accent }]}>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{t('coachInterruptedTitle')}</Text>
              <Text style={{ color: c.inkLight, lineHeight: 20, marginTop: 5 }}>
                {t('coachInterruptedDesc')}
              </Text>
              <View style={[styles.recoveryBubble, { backgroundColor: c.studyCard, borderColor: c.border }]}>
                <Text style={{ color: c.studyText, fontSize: 13, lineHeight: 19 }}>
                  {pendingRetryText}
                </Text>
              </View>
              <View style={styles.recoveryActions}>
                <Pressable
                  onPress={() => void submit(pendingRetryText)}
                  style={[styles.retryButton, { backgroundColor: c.accentLight }]}
                >
                  <Text style={{ color: c.accent, fontWeight: '700' }}>{t('coachRetry')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setInput(pendingRetryText);
                    setPendingRetryText('');
                    setKeyboardOpen(true);
                  }}
                  style={styles.secondaryTextAction}
                >
                  <Text style={{ color: c.studyMuted, fontWeight: '600' }}>
                    {t('coachEditPending')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {limitReached ? (
            <View style={[styles.modeNote, { backgroundColor: c.tagBg }]}>
              <Text style={{ color: c.studyMuted, fontSize: 12, lineHeight: 18 }}>
                {t('coachTurnLimitReached')}
              </Text>
              <Pressable
                onPress={() => setShowEnd(true)}
                style={[styles.retryButton, { backgroundColor: c.accentLight }]}
              >
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t('coachFinishNow')}</Text>
              </Pressable>
            </View>
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
                  disabled={
                    !input.trim() ||
                    session.state === 'thinking' ||
                    limitReached ||
                    !!pendingRetryText
                  }
                  onPress={() => {
                    void submit();
                    setKeyboardOpen(false);
                  }}
                >
                  <Text
                    style={{
                      color:
                        input.trim() && !limitReached && !pendingRetryText
                          ? c.accent
                          : c.studyMuted,
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
                  onPress={openKeyboard}
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
                    disabled={limitReached || startingMic || transcribing || !!pendingRetryText}
                    onPress={() => void toggleMic()}
                    style={[
                      styles.mic,
                      {
                        backgroundColor:
                          limitReached || pendingRetryText ? c.tagBg : c.buttonBg,
                        opacity: startingMic || transcribing ? 0.6 : 1,
                      },
                    ]}
                  >
                    <CoachGlyph
                      name="mic"
                      color={limitReached || pendingRetryText ? c.studyMuted : c.buttonText}
                      size={26}
                    />
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
                {isInterview
                  ? t('coachInterviewEndHint')
                  : sttConfig.provider !== 'system'
                    ? t('cloudInfrastructureHint')
                    : t('coachVoiceControlHint')}
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
        cancelLabel={limitReached ? t('coachReviewSession') : undefined}
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
  scenarioTitle: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700' },
  topPills: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  headPill: { fontSize: 10.5, borderRadius: 999, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  endChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
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
  coachMeta: { maxWidth: 96, alignItems: 'flex-end', gap: 3 },
  // 行间距由每一行自己的 marginTop 控制（同组贴紧 / 换组留白），所以这里不用 gap。
  messages: { marginTop: 12 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  messageRowTop: { alignItems: 'flex-start' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowCoach: { justifyContent: 'flex-start' },
  sameRoleGap: { marginTop: 4 },
  turnGap: { marginTop: 12 },
  // 同一组里第二条起不画头像，但要缩进到与第一条气泡的左缘对齐（头像 28 + gap 7）。
  messageRowIndent: { paddingLeft: 35 },
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
  matchedSuggestion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
  },
  matchedSuggestionText: { flex: 1, minWidth: 0 },
  matchedSuggestionLabel: { fontSize: 10.5, fontWeight: '700', marginBottom: 3 },
  // 教练回复下方的中文翻译：比正文小一号、用弱化色，不抢英文原文。
  messageZh: { fontSize: 12, lineHeight: 18, marginTop: 4 },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkingDot: { width: 5, height: 5, borderRadius: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  errorCard: { marginTop: 10, borderLeftWidth: 3, borderRadius: 14, padding: 13 },
  retryButton: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10 },
  recoveryBubble: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10 },
  recoveryActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  secondaryTextAction: { alignSelf: 'flex-start', paddingVertical: 6, marginTop: 10 },
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
