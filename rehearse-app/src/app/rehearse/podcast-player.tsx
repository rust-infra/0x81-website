import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type {
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Polygon, Rect } from 'react-native-svg';
import { CoachHeader } from '../../components/rehearse/CoachUi';
import { PodcastFoxAvatar } from '../../components/rehearse/PodcastFoxAvatar';
import { PodcastLearnerAvatar } from '../../components/rehearse/PodcastLearnerAvatar';
import { PodcastSettingsSheet } from '../../components/rehearse/PodcastSettingsSheet';
import { useAuth } from '../../lib/auth';
import { bundledEpisodeTranslations } from '../../data/podcast-translations';
import { getApiBase } from '../../lib/config';
import {
  buildPodcastEpisodes,
  createPodcastPlayer,
  episodeMinutes,
  estimateWordRange,
  splitEpisodeTitle,
  type WordRange,
  type PodcastPlayer,
  type PodcastState,
} from '../../lib/podcast';
import {
  loadPodcastPoster,
  resolvePodcastClipSource,
  type PodcastClipSource,
} from '../../lib/podcast-video';
import { loadPodcastProgress, savePodcastProgress } from '../../lib/podcast-progress';
import {
  episodeSourceLines,
  episodeSpeakers,
  podcastSourceHash,
} from '../../lib/podcast-source-hash';
import {
  generatePodcastTranslations,
  getPodcastTranslations,
  requestPodcastClip,
} from '../../lib/rehearse-api-runtime';
import {
  getSpeechSettings,
  pickPodcastVoice,
  speak,
  stopSpeaking,
} from '../../lib/speech';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

// 服务端返回整集译文（按 turn_index 对齐），这里转成「集 id + 序号」的
// 查找表：渲染时每个气泡只查自己的键，不依赖数组下标一致。
function indexTranslations(
  items: Array<{ turn_index: number; translation: string }>,
  episodeID: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    if (item.translation) out[`${episodeID}:${item.turn_index}`] = item.translation;
  }
  return out;
}

const QUICK_SPEEDS = [0.75, 1, 1.25, 1.5] as const;

function nextPlaybackSpeed(rate: number): number {
  const index = QUICK_SPEEDS.findIndex((value) => Math.abs(value - rate) < 0.01);
  return QUICK_SPEEDS[(index + 1) % QUICK_SPEEDS.length]!;
}

function formatPlaybackSpeed(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}×`;
}

export default function PodcastPlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    scenarioId?: string;
    deck?: string;
    turn?: string;
  }>();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { token } = useAuth();
  const { height } = useWindowDimensions();
  const c = theme.colors;
  const tRef = useRef(t);
  tRef.current = t;
  const deck = params.deck || '第一册';
  const episodes = useMemo(() => buildPodcastEpisodes(deck), [deck]);
  const initialIndex = Math.max(
    0,
    episodes.findIndex((episode) => episode.id === params.scenarioId)
  );
  const requestedTurn = Math.max(0, Number.parseInt(params.turn ?? '0', 10) || 0);
  const initialTurn = Math.min(
    requestedTurn,
    Math.max(0, (episodes[initialIndex]?.turns.length ?? 1) - 1)
  );
  const initialIndexRef = useRef(initialIndex);
  const initialTurnRef = useRef(initialTurn);
  const [stageOpen, setStageOpen] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posterUri, setPosterUri] = useState<string | null>(null);
  const posterSource = posterUri ? { uri: posterUri } : null;
  const videoDoneRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const videoStartedRef = useRef(false);
  const pendingStartRef = useRef<(() => void) | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoPlayer = useVideoPlayer(null, (player) => {
    player.loop = false;
    player.timeUpdateEventInterval = 0.1;
  });
  const [playback, setPlayback] = useState<PodcastState>({
    episodeIndex: initialIndex,
    turnIndex: initialTurn,
    playing: false,
    finished: false,
    rate: 1,
    autoplay: true,
    pauseEachLine: false,
    loopLine: false,
  });
  const [transportVisible, setTransportVisible] = useState(!playback.autoplay);
  // 用户手动收起/展开过播放条之后，自动连播不再收回它：自动隐藏与用户的
  // 显式选择冲突时用户赢。`manualPinned` 只表达「暂停时保持展开」，
  // 用它兼管手动收起会让两种意图互相覆盖。
  const [transportPinned, setTransportPinned] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  // 这一集的译文还没生成（库里没有）。播放器只显示状态，绝不实时补翻。
  const [translationMissing, setTranslationMissing] = useState(false);
  const [translatingEpisode, setTranslatingEpisode] = useState(false);
  const [manualPinned, setManualPinned] = useState(false);
  const [following, setFollowing] = useState(true);
  const [progressWidth, setProgressWidth] = useState(0);
  const progressRef = useRef<View>(null);
  const [wordRange, setWordRange] = useState<
    (WordRange & { turnIndex: number }) | null
  >(null);
  const playerRef = useRef<PodcastPlayer | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const turnLayoutRef = useRef<Record<number, { y: number; height: number }>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const activeTextRef = useRef<{ turnIndex: number; text: string } | null>(null);
  const startedRef = useRef(false);
  const autoScrollUntilRef = useRef(0);
  const hasAutoScrolledRef = useRef(false);
  const lastOffsetRef = useRef(0);
  const autoScrollTargetRef = useRef<number | null>(null);
  const autoScrollSettledRef = useRef(true);
  const lastUrlKeyRef = useRef('');
  const transportAnim = useRef(new Animated.Value(transportVisible ? 1 : 0)).current;
  // 演播室卡片展开/收起的进度。条件渲染（`stageOpen ? ... : ...`）会在
  // 一帧内换掉整棵子树，没有过渡；改成两条各自淡入淡出的同时，卡片高度
  // 也跟着缓动，看起来才是「展开」而不是「跳变」。
  const stageAnim = useRef(new Animated.Value(stageOpen ? 1 : 0)).current;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let successes = 0;
    loadPodcastPoster(token, getApiBase())
      .then((uri) => {
        if (!cancelled) setPosterUri(uri);
      })
      .catch(() => {
        // 海报只是遮住视频空帧，取不到就退回线条头像。
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    AsyncStorage.getItem('podcast_translation_enabled')
      .then((value) => {
        if (value === '0') setTranslationEnabled(false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('podcast_autoplay'),
      AsyncStorage.getItem('podcast_rate'),
      AsyncStorage.getItem('podcast_pause_each_line'),
      AsyncStorage.getItem('podcast_loop_line'),
    ])
      .then(([autoplay, rate, pauseEachLine, loopLine]) => {
        if (loopLine === '1') {
          playerRef.current?.setLoopLine(true);
          AsyncStorage.multiSet([
            ['podcast_pause_each_line', '0'],
            ['podcast_autoplay', '0'],
          ]).catch(() => {});
        } else if (pauseEachLine === '1') {
          playerRef.current?.setPauseEachLine(true);
          AsyncStorage.multiSet([
            ['podcast_loop_line', '0'],
            ['podcast_autoplay', '0'],
          ]).catch(() => {});
        } else if (autoplay === '0') {
          playerRef.current?.setAutoplay(false);
        }
        const value = Number(rate);
        if (
          rate &&
          Number.isFinite(value) &&
          value >= 0.5 &&
          value <= 2
        ) {
          playerRef.current?.setRate(value);
        }
      })
      .catch(() => {});
  }, []);

  const clearStartTimer = () => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/rehearse/podcast');
  };

  const finishVideo = (error?: Error, keepVisible = false) => {
    clearStartTimer();
    pendingStartRef.current = null;
    videoStartedRef.current = false;
    const pending = videoDoneRef.current;
    videoDoneRef.current = null;
    if (!keepVisible) setVideoActive(false);
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve();
  };

  const playVideo = (source: PodcastClipSource, rate: number) =>
    new Promise<void>((resolve, reject) => {
      void stopSpeaking();
      clearStartTimer();
      videoStartedRef.current = false;
      pendingStartRef.current = null;
      videoDoneRef.current = { resolve, reject };
      setVideoActive(false);
      try {
        pendingStartRef.current = () => {
          if (!videoDoneRef.current) return;
          clearStartTimer();
          videoStartedRef.current = true;
          try {
            videoPlayer.play();
          } catch (error) {
            finishVideo(error instanceof Error ? error : new Error('video failed'));
          }
        };
        videoPlayer.pause();
        void videoPlayer.replaceAsync(source).catch((error) => {
          finishVideo(error instanceof Error ? error : new Error('video failed'));
        });
        videoPlayer.playbackRate = rate;
        startTimerRef.current = setTimeout(() => {
          if (!videoStartedRef.current) {
            finishVideo(new Error('video load timeout'));
          }
        }, 10000);
      } catch (error) {
        finishVideo(error instanceof Error ? error : new Error('video failed'));
      }
    });

  const stopPlayback = async () => {
    try {
      videoPlayer.pause();
    } catch {
      // 页面卸载时原生播放器可能已经释放，不再需要暂停。
    }
    finishVideo();
    activeTextRef.current = null;
    setWordRange(null);
    await stopSpeaking();
  };

  const playTurn = async (
    text: string,
    opts: { rate: number; language?: string; role?: 'coach' | 'user' }
  ) => {
    const turnIndex = playerRef.current?.state().turnIndex ?? 0;
    activeTextRef.current = { turnIndex, text };
    setWordRange(null);
    if (token) {
      try {
        const clip = await requestPodcastClip(text, { enqueue: false });
        const source = resolvePodcastClipSource(clip, token, getApiBase());
        if (source) {
          await playVideo(source, opts.rate);
          return;
        }
      } catch {
        // 片段服务不可用时继续用 TTS，播客本身不能因此停掉。
      }
    }
    try {
      videoPlayer.pause();
    } catch {
      // 播放器已释放时直接走 TTS。
    }
    setVideoActive(false);
    const settings = await getSpeechSettings();
    const isZh = /[\u4e00-\u9fff]/.test(text);
    const voiceId = isZh
      ? settings.speech_zh_voice
      : await pickPodcastVoice(opts.role ?? 'coach', settings);
    await speak(text, {
      ...opts,
      voiceId,
      onBoundary: (event) =>
        setWordRange({
          turnIndex,
          start: event.charIndex,
          length: event.charLength,
        }),
    });
  };

  const handlersRef = useRef({ playTurn, stopPlayback });
  handlersRef.current = { playTurn, stopPlayback };

  if (!playerRef.current) {
    playerRef.current = createPodcastPlayer({
      episodes,
      speak: (text, opts) => handlersRef.current.playTurn(text, opts),
      stop: () => handlersRef.current.stopPlayback(),
      onState: setPlayback,
      onError: () => {
        toastRef.current(tRef.current('podcastAudioUnavailable'));
      },
      initialRate: 1,
    });
  }

  useEffect(() => {
    const onEnd = videoPlayer.addListener('playToEnd', () => {
      if (!videoStartedRef.current) return;
      finishVideo();
    });
    const onStatus = videoPlayer.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        const start = pendingStartRef.current;
        pendingStartRef.current = null;
        start?.();
        return;
      }
      if (status !== 'error') return;
      finishVideo(new Error(error?.message || 'video failed'));
    });
    const onTime = videoPlayer.addListener('timeUpdate', () => {
      if (!videoStartedRef.current) return;
      const active = activeTextRef.current;
      const duration = videoPlayer.duration;
      if (!active || duration <= 0) return;
      const range = estimateWordRange(active.text, videoPlayer.currentTime / duration);
      if (range) setWordRange({ turnIndex: active.turnIndex, ...range });
    });
    return () => {
      onEnd.remove();
      onStatus.remove();
      onTime.remove();
      clearStartTimer();
    };
  }, [videoPlayer]);

  useEffect(() => {
    try {
      videoPlayer.playbackRate = playback.rate;
    } catch {
      // 播放器已释放时忽略。
    }
  }, [playback.rate, videoPlayer]);

  useEffect(() => {
    if (playback.playing) startedRef.current = true;
    if (!playback.playing) {
      if (startedRef.current) setTransportVisible(true);
      return;
    }
    if (transportPinned) return;
    if (playback.autoplay && !manualPinned) setTransportVisible(false);
    else setTransportVisible(true);
  }, [playback.playing, playback.autoplay, manualPinned, transportPinned]);

  useEffect(() => {
    Animated.timing(transportAnim, {
      toValue: transportVisible ? 1 : 0,
      duration: 280,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: false,
    }).start();
  }, [transportAnim, transportVisible]);

  useEffect(() => {
    Animated.timing(stageAnim, {
      toValue: stageOpen ? 1 : 0,
      duration: stageOpen ? 360 : 240,
      easing: stageOpen
        ? Easing.bezier(0.22, 1, 0.36, 1)
        : Easing.bezier(0.4, 0, 1, 1),
      useNativeDriver: false,
    }).start();
  }, [stageAnim, stageOpen]);

  useEffect(() => {
    setWordRange(null);
  }, [playback.turnIndex, playback.episodeIndex]);

  const scrollToActiveTurn = useCallback(
    (animated = true) => {
      const layout = turnLayoutRef.current[playback.turnIndex];
      if (!layout || viewportHeight <= 0) return;
      const target = Math.max(
        0,
        layout.y + layout.height / 2 - viewportHeight / 2
      );
      const distance = Math.abs(target - lastOffsetRef.current);
      autoScrollUntilRef.current =
        Date.now() + Math.min(2400, 500 + distance * 0.3);
      autoScrollTargetRef.current = target;
      autoScrollSettledRef.current = distance < 6;
      scrollRef.current?.scrollTo({ y: target, animated });
      hasAutoScrolledRef.current = true;
    },
    [playback.turnIndex, viewportHeight]
  );

  useEffect(() => {
    if (!following) return;
    const timer = setTimeout(
      () => scrollToActiveTurn(hasAutoScrolledRef.current),
      220
    );
    return () => clearTimeout(timer);
  }, [
    playback.turnIndex,
    playback.episodeIndex,
    following,
    layoutTick,
    viewportHeight,
    stageOpen,
    scrollToActiveTurn,
  ]);

  useEffect(() => {
    // 连播进入下一集时重新跟随；用户手动翻看旧内容时不抢滚动。
    setFollowing(true);
    hasAutoScrolledRef.current = false;
  }, [playback.episodeIndex]);

  useEffect(() => {
    if (!playback.playing && !startedRef.current) return;
    const episode = episodes[playback.episodeIndex];
    if (!episode) return;
    savePodcastProgress(deck, {
      episodeId: episode.id,
      episodeIndex: playback.episodeIndex,
      turnIndex: playback.finished ? 0 : playback.turnIndex,
    }).catch(() => {});
  }, [
    deck,
    episodes,
    playback.finished,
    playback.episodeIndex,
    playback.turnIndex,
    playback.playing,
  ]);

  const handleTurnLayout = useCallback((index: number, y: number, height: number) => {
    turnLayoutRef.current[index] = { y, height };
    setLayoutTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || episodes.length === 0) return;
    if (initialTurnRef.current > 0) {
      player.seek(initialIndexRef.current, initialTurnRef.current);
      player.play();
    } else {
      player.play(initialIndexRef.current);
    }
    return () => {
      player.pause();
      void stopSpeaking();
    };
  }, [episodes.length]);

  const episode = episodes[playback.episodeIndex];
  const titleParts = splitEpisodeTitle(episode?.title ?? '—');
  const anchorName = t('podcastAnchorName');
  const progress =
    episode && episode.turns.length > 0
      ? (playback.turnIndex + 1) / episode.turns.length
      : 0;
  const atEpisodeEnd = playback.finished;
  const activeTurn = episode?.turns[playback.turnIndex];
  const activeTranslation =
    translationEnabled && episode
      ? translations[`${episode.id}:${playback.turnIndex}`]
      : undefined;

  useEffect(() => {
    if (!episode) return;
    const key = `${episode.id}:${playback.turnIndex}`;
    if (lastUrlKeyRef.current === key) return;
    lastUrlKeyRef.current = key;
    router.setParams({
      scenarioId: episode.id,
      turn: String(playback.turnIndex),
    });
  }, [episode, playback.turnIndex, router]);

  // 译文只在进入某一集时从服务端读一次。**播放期间绝不调 LLM**：
  // 台词是固定的课程数据，译文由预生成任务整集写库（带上下文，一次
  // 请求看完整段对话），逐句实时翻译的译文会因看不到上下文而发飘。
  // 缓存缺失时显示「待生成」，由用户点按钮触发一次整集生成。
  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    const bundled = bundledEpisodeTranslations(
      episode.id,
      episode.turns.length
    );
    const bundledCount = Object.keys(bundled).length;
    setTranslationMissing(false);
    if (bundledCount > 0) setTranslations(bundled);
    // 课程台词是固定的；随包预生成的整集译文优先，不再请求 LLM。
    if (bundledCount >= episode.turns.length) {
      return () => {
        cancelled = true;
      };
    }
    const lines = episodeSourceLines(episode);
    const speakers = episodeSpeakers(episode);
    const request = {
      episode_id: episode.id,
      source_hash: podcastSourceHash(lines),
      title: episode.title,
      turns: lines.map((text, index) => ({ speaker: speakers[index], text })),
    };
    getPodcastTranslations(request)
      .then((out) => {
        if (cancelled) return;
        const merged = {
          ...bundled,
          ...indexTranslations(out.translations, episode.id),
        };
        if (Object.keys(merged).length === 0) {
          setTranslations({});
          setTranslationMissing(true);
          return;
        }
        setTranslations(merged);
        setTranslationMissing(false);
      })
      .catch(() => {
        // 读不到就当没有：显示「待生成」，而不是静默地逐句补翻。
        if (!cancelled && bundledCount === 0) setTranslationMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [episode]);

  const generateCaptions = async () => {
    if (!episode || translatingEpisode) return;
    setTranslatingEpisode(true);
    const lines = episodeSourceLines(episode);
    const speakers = episodeSpeakers(episode);
    try {
      const out = await generatePodcastTranslations({
        episode_id: episode.id,
        source_hash: podcastSourceHash(lines),
        title: episode.title,
        turns: lines.map((text, index) => ({ speaker: speakers[index], text })),
      });
      setTranslations(indexTranslations(out.translations, episode.id));
      setTranslationMissing(false);
      toast(t('podcastTranscriptReady'));
    } catch {
      toast(t('podcastTranscriptFailed'));
    } finally {
      setTranslatingEpisode(false);
    }
  };

  const changeTranslation = (value: boolean) => {
    setTranslationEnabled(value);
    AsyncStorage.setItem('podcast_translation_enabled', value ? '1' : '0').catch(
      () => {}
    );
  };

  const changeSpeed = (rate: number, restartCurrent: boolean) => {
    playerRef.current?.setRate(rate);
    AsyncStorage.setItem('podcast_rate', String(rate)).catch(() => {});
    if (restartCurrent && playback.playing) {
      playerRef.current?.seek(playback.episodeIndex, playback.turnIndex);
    }
  };

  const generateEpisode = async () => {
    if (!episode || generating) return;
    setGenerating(true);
    try {
      await Promise.all(
        episode.turns.map((item) =>
          requestPodcastClip(item.content, { enqueue: true })
        )
      );
      toast(t('podcastGenerateQueued'));
    } catch {
      toast(t('podcastGenerateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const seekToTurn = (index: number) => {
    const player = playerRef.current;
    if (!player) return;
    setManualPinned(true);
    setTransportVisible(true);
    setFollowing(true);
    player.seek(playback.episodeIndex, index);
    if (!playback.playing) player.play();
  };

  const handleProgressPress = (event: GestureResponderEvent) => {
    if (!episode || progressWidth <= 0) return;
    const seekAt = (localX: number) => {
      if (!Number.isFinite(localX)) return;
      const ratio = Math.min(Math.max(localX / progressWidth, 0), 1);
      const index = Math.min(
        episode.turns.length - 1,
        Math.floor(ratio * episode.turns.length)
      );
      if (!Number.isFinite(index)) return;
      setFollowing(true);
      playerRef.current?.seek(playback.episodeIndex, index);
    };
    const native = event.nativeEvent as typeof event.nativeEvent & {
      pageX?: number;
    };
    if (Number.isFinite(native.locationX)) {
      seekAt(native.locationX);
      return;
    }
    if (typeof native.pageX === 'number') {
      progressRef.current?.measureInWindow((x, _y, width) => {
        seekAt(native.pageX! - x);
        if (width > 0 && Math.abs(width - progressWidth) > 1) {
          setProgressWidth(width);
        }
      });
    }
  };

  const handleTranscriptScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    lastOffsetRef.current = event.nativeEvent.contentOffset.y;
    if (!following) return;
    if (Date.now() < autoScrollUntilRef.current) return;
    const offset = event.nativeEvent.contentOffset.y;
    const target = autoScrollTargetRef.current;
    if (
      target != null &&
      !autoScrollSettledRef.current &&
      Math.abs(offset - target) <= 6
    ) {
      autoScrollSettledRef.current = true;
      return;
    }
    if (target != null && autoScrollSettledRef.current && Math.abs(offset - target) > 96) {
      setFollowing(false);
    }
  };

  const resumeFollowing = () => {
    setFollowing(true);
    requestAnimationFrame(() => scrollToActiveTurn());
  };

  // 播放条的手动收起/展开。用户一旦手动操作过，就固定成用户选的那个状态，
  // 自动连播不会再把它收回（见 transportPinned 的注释）。
  const collapseTransport = () => {
    setTransportPinned(true);
    setTransportVisible(false);
  };

  const expandTransport = () => {
    setTransportPinned(true);
    setTransportVisible(true);
  };

  const maxStageHeight = Math.round(height * 0.32);
  const preferredAvatar = height >= 780 ? 180 : height >= 680 ? 160 : 140;
  const stageAvatarSize = Math.max(
    112,
    Math.min(preferredAvatar, Math.floor((maxStageHeight - 64) * 0.75))
  );
  const stageVideoHeight = Math.round((stageAvatarSize * 4) / 3);
  const stageHaloSize = Math.round(stageAvatarSize * 0.86);
  // 两层都用 absoluteFill，onLayout 量到的是外层动画容器的高度，
  // 不是内容本身的高度；展开高度必须按内容算，否则会一直量到折叠高度。
  const expandedStageHeight = stageVideoHeight + 64;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={styles.shell}>
        <CoachHeader title={t('podcastTitle')} onBack={goBack} />
        <View style={[styles.headerBlock, { borderBottomColor: c.border }]}>
          <View style={styles.metaRow}>
            <Text
              numberOfLines={1}
              style={[styles.lesson, { color: c.inkMuted }]}
            >
              Lesson {episode?.lessonNumber ?? 0} · {episode?.lessonTitle ?? ''}
            </Text>
            {playback.loopLine || playback.pauseEachLine ? (
              <Text
                style={[
                  styles.shadowBadge,
                  { color: c.accent, backgroundColor: c.accentLight },
                ]}
              >
                {playback.loopLine
                  ? t('podcastLoop')
                  : t('podcastShadowing')}
              </Text>
            ) : null}
            <Text style={[styles.duration, { color: c.inkMuted }]}>
              {episode ? `~${episodeMinutes(episode.turns)} min` : ''}
            </Text>
          </View>
          <Text
            numberOfLines={2}
            style={[styles.episodeTitle, { color: c.ink, fontFamily: serif }]}
          >
            {titleParts.title}
          </Text>
          {titleParts.subtitle ? (
            <Text style={[styles.episodeSubtitle, { color: c.inkMuted }]}>
              {titleParts.subtitle}
            </Text>
          ) : null}

          <Animated.View
            style={{
              height: stageAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [70, expandedStageHeight],
              }),
              overflow: 'hidden',
            }}
          >
            <Animated.View
              pointerEvents={stageOpen ? 'none' : 'auto'}
              style={[
                styles.stageLayer,
                {
                  opacity: stageAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0],
                  }),
                  transform: [
                    {
                      translateY: stageAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -10],
                      }),
                    },
                  ],
                },
              ]}
            >
            <View
              style={[
                styles.anchorStrip,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastExpandStage')}
                onPress={() => setStageOpen(true)}
                style={styles.stripMain}
              >
                <PodcastFoxAvatar variant="head" size={56} />
                <View style={styles.anchorBody}>
                  <View style={styles.onAirRow}>
                    <LiveDot on={playback.playing} />
                    <Text
                      style={[
                        styles.onAirText,
                        { color: playback.playing ? c.accent : c.inkMuted },
                      ]}
                    >
                      {playback.playing ? t('podcastOnAir') : t('podcastStandby')}
                    </Text>
                    <Text style={[styles.anchorRole, { color: c.inkMuted }]}>
                      · {t('podcastAnchorRole')}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.anchorName, { color: c.ink, fontFamily: serif }]}
                  >
                    {anchorName}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastSettings')}
                onPress={() => setSheetOpen(true)}
                style={styles.stripAction}
              >
                <SlidersIcon color={c.inkMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastExpandStage')}
                onPress={() => setStageOpen(true)}
                style={styles.stripAction}
              >
                <StageChevron up={false} color={c.inkMuted} />
              </Pressable>
            </View>
            </Animated.View>
            <Animated.View
              pointerEvents={stageOpen ? 'auto' : 'none'}
              style={[
                styles.stageLayer,
                {
                  opacity: stageAnim,
                  transform: [
                    {
                      translateY: stageAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [12, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
            <View
              style={[styles.stage, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastCollapseStage')}
                onPress={() => setStageOpen(false)}
                style={styles.stageMain}
              >
                <View
                  pointerEvents="none"
                  style={[styles.stageClose, { backgroundColor: c.inputBg }]}
                >
                  <StageChevron up color={c.inkMuted} />
                </View>
                <View
                  style={[
                    styles.stageAvatar,
                    { width: stageAvatarSize + 10, height: stageVideoHeight },
                  ]}
                >
                  <View
                    style={[
                      styles.stageHalo,
                      {
                        backgroundColor: c.accentLight,
                        width: stageHaloSize,
                        height: stageHaloSize,
                        borderRadius: stageHaloSize / 2,
                        top: (stageVideoHeight - stageHaloSize) / 2,
                        left: (stageAvatarSize + 10 - stageHaloSize) / 2,
                      },
                    ]}
                  />
                  <PodcastFoxAvatar
                    variant="stage"
                    width={stageAvatarSize}
                    height={stageVideoHeight}
                  />
                  {/* 同一个 VideoView 连续 replace 会丢帧变黑，按句子重挂让新片段重新绑定表面。 */}
                  <VideoView
                    key={`${playback.episodeIndex}-${playback.turnIndex}`}
                    player={videoPlayer}
                    style={[
                      styles.stageVideo,
                      {
                        width: stageAvatarSize,
                        height: stageVideoHeight,
                        opacity: videoActive || posterSource ? 1 : 0,
                      },
                    ]}
                    contentFit="cover"
                    nativeControls={false}
                    onFirstFrameRender={() => setVideoActive(true)}
                    pointerEvents="none"
                    surfaceType="textureView"
                  />
                  {posterSource && !videoActive ? (
                    <Image
                      fadeDuration={0}
                      resizeMode="cover"
                      source={posterSource}
                      style={[
                        styles.stageVideo,
                        {
                          width: stageAvatarSize,
                          height: stageVideoHeight,
                          zIndex: 2,
                        },
                      ]}
                    />
                  ) : null}
                </View>
                <View style={styles.stageCopy}>
                  <View style={styles.onAirRow}>
                    <LiveDot on={playback.playing} />
                    <Text
                      style={[
                        styles.onAirText,
                        { color: playback.playing ? c.accent : c.inkMuted },
                      ]}
                    >
                      {playback.playing ? t('podcastOnAir') : t('podcastStandby')}
                    </Text>
                    <Text style={[styles.anchorRole, { color: c.inkMuted }]}>
                      · {t('podcastAnchorRole')}
                    </Text>
                  </View>
                  <Text
                    style={[styles.stageName, { color: c.ink, fontFamily: serif }]}
                  >
                    {anchorName}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastSettings')}
                onPress={() => setSheetOpen(true)}
                style={[styles.stageSettings, { backgroundColor: c.inputBg }]}
              >
                <SlidersIcon color={c.inkMuted} />
              </Pressable>
            </View>
            </Animated.View>
          </Animated.View>
          {translationEnabled && translationMissing ? (
            <View
              style={[
                styles.captionNotice,
                { backgroundColor: c.accentLight, borderColor: c.border },
              ]}
            >
              <Text style={[styles.captionNoticeText, { color: c.inkMuted }]}>
                {t('podcastTranscriptMissing')}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={translatingEpisode}
                onPress={() => void generateCaptions()}
                style={[
                  styles.captionNoticeAction,
                  { borderColor: c.border, opacity: translatingEpisode ? 0.5 : 1 },
                ]}
              >
                <Text style={[styles.captionNoticeActionText, { color: c.accent }]}>
                  {translatingEpisode
                    ? t('podcastTranslating')
                    : t('podcastTranscriptGenerate')}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.progressRow}>
            <Pressable
              ref={progressRef}
              accessibilityRole="adjustable"
              accessibilityLabel={t('podcastProgressLabel')}
              accessibilityValue={{
                min: 1,
                max: Math.max(1, episode?.turns.length ?? 1),
                now: playback.turnIndex + 1,
              }}
              onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
              onPress={handleProgressPress}
              style={styles.progressHit}
            >
              <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: c.accent, width: `${progress * 100}%` },
                  ]}
                />
              </View>
              <View
                style={[
                  styles.progressThumb,
                  { backgroundColor: c.accent, left: `${progress * 100}%` },
                ]}
              />
            </Pressable>
            <Text style={[styles.progressCount, { color: c.inkMuted }]}>
              {t('podcastLinePosition', {
                current: playback.turnIndex + 1,
                total: episode?.turns.length ?? 0,
              })}
            </Text>
          </View>
        </View>

        {stageOpen ? (
          <View style={styles.studioCaptionShell}>
            <ScrollView
              key={`${episode?.id ?? 'episode'}-${playback.turnIndex}`}
              contentContainerStyle={styles.studioCaptionContent}
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('podcastPlay')}: ${activeTurn?.content ?? ''}`}
                onPress={() => seekToTurn(playback.turnIndex)}
                style={[
                  styles.studioCaption,
                  { backgroundColor: c.card, borderColor: c.accent },
                ]}
              >
                <Text style={[styles.studioCaptionSpeaker, { color: c.accent }]}>
                  {activeTurn?.role === 'user'
                    ? t('podcastYou')
                    : episode?.coachName || t('podcastCoach')}
                </Text>
                <Text style={[styles.studioCaptionText, { color: c.ink }]}>
                  {activeTurn?.content ?? ''}
                </Text>
                {activeTranslation ? (
                  <Text
                    style={[styles.studioCaptionTranslation, { color: c.inkMuted }]}
                  >
                    {activeTranslation}
                  </Text>
                ) : null}
              </Pressable>
            </ScrollView>
            <View style={styles.studioActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => seekToTurn(playback.turnIndex)}
                style={[styles.studioAction, { borderColor: c.border }]}
              >
                <Text style={[styles.studioActionText, { color: c.ink }]}>
                  {t('podcastReplayLine')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastCollapseStage')}
                onPress={() => setStageOpen(false)}
                style={[styles.studioAction, { borderColor: c.border }]}
              >
                <Text style={[styles.studioActionText, { color: c.ink }]}>
                  {t('podcastFullTranscript')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
        <View
          style={styles.transcriptShell}
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
            onScroll={handleTranscriptScroll}
            onScrollBeginDrag={() => setFollowing(false)}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.chat}>
              {episode?.turns.map((item, index) => {
                const key = `${episode.id}:${index}`;
                const translation = translationEnabled ? translations[key] : undefined;
                return (
                  <ChatTurn
                    key={`${episode.id}-${index}`}
                    index={index}
                    role={item.role}
                    speaker={episode.coachName || t('podcastCoach')}
                    content={item.content}
                    active={index === playback.turnIndex}
                    playing={playback.playing}
                    highlight={wordRange?.turnIndex === index ? wordRange : null}
                    translation={translation}
                    colors={c}
                    youLabel={t('podcastYou')}
                    onLayout={handleTurnLayout}
                    onSeek={seekToTurn}
                  />
                );
              })}
            </View>
            <View style={{ height: Math.max(28, viewportHeight * 0.36) }} />
          </ScrollView>

          {!following && episode ? (
            <Pressable
              accessibilityRole="button"
              onPress={resumeFollowing}
              style={[
                styles.followPill,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <Text style={[styles.followPillText, { color: c.ink }]}>
                {t('podcastBackToCurrent')}
              </Text>
            </Pressable>
          ) : null}

          {atEpisodeEnd && following ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFollowing(true);
                playerRef.current?.play();
              }}
              style={[
                styles.replayOverlay,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              <Text style={{ color: c.ink, fontWeight: '700' }}>
                {t('podcastReplay')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        )}

        <Animated.View
          style={[
            styles.transportShell,
            {
              backgroundColor: c.paper,
              borderTopColor: c.border,
              height: transportAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [44, 108],
              }),
            },
          ]}
        >
          <Animated.View
            pointerEvents={transportVisible ? 'auto' : 'none'}
            style={[
              styles.transportFull,
              {
                opacity: transportAnim,
                transform: [
                  {
                    translateY: transportAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [24, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {/* 手动收起：只有用户点这里或向下滑，自动连播才不会把它收回去。 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('podcastHideControls')}
              onPress={() => collapseTransport()}
              style={styles.transportGrabberHit}
            >
              <View
                style={[styles.transportGrabber, { backgroundColor: c.border }]}
              />
            </Pressable>
            <View style={styles.controls}>
              <Control
                icon="prevEpisode"
                hint={t('podcastPrevEpisode')}
                onPress={() => {
                  setFollowing(true);
                  playerRef.current?.prevEpisode();
                }}
                color={c.ink}
              />
              <Control
                icon="prevLine"
                hint={t('podcastPrevLine')}
                onPress={() => {
                  setFollowing(true);
                  playerRef.current?.prevTurn();
                }}
                color={c.ink}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playback.playing ? t('podcastPause') : t('podcastPlay')}
                onPress={() => {
                  setManualPinned(true);
                  setTransportVisible(true);
                setFollowing(true);
                  playerRef.current?.toggle();
                }}
                style={[styles.playButton, { backgroundColor: c.buttonBg }]}
              >
                <TransportIcon
                  name={playback.playing ? 'pause' : 'play'}
                  color={c.buttonText}
                  size={26}
                />
              </Pressable>
              <Control
                icon="nextLine"
                hint={t('podcastNextLine')}
                onPress={() => {
                  setFollowing(true);
                  playerRef.current?.nextTurn();
                }}
                color={c.ink}
              />
              <Control
                icon="nextEpisode"
                hint={t('podcastNextEpisode')}
                onPress={() => {
                  setFollowing(true);
                  playerRef.current?.nextEpisode();
                }}
                color={c.ink}
              />
            </View>
          </Animated.View>

          <Animated.View
            pointerEvents={transportVisible ? 'none' : 'auto'}
            style={[
              styles.transportHandle,
              {
                opacity: transportAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0],
                }),
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                playback.playing ? t('podcastPause') : t('podcastPlay')
              }
              onPress={() => {
                setManualPinned(true);
                setFollowing(true);
                playerRef.current?.toggle();
              }}
              style={[styles.miniPlay, { backgroundColor: c.buttonBg }]}
            >
              <TransportIcon
                name={playback.playing ? 'pause' : 'play'}
                color={c.buttonText}
                size={16}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('podcastShowControls')}
              onPress={expandTransport}
              style={styles.miniMain}
            >
              <View style={styles.miniText}>
                <Text
                  numberOfLines={1}
                  style={[styles.miniTitle, { color: c.ink }]}
                >
                  {episode ? titleParts.title : t('podcastTitle')}
                </Text>
                <Text style={[styles.miniMeta, { color: c.inkMuted }]}>
                  {t('podcastLinePosition', {
                    current: playback.turnIndex + 1,
                    total: episode?.turns.length ?? 0,
                  })}
                  {playback.loopLine
                    ? ` · ${t('podcastLoop')}`
                    : playback.pauseEachLine
                      ? ` · ${t('podcastShadowing')}`
                      : ''}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('podcastSpeed')} ${formatPlaybackSpeed(
                playback.rate
              )}`}
              onPress={() =>
                changeSpeed(nextPlaybackSpeed(playback.rate), true)
              }
              style={[styles.speedPill, { borderColor: c.border }]}
            >
              <Text style={[styles.speedPillText, { color: c.inkMuted }]}>
                {formatPlaybackSpeed(playback.rate)}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('podcastShowControls')}
              onPress={expandTransport}
              style={styles.miniExpand}
            >
              <StageChevron up color={c.inkMuted} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
      <PodcastSettingsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rate={playback.rate}
        onRate={(rate) => {
          changeSpeed(rate, false);
        }}
        autoplay={playback.autoplay}
        onAutoplay={(value) => {
          playerRef.current?.setAutoplay(value);
          AsyncStorage.setItem(
            'podcast_autoplay',
            value ? '1' : '0'
          ).catch(() => {});
          setManualPinned(false);
          if (!value) setTransportVisible(true);
        }}
        pauseEachLine={playback.pauseEachLine}
        onPauseEachLine={(value) => {
          playerRef.current?.setPauseEachLine(value);
          AsyncStorage.setItem(
            'podcast_pause_each_line',
            value ? '1' : '0'
          ).catch(() => {});
          if (value) {
            // 逐句模式与自动连播互斥：开关上的状态要和实际行为一致。
            playerRef.current?.setAutoplay(false);
            AsyncStorage.multiSet([
              ['podcast_loop_line', '0'],
              ['podcast_autoplay', '0'],
            ]).catch(() => {});
          }
        }}
        loopLine={playback.loopLine}
        onLoopLine={(value) => {
          playerRef.current?.setLoopLine(value);
          AsyncStorage.setItem(
            'podcast_loop_line',
            value ? '1' : '0'
          ).catch(() => {});
          if (value) {
            AsyncStorage.multiSet([
              ['podcast_pause_each_line', '0'],
              ['podcast_autoplay', '0'],
            ]).catch(() => {});
          }
        }}
        translation={translationEnabled}
        onTranslation={changeTranslation}
        generating={generating}
        onGenerate={() => void generateEpisode()}
      />
    </SafeAreaView>
  );
}

type ChatColors = {
  card: string;
  border: string;
  accent: string;
  accentLight: string;
  ink: string;
  inkMuted: string;
};

const ChatTurn = memo(function ChatTurn({
  index,
  role,
  speaker,
  content,
  active,
  playing,
  highlight,
  translation,
  colors,
  youLabel,
  onLayout,
  onSeek,
}: {
  index: number;
  role: 'coach' | 'user';
  speaker: string;
  content: string;
  active: boolean;
  playing: boolean;
  highlight: WordRange | null;
  translation?: string;
  colors: ChatColors;
  youLabel: string;
  onLayout: (index: number, y: number, height: number) => void;
  onSeek: (index: number) => void;
}) {
  const mine = role === 'user';
  const valid =
    !!highlight &&
    highlight.length > 0 &&
    highlight.start >= 0 &&
    highlight.start < content.length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mine ? youLabel : speaker}: ${content}`}
      onPress={() => onSeek(index)}
      onLayout={(event) =>
        onLayout(
          index,
          event.nativeEvent.layout.y,
          event.nativeEvent.layout.height
        )
      }
      style={({ pressed }) => [
        styles.chatRow,
        mine ? styles.chatRowMine : styles.chatRowOther,
        pressed ? styles.chatRowPressed : null,
      ]}
    >
      {!mine ? (
        <PodcastFoxAvatar variant="head" size={30} />
      ) : null}
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleOther,
          {
            backgroundColor: active ? colors.accentLight : colors.card,
            borderColor: active ? colors.accent : colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.bubbleSpeaker,
            { color: active ? colors.accent : colors.inkMuted },
          ]}
        >
          {mine ? youLabel : speaker}
        </Text>
        <Text style={[styles.bubbleText, { color: colors.ink }]}>
          {valid ? (
            <>
              {content.slice(0, highlight.start)}
              <Text style={{ color: colors.accent, fontWeight: '800' }}>
                {content.slice(highlight.start, highlight.start + highlight.length)}
              </Text>
              {content.slice(highlight.start + highlight.length)}
            </>
          ) : (
            content
          )}
        </Text>
        {translation ? (
          <Text style={[styles.bubbleTranslation, { color: colors.inkMuted }]}>
            {translation}
          </Text>
        ) : null}
      </View>
      {mine ? <PodcastLearnerAvatar size={30} /> : null}
    </Pressable>
  );
});

function StageChevron({ up, color }: { up: boolean; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d={up ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type TransportIconName =
  | 'prevEpisode'
  | 'prevLine'
  | 'play'
  | 'pause'
  | 'nextLine'
  | 'nextEpisode';

function TransportIcon({
  name,
  color,
  size = 18,
}: {
  name: TransportIconName;
  color: string;
  size?: number;
}) {
  let content;
  switch (name) {
    case 'play':
      content = <Polygon points="6,3 20,12 6,21" fill={color} />;
      break;
    case 'pause':
      content = (
        <>
          <Rect x="6" y="4" width="4" height="16" rx="1.2" fill={color} />
          <Rect x="14" y="4" width="4" height="16" rx="1.2" fill={color} />
        </>
      );
      break;
    case 'prevLine':
      content = (
        <>
          <Polygon points="18,5 9,12 18,19" fill={color} />
          <Polygon points="11,5 2,12 11,19" fill={color} />
        </>
      );
      break;
    case 'nextLine':
      content = (
        <>
          <Polygon points="6,5 15,12 6,19" fill={color} />
          <Polygon points="13,5 22,12 13,19" fill={color} />
        </>
      );
      break;
    case 'prevEpisode':
      content = (
        <>
          <Rect x="3" y="4" width="2.5" height="16" rx="1" fill={color} />
          <Polygon points="20,5 9,12 20,19" fill={color} />
        </>
      );
      break;
    case 'nextEpisode':
      content = (
        <>
          <Polygon points="4,5 15,12 4,19" fill={color} />
          <Rect x="18.5" y="4" width="2.5" height="16" rx="1" fill={color} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {content}
    </Svg>
  );
}

function SlidersIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M4 7h8M16 7h4M4 17h4M12 17h8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Rect x="12" y="4" width="4" height="6" rx="2" fill={color} />
      <Rect x="8" y="14" width="4" height="6" rx="2" fill={color} />
    </Svg>
  );
}

function LiveDot({ on }: { on: boolean }) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!on) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.setValue(1);
    };
  }, [on, opacity]);

  return (
    <Animated.View
      style={[
        styles.liveDot,
        {
          backgroundColor: on ? theme.colors.accent : theme.colors.inkMuted,
          opacity,
        },
      ]}
    />
  );
}

function Control({
  icon,
  hint,
  onPress,
  color,
}: {
  icon: TransportIconName;
  hint: string;
  onPress: () => void;
  color: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      style={[styles.control, { backgroundColor: c.card, borderColor: c.border }]}
    >
      <TransportIcon name={icon} color={color} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  // 两层叠加时父容器高度由动画值给，子层就必须绝对定位铺满，
  // 否则它们会各自撑高父容器、把插值出来的高度覆盖掉。
  stageLayer: { ...StyleSheet.absoluteFill },
  captionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 6,
    marginTop: 6,
  },
  captionNoticeText: { flex: 1, fontSize: 11.5, lineHeight: 15 },
  captionNoticeAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  captionNoticeActionText: { fontSize: 11.5, fontWeight: '700' },
  headerBlock: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  transcriptShell: { flex: 1, minHeight: 0 },
  transcript: { flex: 1 },
  transcriptContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  studioCaptionShell: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
  },
  studioCaptionContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  studioCaption: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  studioCaptionSpeaker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  studioCaptionText: { fontSize: 15, lineHeight: 21 },
  studioCaptionTranslation: { fontSize: 12.5, lineHeight: 18 },
  studioActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  studioAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  studioActionText: { fontSize: 11.5, fontWeight: '700' },
  anchorStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingLeft: 4,
    paddingRight: 6,
  },
  stripMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  stage: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: 12,
    gap: 2,
  },
  stageMain: { width: '100%', alignItems: 'center', gap: 2 },
  stageClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  stageAvatar: {
    width: 220,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageVideo: {
    position: 'absolute',
    left: 5,
    top: 0,
    zIndex: 1,
    width: 210,
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  stageHalo: {
    position: 'absolute',
    top: 45,
    left: 15,
    width: 190,
    height: 190,
    borderRadius: 95,
  },
  stageCopy: { alignItems: 'center', gap: 2 },
  stageName: { fontSize: 20, fontWeight: '700' },
  anchorBody: { flex: 1, gap: 1, minWidth: 0 },
  onAirRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  onAirText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8 },
  anchorName: { fontSize: 16, fontWeight: '700' },
  anchorRole: { fontSize: 10.5 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  lesson: { flex: 1, fontSize: 12, fontWeight: '600' },
  duration: { flexShrink: 0, fontSize: 11.5 },
  shadowBadge: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: '800',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  episodeTitle: { fontSize: 19, fontWeight: '700', lineHeight: 25 },
  episodeSubtitle: { fontSize: 12, lineHeight: 17, marginTop: -4 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 18,
  },
  progressHit: { flex: 1, height: 20, justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  progressThumb: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    top: 5,
  },
  progressCount: {
    fontSize: 10.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  chat: { gap: 10, paddingTop: 4, paddingBottom: 8 },
  chatRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  chatRowMine: { justifyContent: 'flex-end' },
  chatRowOther: { justifyContent: 'flex-start' },
  chatRowPressed: { opacity: 0.72 },
  bubble: {
    maxWidth: '82%',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
  },
  bubbleMine: { borderBottomRightRadius: 5, maxWidth: '78%' },
  bubbleOther: { borderBottomLeftRadius: 5 },
  bubbleSpeaker: { fontSize: 10.5, fontWeight: '700' },
  bubbleText: { fontSize: 14.5, lineHeight: 21 },
  bubbleTranslation: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  stageSettings: {
    position: 'absolute',
    top: 10,
    right: 48,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  stripAction: { padding: 8 },
  transportShell: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // 播放条顶部的手柄：一处可点的横条，向下滑/点它收起。
  transportGrabberHit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 2,
  },
  transportGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  transportFull: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 108,
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  transportHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  miniPlay: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    minWidth: 0,
  },
  miniText: { flex: 1, minWidth: 0, gap: 1 },
  miniTitle: { fontSize: 12.5, fontWeight: '700' },
  miniMeta: { fontSize: 10.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  speedPill: {
    minWidth: 44,
    height: 28,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedPillText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  miniExpand: {
    width: 24,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 2,
    width: '100%',
    maxWidth: 520,
  },
  control: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followPill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  followPillText: { fontSize: 12, fontWeight: '700' },
  replayOverlay: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
});
