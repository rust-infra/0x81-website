import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Polygon, Rect } from 'react-native-svg';
import Segmented from '../../components/Segmented';
import { CoachAvatar } from '../../components/rehearse/CoachAvatar';
import { CoachHeader } from '../../components/rehearse/CoachUi';
import { useAuth } from '../../lib/auth';
import { getApiBase } from '../../lib/config';
import {
  buildPodcastEpisodes,
  createPodcastPlayer,
  episodeMinutes,
  type PodcastPlayer,
  type PodcastState,
} from '../../lib/podcast';
import {
  loadPodcastPoster,
  resolvePodcastClipSource,
  type PodcastClipSource,
} from '../../lib/podcast-video';
import { requestPodcastClip } from '../../lib/rehearse-api-runtime';
import { speak, stopSpeaking } from '../../lib/speech';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

const RATES = ['0.9', '1.0', '1.2'] as const;

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
  });
  const [playback, setPlayback] = useState<PodcastState>({
    episodeIndex: initialIndex,
    turnIndex: 0,
    playing: false,
    rate: 1,
    autoplay: true,
  });
  const playerRef = useRef<PodcastPlayer | null>(null);

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
    await stopSpeaking();
  };

  const playTurn = async (
    text: string,
    opts: { rate: number; language?: string }
  ) => {
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
    await speak(text, opts);
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
    return () => {
      onEnd.remove();
      onStatus.remove();
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
    const player = playerRef.current;
    if (!player || episodes.length === 0) return;
    player.play(initialIndexRef.current);
    return () => {
      player.pause();
      void stopSpeaking();
    };
  }, [episodes.length]);

  const episode = episodes[playback.episodeIndex];
  const turn = episode?.turns[playback.turnIndex];
  const speaker =
    turn?.role === 'user' ? t('podcastYou') : episode?.coachName || t('podcastCoach');
  const anchorName = t('podcastAnchorName');
  const progress =
    episode && episode.turns.length > 0
      ? (playback.turnIndex + 1) / episode.turns.length
      : 0;
  const atEpisodeEnd =
    !!episode &&
    !playback.playing &&
    playback.turnIndex === episode.turns.length - 1;

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

  const rateOptions = RATES.map((rate) => ({
    key: rate,
    label: `${rate}×`,
  }));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('podcastTitle')} onBack={goBack} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
              <StageChevron up={false} color={c.inkMuted} />
            </>
          )}
        </Pressable>

        <View style={[styles.nowCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.lineHead}>
            <Text style={[styles.speaker, { color: c.accent }]}>{speaker}</Text>
            <Text style={[styles.progressText, { color: c.inkMuted }]}>
              {episode ? `${playback.turnIndex + 1} / ${episode.turns.length}` : '0 / 0'} ·{' '}
              {playback.episodeIndex + 1} / {episodes.length}
            </Text>
          </View>
          <Text numberOfLines={5} style={[styles.line, { color: c.ink }]}>
            {turn?.content ?? t('podcastEmpty')}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: c.accent, width: `${progress * 100}%` },
              ]}
            />
          </View>
        </View>

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
            onPress={() => playerRef.current?.toggle()}
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

        {atEpisodeEnd ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => playerRef.current?.play(playback.episodeIndex)}
            style={[styles.replay, { borderColor: c.border }]}
          >
            <Text style={{ color: c.ink, fontWeight: '700' }}>{t('podcastReplay')}</Text>
          </Pressable>
        ) : null}

        <View style={styles.settingsRow}>
          <Text style={[styles.settingLabel, { color: c.inkMuted }]}>{t('podcastSpeed')}</Text>
          <Segmented
            options={rateOptions}
            value={
              RATES.includes(playback.rate.toFixed(1) as (typeof RATES)[number])
                ? (playback.rate.toFixed(1) as (typeof RATES)[number])
                : '1.0'
            }
            onChange={(rate) => playerRef.current?.setRate(Number(rate))}
            style={styles.rateSegmented}
          />
        </View>
        <View style={styles.settingsRow}>
          <Text style={[styles.settingLabel, { color: c.inkMuted }]}>
            {t('podcastAutoplay')}
          </Text>
          <Switch
            value={playback.autoplay}
            onValueChange={(value) => playerRef.current?.setAutoplay(value)}
            trackColor={{ false: c.border, true: c.accentLight }}
            thumbColor={playback.autoplay ? c.accent : c.inkMuted}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={generating || !episode}
          onPress={() => void generateEpisode()}
          style={[styles.generate, { borderColor: c.border, backgroundColor: c.card }]}
        >
          <Text style={[styles.generateText, { color: c.ink }]}>
            {generating ? t('podcastGenerating') : t('podcastGenerateEpisode')}
          </Text>
        </Pressable>
        <Text style={[styles.hint, { color: c.inkMuted }]}>{t('podcastForegroundHint')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  nowCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 7 },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  speaker: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5 },
  line: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 1 },
  progressFill: { height: 3 },
  progressText: { fontSize: 10.5, fontVariant: ['tabular-nums'] },
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
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 1,
  },
  settingLabel: { fontSize: 12.5 },
  rateSegmented: { minWidth: 156 },
  generate: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    marginTop: 6,
  },
  generateText: { fontSize: 12, fontWeight: '600' },
  hint: { fontSize: 10, textAlign: 'center', marginTop: 6, lineHeight: 15 },
});
