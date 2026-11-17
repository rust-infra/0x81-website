/**
 * 同传字幕 Tab。底部导航的第二个 item（见 lib/navigation-contract.ts）。
 *
 * 两种输入源：
 *   - 演示：跑模拟流，验证改判回滚 / 断句提交 / 增量翻译的交互。
 *   - 麦克风：设备流式识别（expo-speech-recognition），每提交一句就调用
 *     后端 `/api/rehearse/interpret/translate` 翻译，译文异步补到该行。
 *
 * 设计对齐 rehearse 主题体系：只吃 theme token；强调色只给「进行中」的元素
 * （识别中行、REC 点、译文），结构性容器一律中性。已提交内容绝不再改写。
 */
import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Segmented from '../../components/Segmented';
import { CoachHeader, PrimaryButton, SecondaryButton } from '../../components/rehearse/CoachUi';
import { useI18n } from '../../lib/i18n';
import { tabBarClearance } from '../../lib/navigation-contract';
import {
  createTranslationQueue,
  interpretRollbackLength,
  normalizeInterpretNumbers,
  simulateInterpret,
  splitByNumbers,
  splitByTerms,
  stripCommittedPrefix,
  type InterpretEngine,
  type TranslationQueue,
} from '../../lib/rehearse-interpret';
import { translateInterpretText } from '../../lib/rehearse-api-runtime';
import { createMicSessionController, type MicSessionController } from '../../lib/rehearse-mic-session';
import { startListening, sttLocaleFor } from '../../lib/rehearse-stt';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';

type Source = 'demo' | 'mic';
type RunState = 'idle' | 'listening' | 'paused' | 'done';
const STT_LANGUAGES = ['en-US', 'en-GB', 'en-IN', 'en-AU'] as const;
type SttLanguage = (typeof STT_LANGUAGES)[number];

interface CaptionLine {
  id: number;
  src: string;
  tgt: string;
  terms: Record<string, string>;
  state: 'interim' | 'final' | 'translated';
  rolled: boolean;
  translateFailed?: boolean;
  translateSkipped?: boolean;
}

let nextLineId = 1;

/** 贸易场景的识别热词：只影响 ASR，不当作术语表使用。 */
const MIC_HINTS = [
  'FOB',
  'CIF',
  'EXW',
  'MOQ',
  'lead time',
  'tooling',
  'quotation',
  'sample',
  'deposit',
  'Incoterm',
];

export default function InterpretScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const c = theme.colors;

  const [source, setSource] = useState<Source>('demo');
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>('en-US');
  const [runState, setRunState] = useState<RunState>('idle');
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [rollbackCount, setRollbackCount] = useState(0);
  const [follow, setFollow] = useState(true);
  const [dual, setDual] = useState(true);
  const [avgLatency, setAvgLatency] = useState<number | null>(null);

  const linesRef = useRef<CaptionLine[]>([]);
  const stateRef = useRef<RunState>('idle');
  const mountedRef = useRef(true);

  // runState / source 的同步副本：STT 回调随时可能触发，等 effect 同步会慢一帧，
  // 慢这一帧就足以让 onEnd 在暂停后仍自动重启麦克风。
  const changeRunState = useCallback((next: RunState) => {
    stateRef.current = next;
    setRunState(next);
  }, []);
  const changeSource = useCallback((next: Source) => {
    setSource(next);
  }, []);

  const engineRef = useRef<InterpretEngine | null>(null);
  const micControllerRef = useRef<MicSessionController | null>(null);

  const liveIdRef = useRef<number | null>(null);
  const prevTailRef = useRef('');
  const committedPrefixRef = useRef('');
  const startedAtRef = useRef(new Map<number, number>());
  const latenciesRef = useRef<number[]>([]);

  const listRef = useRef<FlatList<CaptionLine>>(null);
  const rollbackAnim = useRef(new Animated.Value(0)).current;

  const translationQueueRef = useRef<TranslationQueue | null>(null);
  const translateErrorShownRef = useRef(false);
  const translateBacklogShownRef = useRef(false);
  const translateToastRef = useRef({ t, toast });

  useEffect(() => () => { mountedRef.current = false; }, []);

  const committedChars = useMemo(
    () => lines.filter((line) => line.state !== 'interim').reduce((n, line) => n + line.src.length, 0),
    [lines]
  );
  const committedSegs = useMemo(
    () => lines.filter((line) => line.state !== 'interim').length,
    [lines]
  );

  const flashRollback = useCallback(() => {
    rollbackAnim.setValue(1);
    Animated.timing(rollbackAnim, { toValue: 0, duration: 500, useNativeDriver: false }).start();
  }, [rollbackAnim]);

  /**
   * 同步维护 linesRef 再交给 setState。
   *
   * 模拟流的 final 与译文在同一个 tick 里先后到达；只靠 effect 同步 ref
   * 会让译文那边读到上一帧的行，匹配错位或丢失。这里把 ref 当作权威副本，
   * React 状态只负责渲染。
   */
  const updateLines = useCallback((updater: (prev: CaptionLine[]) => CaptionLine[]) => {
    const next = updater(linesRef.current);
    linesRef.current = next;
    setLines(next);
  }, []);

  const pushLatency = useCallback((id: number) => {
    const startedAt = startedAtRef.current.get(id);
    if (!startedAt) return;
    startedAtRef.current.delete(id);
    const samples = [...latenciesRef.current, (Date.now() - startedAt) / 1000].slice(-5);
    latenciesRef.current = samples;
    setAvgLatency(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  }, []);

  const applyTranslation = useCallback(
    (id: number, zh: string) => {
      updateLines((prev) =>
        prev.map((line) =>
          line.id === id
            ? {
                ...line,
                tgt: zh,
                state: 'translated',
                translateFailed: false,
                translateSkipped: false,
              }
            : line
        )
      );
      pushLatency(id);
    },
    [pushLatency, updateLines]
  );

  const markTranslateFailed = useCallback((id: number) => {
    updateLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, translateFailed: true } : line))
    );
    startedAtRef.current.delete(id);
  }, [updateLines]);

  const markTranslateSkipped = useCallback((id: number) => {
    updateLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, translateSkipped: true } : line))
    );
    startedAtRef.current.delete(id);
  }, [updateLines]);

  useEffect(() => {
    translateToastRef.current = { t, toast };
  }, [t, toast]);

  if (translationQueueRef.current == null) {
    translationQueueRef.current = createTranslationQueue({
      run: async (task, signal) =>
        (await translateInterpretText(task.text, signal)).translation,
      onResult: (id, translation) => applyTranslation(id, translation),
      onError: (id) => {
        markTranslateFailed(id);
        if (translateErrorShownRef.current) return;
        translateErrorShownRef.current = true;
        const { t: translate, toast: showToast } = translateToastRef.current;
        showToast(translate('interpretTranslateUnavailable'));
      },
      onOverflow: (id) => {
        markTranslateSkipped(id);
        if (translateBacklogShownRef.current) return;
        translateBacklogShownRef.current = true;
        const { t: translate, toast: showToast } = translateToastRef.current;
        showToast(translate('interpretTranslateBacklog'));
      },
    });
  }

  const enqueueTranslation = useCallback((id: number, text: string) => {
    translationQueueRef.current?.push({ id, text });
  }, []);

  /** 去掉本段里已经提交过的句子，interim 行只显示还没冻结的部分。 */
  const visibleInterim = (text: string) => stripCommittedPrefix(text, committedPrefixRef.current);

  const upsertInterim = useCallback(
    (text: string, terms: Record<string, string>) => {
      const tail = text;
      const rolled = interpretRollbackLength(prevTailRef.current, tail) >= 3;
      prevTailRef.current = tail;
      if (rolled) {
        setRollbackCount((n) => n + 1);
        flashRollback();
      }

      updateLines((prev) => {
        const next = [...prev];
        const liveId = liveIdRef.current;
        const index = next.findIndex((line) => line.id === liveId);
        const id = liveId ?? nextLineId++;
        if (liveId == null) {
          startedAtRef.current.set(id, Date.now());
          liveIdRef.current = id;
        }
        const line: CaptionLine = {
          id,
          src: text,
          tgt: index >= 0 ? next[index].tgt : '',
          terms,
          state: 'interim',
          rolled,
        };
        if (index >= 0) next[index] = line;
        else next.push(line);
        return next;
      });
    },
    [flashRollback, updateLines]
  );

  const commitFinal = useCallback(
    (text: string, terms: Record<string, string> | undefined, translate: boolean) => {
      prevTailRef.current = '';
      const prefix = committedPrefixRef.current;
      committedPrefixRef.current = prefix ? `${prefix} ${text}` : text;
      const liveId = liveIdRef.current;
      const committedId = liveId ?? nextLineId++;
      if (liveId == null) startedAtRef.current.set(committedId, Date.now());
      liveIdRef.current = null;
      updateLines((prev) => {
        const next = [...prev];
        const index = next.findIndex((line) => line.id === liveId);
        if (index >= 0) {
          next[index] = {
            ...next[index],
            src: text,
            // 术语表来自这一段的 interim；提交时不传就沿用，别把 Chip 擦掉。
            terms: terms ?? next[index].terms,
            state: 'final',
            rolled: false,
          };
        } else {
          next.push({
            id: committedId,
            src: text,
            tgt: '',
            terms: terms ?? {},
            state: 'final',
            rolled: false,
          });
        }
        return next;
      });
      if (translate) enqueueTranslation(committedId, text);
    },
    [enqueueTranslation, updateLines]
  );

  // ---- 演示模式：模拟流自带译文 ----
  const onDemoInterim = useCallback(
    ({ text, terms }: { text: string; terms: Record<string, string> }) => {
      const visible = visibleInterim(text);
      if (visible) upsertInterim(visible, terms);
    },
    [upsertInterim]
  );

  const onDemoFinal = useCallback(
    ({ text }: { text: string }) => {
      commitFinal(text, undefined, false);
    },
    [commitFinal]
  );

  const onDemoTranslate = useCallback(
    ({ zh, en }: { zh: string; en: string }) => {
      // 按原文匹配，不能按「最后一条未翻译行」——final 与译文在同一 tick
      // 到达时 linesRef 还没刷新，顺序匹配会整体错位一行。
      const target = [...linesRef.current]
        .reverse()
        .find(
          (line) =>
            line.state === 'final' &&
            !line.tgt &&
            !line.translateFailed &&
            normalizeInterpretNumbers(line.src) === en
        );
      if (target) applyTranslation(target.id, zh);
    },
    [applyTranslation]
  );

  const onDemoState = useCallback((next: 'listening' | 'paused' | 'done') => {
    if (!mountedRef.current) return;
    changeRunState(next);
  }, [changeRunState]);

  // ---- 麦克风模式 ----
  const handleMicInterim = useCallback(
    (text: string) => {
      const visible = visibleInterim(text.trim());
      if (visible) upsertInterim(visible, {});
    },
    [upsertInterim]
  );

  const handleMicFinal = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) commitFinal(trimmed, {}, true);
    },
    [commitFinal]
  );

  if (micControllerRef.current == null) {
    micControllerRef.current = createMicSessionController({
      start: (locale, callbacks) =>
        startListening(
          sttLocaleFor(locale),
          { ...callbacks, onVolume: () => {} },
          MIC_HINTS,
          { continuous: true }
        ),
      onInterim: handleMicInterim,
      onFinal: handleMicFinal,
      onError: (kind) => {
        changeRunState('idle');
        const { t: translate, toast: showToast } = translateToastRef.current;
        showToast(
          kind === 'denied' ? translate('interpretMicDenied') : translate('interpretMicUnsupported')
        );
      },
    });
  }

  const changeSttLanguage = useCallback((next: SttLanguage) => {
    setSttLanguage(next);
    micControllerRef.current?.setLocale(next);
  }, []);

  const resetSession = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    micControllerRef.current?.stop();
    updateLines(() => []);
    setRollbackCount(0);
    setAvgLatency(null);
    latenciesRef.current = [];
    liveIdRef.current = null;
    prevTailRef.current = '';
    committedPrefixRef.current = '';
    startedAtRef.current.clear();
    translationQueueRef.current?.clear();
    translateErrorShownRef.current = false;
    translateBacklogShownRef.current = false;
  }, [updateLines]);

  const start = useCallback(() => {
    resetSession();
    changeRunState('listening');
    if (source === 'demo') {
      const engine = simulateInterpret({
        speed: 1,
        onAsrInterim: onDemoInterim,
        onAsrFinal: onDemoFinal,
        onTranslate: onDemoTranslate,
        onState: onDemoState,
      });
      engineRef.current = engine;
      engine.start();
    } else {
      micControllerRef.current?.start();
    }
  }, [changeRunState, onDemoFinal, onDemoInterim, onDemoState, onDemoTranslate, resetSession, source]);

  const pause = useCallback(() => {
    if (runState !== 'listening') return;
    changeRunState('paused');
    if (source === 'demo') engineRef.current?.pause();
    else micControllerRef.current?.pause();
  }, [changeRunState, runState, source]);

  const resume = useCallback(() => {
    if (runState !== 'paused') return;
    changeRunState('listening');
    if (source === 'demo') engineRef.current?.resume();
    else micControllerRef.current?.resume();
  }, [changeRunState, runState, source]);

  const stop = useCallback(() => {
    // 先落状态再停流：onEnd 若同步派发，会看到还是 listening 而自动重启。
    changeRunState('done');
    engineRef.current?.stop();
    engineRef.current = null;
    micControllerRef.current?.stop();
  }, [changeRunState]);

  const switchSource = useCallback(
    (next: Source) => {
      if (next === source) return;
      engineRef.current?.stop();
      engineRef.current = null;
      micControllerRef.current?.stop();
      changeSource(next);
      resetSession();
      changeRunState('idle');
    },
    [changeRunState, changeSource, resetSession, source]
  );

  // 切走 Tab 必须停：Tab 屏不会卸载，麦克风不停就是后台一直录音；
  // 演示流不停则用户回来时会发现字幕已经跑完了。
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (stateRef.current !== 'listening') return;
        engineRef.current?.pause();
        micControllerRef.current?.pause();
        changeRunState('paused');
      };
    }, [changeRunState])
  );

  useEffect(() => () => {
    engineRef.current?.stop();
    micControllerRef.current?.stop();
  }, []);

  const scrollToLatest = useCallback(() => {
    if (!follow) return;
    // 最后一行刚更新时内容高度还在布局，下一帧再滚才能落到真正的底部。
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [follow]);

  useEffect(() => {
    scrollToLatest();
  }, [scrollToLatest]);

  const share = async () => {
    const text = linesRef.current
      .filter((line) => line.state !== 'interim')
      .map((line) => (dual && line.tgt ? `${line.src}\n${line.tgt}` : line.src))
      .join('\n\n');
    if (!text) return;
    try {
      await Share.share({ message: text, title: t('tabInterpret') });
    } catch {
      toast(t('interpretShareFailed'));
    }
  };

  const stateLabel =
    runState === 'listening'
      ? t('interpretListening')
      : runState === 'paused'
        ? t('interpretPaused')
        : runState === 'done'
          ? t('interpretDone')
          : '';

  const sourceOptions = [
    { key: 'demo' as const, label: t('interpretSourceDemo') },
    { key: 'mic' as const, label: t('interpretSourceMic') },
  ];
  const accentOptions = STT_LANGUAGES.map((code) => ({ key: code, label: code }));

  return (
    <SafeAreaView
      style={[
        styles.screen,
        {
          backgroundColor: c.paper,
          paddingBottom: tabBarClearance(insets.bottom),
        },
      ]}
      edges={['top']}
    >
      <CoachHeader
        title={t('tabInterpret')}
        right={
          <View style={styles.statePill}>
            <View
              style={[
                styles.recDot,
                {
                  backgroundColor:
                    runState === 'listening' ? c.accent : runState === 'paused' ? c.inkMuted : c.border,
                },
              ]}
            />
            {stateLabel ? (
              <Text style={[styles.stateText, { color: runState === 'listening' ? c.accent : c.inkMuted }]}>
                {stateLabel}
              </Text>
            ) : null}
          </View>
        }
      />

      <View style={styles.sourceRow}>
        <Segmented options={sourceOptions} value={source} onChange={switchSource} style={styles.sourceSeg} />
      </View>
      {source === 'mic' ? (
        <View style={styles.accentRow}>
          <Text style={[styles.accentLabel, { color: c.inkMuted }]}>{t('interpretAccent')}</Text>
          <Segmented
            options={accentOptions}
            value={sttLanguage}
            onChange={changeSttLanguage}
            style={styles.accentSeg}
          />
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        data={lines}
        keyExtractor={(line) => String(line.id)}
        extraData={dual}
        renderItem={({ item }) => (
          <CaptionLineView
            line={item}
            dual={dual}
            rollbackAnim={item.rolled ? rollbackAnim : undefined}
          />
        )}
        ItemSeparatorComponent={CaptionSeparator}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: c.inkLight }]}>{t('interpretEmpty')}</Text>
            <Text style={[styles.emptyHint, { color: c.inkMuted }]}>{t('interpretEmptyHint')}</Text>
          </View>
        }
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onContentSizeChange={scrollToLatest}
      />

      <View style={[styles.footer, { borderTopColor: c.divider, backgroundColor: c.card }]}>
        <View style={styles.stats}>
          <Stat label={t('interpretLatency')} value={avgLatency != null ? `${avgLatency.toFixed(1)}s` : '—'} />
          <Stat label={t('interpretChars')} value={String(committedChars)} />
          <Stat label={t('interpretRollbacks')} value={String(rollbackCount)} />
          <Stat label={t('interpretSegments')} value={String(committedSegs)} />
        </View>
        <View style={styles.toggles}>
          <Toggle label={t('interpretFollowScroll')} value={follow} onChange={setFollow} />
          <Toggle label={t('interpretDual')} value={dual} onChange={setDual} />
        </View>
        <View style={styles.actions}>
          {runState === 'idle' || runState === 'done' ? (
            <View style={styles.actionItem}>
              <PrimaryButton
                label={runState === 'done' ? t('interpretRestart') : t('interpretStart')}
                onPress={start}
                variant="accent"
              />
            </View>
          ) : (
            <View style={styles.actionItem}>
              <PrimaryButton
                label={runState === 'paused' ? t('interpretResume') : t('interpretPause')}
                onPress={runState === 'paused' ? resume : pause}
              />
            </View>
          )}
          <View style={styles.actionItem}>
            {runState === 'listening' || runState === 'paused' ? (
              <SecondaryButton label={t('interpretStop')} onPress={stop} />
            ) : (
              <SecondaryButton label={t('interpretCopy')} onPress={() => void share()} />
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: c.inkMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: c.ink }]}>{value}</Text>
    </View>
  );
}

function CaptionSeparator() {
  return <View style={styles.separator} />;
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.toggle}>
      <Text style={[styles.toggleLabel, { color: c.inkMuted }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: c.border, true: c.accentLight }}
        thumbColor={value ? c.accent : c.inkMuted}
      />
    </View>
  );
}

/** 一条字幕行：原文（术语 Chip + 数字锁定）+ 译文。 */
const CaptionLineView = memo(function CaptionLineView({
  line,
  dual,
  rollbackAnim,
}: {
  line: CaptionLine;
  dual: boolean;
  rollbackAnim?: Animated.Value;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const isInterim = line.state === 'interim';
  const srcParts = splitByTerms(normalizeInterpretNumbers(line.src), line.terms);

  const rollbackBg =
    rollbackAnim &&
    rollbackAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['transparent', c.accentLight],
    });

  return (
    <Animated.View
      style={[
        styles.line,
        {
          backgroundColor: isInterim ? c.accentLight : c.card,
          borderColor: isInterim ? c.accent : c.border,
          borderLeftWidth: isInterim ? 1 : 3,
          borderLeftColor: isInterim ? c.accent : c.progressBar,
        },
        rollbackBg ? { backgroundColor: rollbackBg as unknown as string } : null,
      ]}
    >
      <Text style={[styles.src, { color: isInterim ? c.inkMuted : c.studyText }]}>
        {isInterim ? <Text style={[styles.caret, { color: c.accent }]}>▍</Text> : null}{srcParts.map((part, index) =>
          part.term ? (
            <Text key={index}>
              <Text style={[styles.term, { color: c.accent, borderColor: c.accent }]}>{part.text}</Text>
              {part.gloss ? (
                <Text style={[styles.gloss, { color: c.inkMuted, backgroundColor: c.tagBg }]}>
                  {' '}
                  {part.gloss}
                </Text>
              ) : null}
            </Text>
          ) : (
            splitByNumbers(part.text).map((chunk, chunkIndex) =>
              chunk.num ? (
                <Text
                  key={`${index}-${chunkIndex}`}
                  style={[styles.num, { color: c.ink, backgroundColor: c.tagBg }]}
                >
                  {chunk.text}
                </Text>
              ) : (
                <Text key={`${index}-${chunkIndex}`}>{chunk.text}</Text>
              )
            )
          )
        )}
      </Text>
      {dual ? (
        <Text style={[styles.tgt, { color: c.accent }]}>
          {line.tgt}
          {line.state === 'final' && !line.tgt && !line.translateFailed && !line.translateSkipped ? (
            <Text style={{ color: c.inkMuted, fontSize: 12 }}> …</Text>
          ) : null}
          {line.translateFailed ? (
            <Text style={{ color: c.inkMuted, fontSize: 12 }}> {t('interpretTranslateFailed')}</Text>
          ) : null}
          {line.translateSkipped ? (
            <Text style={{ color: c.inkMuted, fontSize: 12 }}> {t('interpretTranslateSkipped')}</Text>
          ) : null}
        </Text>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  stateText: { fontSize: 12.5, fontWeight: '600' },
  sourceRow: { paddingHorizontal: 20, paddingBottom: 10 },
  sourceSeg: { alignSelf: 'flex-start', minWidth: 180 },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  accentLabel: { fontSize: 12 },
  accentSeg: { flex: 1 },
  feed: { flex: 1 },
  feedContent: { padding: 16, paddingBottom: 24 },
  separator: { height: 12 },
  empty: { paddingTop: 72, alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  emptyHint: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  line: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  src: { fontSize: 17, fontWeight: '600', lineHeight: 26, letterSpacing: 0.2 },
  caret: { fontSize: 15, marginRight: 2 },
  tgt: { marginTop: 6, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  term: { fontWeight: '700', borderBottomWidth: 1, borderStyle: 'dashed' },
  gloss: { fontSize: 11.5, borderRadius: 4, overflow: 'hidden' },
  num: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontWeight: '700',
    borderRadius: 4,
    overflow: 'hidden',
  },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 1 },
  statLabel: { fontSize: 10.5 },
  statValue: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  toggles: { flexDirection: 'row', gap: 20 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontSize: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  actionItem: { flex: 1 },
});
