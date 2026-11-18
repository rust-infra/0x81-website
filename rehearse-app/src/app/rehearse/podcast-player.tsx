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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Polygon, Rect } from 'react-native-svg';
import { CoachAvatar } from '../../components/rehearse/CoachAvatar';
import { CoachHeader } from '../../components/rehearse/CoachUi';
import { PodcastSettingsSheet } from '../../components/rehearse/PodcastSettingsSheet';
import { useAuth } from '../../lib/auth';
import { getApiBase } from '../../lib/config';
import {
  buildPodcastEpisodes,
  createPodcastPlayer,
  episodeMinutes,
  estimateWordRange,
  type WordRange,
  type PodcastPlayer,
  type PodcastState,
} from '../../lib/podcast';
import {
  loadPodcastPoster,
  resolvePodcastClipSource,
  type PodcastClipSource,
} from '../../lib/podcast-video';
import {
  getCachedPodcastTranslation,
  translatePodcastLines,
} from '../../lib/podcast-translation';
import {
  requestPodcastClip,
  translateInterpretText,
} from '../../lib/rehearse-api-runtime';
import { getSpeechSettings, speak, stopSpeaking } from '../../lib/speech';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

export default function PodcastPlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scenarioId?: string; deck?: string }>();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const { token } = useAuth();
  const c = theme.colors;
  const deck = params.deck || '第一册';
  const episodes = useMemo(() => buildPodcastEpisodes(deck), [deck]);
  const initialIndex = Math.max(
    0,
    episodes.findIndex((episode) => episode.id === params.scenarioId)
  );
  const initialIndexRef = useRef(initialIndex);
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
    turnIndex: 0,
    playing: false,
    rate: 1,
    autoplay: true,
  });
  const [transportVisible, setTransportVisible] = useState(!playback.autoplay);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [manualPinned, setManualPinned] = useState(false);
  const [wordRange, setWordRange] = useState<
    (WordRange & { turnIndex: number }) | null
  >(null);
  const playerRef = useRef<PodcastPlayer | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const turnLayoutRef = useRef<Record<number, { y: number; height: number }>>({});
  const chatOffsetRef = useRef(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const activeTextRef = useRef<{ turnIndex: number; text: string } | null>(null);
  const startedRef = useRef(false);
  const transportAnim = useRef(new Animated.Value(transportVisible ? 1 : 0)).current;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
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
    opts: { rate: number; language?: string }
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
    await speak(text, {
      ...opts,
      voiceId: /[\u4e00-\u9fff]/.test(text)
        ? settings.speech_zh_voice
        : settings.speech_voice,
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
    if (playback.autoplay && !manualPinned) setTransportVisible(false);
    else setTransportVisible(true);
  }, [playback.playing, playback.autoplay, manualPinned]);

  useEffect(() => {
    Animated.timing(transportAnim, {
      toValue: transportVisible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [transportAnim, transportVisible]);

  useEffect(() => {
    setWordRange(null);
  }, [playback.turnIndex, playback.episodeIndex]);

  useEffect(() => {
    const layout = turnLayoutRef.current[playback.turnIndex];
    if (!layout || viewportHeight <= 0) return;
    const timer = setTimeout(() => {
      const target =
        chatOffsetRef.current +
        layout.y +
        layout.height / 2 -
        viewportHeight / 2;
      scrollRef.current?.scrollTo({
        y: Math.max(0, target),
        animated: true,
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [playback.turnIndex, playback.episodeIndex, layoutTick, viewportHeight]);

  const handleTurnLayout = useCallback((index: number, y: number, height: number) => {
    turnLayoutRef.current[index] = { y, height };
    setLayoutTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || episodes.length === 0) return;
    player.play(initialIndexRef.current);
    return () => {
      player.pause();
      void stopSpeaking();
    };
  }, [episodes.length]);

  const episode = episodes[playback.episodeIndex];
  const anchorName = t('podcastAnchorName');
  const progress =
    episode && episode.turns.length > 0
      ? (playback.turnIndex + 1) / episode.turns.length
      : 0;
  const atEpisodeEnd =
    !!episode &&
    !playback.playing &&
    playback.turnIndex === episode.turns.length - 1;

  useEffect(() => {
    if (!episode) return;
    const cached: Record<string, string> = {};
    const pending: Array<{ key: string; text: string }> = [];
    episode.turns.forEach((turn, index) => {
      const key = `${episode.id}:${index}`;
      const hit = getCachedPodcastTranslation(key);
      if (hit) cached[key] = hit;
      else if (translationEnabled && !/[\u4e00-\u9fff]/.test(turn.content)) {
        pending.push({ key, text: turn.content });
      }
    });
    if (Object.keys(cached).length > 0) {
      setTranslations((prev) => ({ ...prev, ...cached }));
    }
    if (!translationEnabled || pending.length === 0) return;
    let cancelled = false;
    void translatePodcastLines(
      pending,
      async (text) => (await translateInterpretText(text)).translation,
      (key, text) => {
        if (!cancelled) setTranslations((prev) => ({ ...prev, [key]: text }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [episode, translationEnabled]);

  const changeTranslation = (value: boolean) => {
    setTranslationEnabled(value);
    AsyncStorage.setItem('podcast_translation_enabled', value ? '1' : '0').catch(
      () => {}
    );
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

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('podcastTitle')} onBack={goBack} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.metaRow}>
          <Text style={[styles.lesson, { color: c.inkMuted }]}>
            Lesson {episode?.lessonNumber ?? 0} · {episode?.lessonTitle ?? ''}
          </Text>
          <Text style={[styles.duration, { color: c.inkMuted }]}>
            {episode ? `~${episodeMinutes(episode.turns)} min` : ''}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={[styles.episodeTitle, { color: c.ink, fontFamily: serif }]}
        >
          {episode?.title ?? '—'}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            stageOpen ? t('podcastCollapseStage') : t('podcastExpandStage')
          }
          onPress={() => setStageOpen((open) => !open)}
          style={
            stageOpen
              ? [styles.stage, { backgroundColor: c.card, borderColor: c.border }]
              : [styles.anchorStrip, { backgroundColor: c.card, borderColor: c.border }]
          }
        >
          {stageOpen ? (
            <>
              <View
                pointerEvents="none"
                style={[styles.stageClose, { backgroundColor: c.inputBg }]}
              >
                <StageChevron up color={c.inkMuted} />
              </View>
              <View style={styles.stageAvatar}>
                <View style={[styles.stageHalo, { backgroundColor: c.accentLight }]} />
                <CoachAvatar
                  state={playback.playing ? 'speaking' : 'idle'}
                  mood="friendly"
                  size={210}
                />
                {/* 同一个 VideoView 连续 replace 会丢帧变黑，按句子重挂让新片段重新绑定表面。 */}
                <VideoView
                  key={`${playback.episodeIndex}-${playback.turnIndex}`}
                  player={videoPlayer}
                  style={[
                    styles.stageVideo,
                    { opacity: videoActive || posterSource ? 1 : 0 },
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
                    style={[styles.stageVideo, { zIndex: 2 }]}
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
                <Text style={[styles.stageName, { color: c.ink, fontFamily: serif }]}>
                  {anchorName}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('podcastSettings')}
                  onPress={(event) => {
                    event.stopPropagation();
                    setSheetOpen(true);
                  }}
                  style={styles.stageSettings}
                >
                  <SlidersIcon color={c.inkMuted} />
                  <Text style={[styles.stageSettingsText, { color: c.inkMuted }]}>
                    {t('podcastSettings')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <CoachAvatar
                state={playback.playing ? 'speaking' : 'idle'}
                mood="friendly"
                size={56}
              />
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('podcastSettings')}
                onPress={(event) => {
                  event.stopPropagation();
                  setSheetOpen(true);
                }}
                style={styles.stripAction}
              >
                <SlidersIcon color={c.inkMuted} />
              </Pressable>
              <StageChevron up={false} color={c.inkMuted} />
            </>
          )}
        </Pressable>

        <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.accent, width: `${progress * 100}%` },
            ]}
          />
        </View>

        <View
          style={styles.chat}
          onLayout={(event) => {
            chatOffsetRef.current = event.nativeEvent.layout.y;
          }}
        >
          {episode?.turns.map((item, index) => (
            <ChatTurn
              key={`${episode.id}-${index}`}
              index={index}
              role={item.role}
              speaker={episode.coachName || t('podcastCoach')}
              content={item.content}
              active={index === playback.turnIndex}
              playing={playback.playing}
              highlight={wordRange?.turnIndex === index ? wordRange : null}
              translation={
                translationEnabled ? translations[`${episode.id}:${index}`] : undefined
              }
              colors={c}
              youLabel={t('podcastYou')}
              onLayout={handleTurnLayout}
            />
          ))}
        </View>

        <View style={{ height: Math.max(0, viewportHeight * 0.4) }} />

        {atEpisodeEnd ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => playerRef.current?.play(playback.episodeIndex)}
            style={[styles.replay, { borderColor: c.border }]}
          >
            <Text style={{ color: c.ink, fontWeight: '700' }}>{t('podcastReplay')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Animated.View
        style={[
          styles.transportShell,
          {
            backgroundColor: c.paper,
            borderTopColor: c.border,
            height: transportAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [26, 76],
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
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.controls}>
            <Control
              icon="prevEpisode"
              hint={t('podcastPrevEpisode')}
              onPress={() => playerRef.current?.prevEpisode()}
              color={c.ink}
            />
            <Control
              icon="prevLine"
              hint={t('podcastPrevLine')}
              onPress={() => playerRef.current?.prevTurn()}
              color={c.ink}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playback.playing ? t('podcastPause') : t('podcastPlay')}
              onPress={() => {
                setManualPinned(true);
                setTransportVisible(true);
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
              onPress={() => playerRef.current?.nextTurn()}
              color={c.ink}
            />
            <Control
              icon="nextEpisode"
              hint={t('podcastNextEpisode')}
              onPress={() => playerRef.current?.nextEpisode()}
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
            accessibilityLabel={t('podcastShowControls')}
            onPress={() => {
              setManualPinned(true);
              setTransportVisible(true);
            }}
            style={styles.handleTouch}
          >
            <View style={[styles.handleBar, { backgroundColor: c.border }]} />
          </Pressable>
        </Animated.View>
      </Animated.View>
      <PodcastSettingsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rate={playback.rate}
        onRate={(rate) => playerRef.current?.setRate(rate)}
        autoplay={playback.autoplay}
        onAutoplay={(value) => {
          playerRef.current?.setAutoplay(value);
          setManualPinned(false);
          if (!value) setTransportVisible(true);
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
}) {
  const mine = role === 'user';
  const valid =
    !!highlight &&
    highlight.length > 0 &&
    highlight.start >= 0 &&
    highlight.start < content.length;
  return (
    <View
      onLayout={(event) =>
        onLayout(
          index,
          event.nativeEvent.layout.y,
          event.nativeEvent.layout.height
        )
      }
      style={[styles.chatRow, mine ? styles.chatRowMine : styles.chatRowOther]}
    >
      {!mine ? (
        <CoachAvatar
          state={active && playing ? 'speaking' : 'idle'}
          mood="friendly"
          size={30}
        />
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
    </View>
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
  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
  anchorStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingLeft: 4,
    paddingRight: 14,
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
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lesson: { fontSize: 12, fontWeight: '600' },
  duration: { fontSize: 11.5 },
  episodeTitle: { fontSize: 19, fontWeight: '700', lineHeight: 25 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 1 },
  progressFill: { height: 3 },
  chat: { gap: 10, paddingTop: 4, paddingBottom: 8 },
  chatRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  chatRowMine: { justifyContent: 'flex-end' },
  chatRowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
  },
  bubbleMine: { borderBottomRightRadius: 5 },
  bubbleOther: { borderBottomLeftRadius: 5 },
  bubbleSpeaker: { fontSize: 10.5, fontWeight: '700' },
  bubbleText: { fontSize: 14.5, lineHeight: 21 },
  bubbleTranslation: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  stageSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  stageSettingsText: { fontSize: 11.5 },
  stripAction: { padding: 8 },
  transportShell: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  transportFull: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 76,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    justifyContent: 'center',
  },
  transportHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleTouch: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  handleBar: { width: 40, height: 4, borderRadius: 2 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 2,
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
  replay: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
});
