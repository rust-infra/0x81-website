import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBase } from '../../lib/config';
import { resolvePodcast } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { saveRecent } from '../../lib/podcast';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';
import type { PodcastResolved, TimedCaption } from '../../lib/types';

export default function PodcastPlayerScreen() {
  const params = useLocalSearchParams<{
    url?: string;
    title?: string;
    channel?: string;
    thumbnail?: string;
  }>();
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [data, setData] = useState<PodcastResolved | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [activeIdx, setActiveIdx] = useState(0);
  const playerRef = useRef<AudioPlayer | null>(null);
  const listRef = useRef<FlatList<TimedCaption>>(null);

  useEffect(() => {
    if (!params.url) {
      setError(t('podcastNoCaptions'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolvePodcast(params.url!);
        if (cancelled) return;
        setData(resolved);
        void saveRecent({
          id: resolved.video_id,
          title: resolved.title,
          channel: resolved.channel || params.channel || '',
          thumbnail: resolved.thumbnail || params.thumbnail || null,
          url: params.url!,
          at: Date.now(),
        });
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
        const player = createAudioPlayer(
          `${getApiBase()}${resolved.audio_url}`
        );
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
          if (typeof status.currentTime === 'number') {
            setCurrentMs(status.currentTime * 1000);
          }
          if (typeof status.duration === 'number') {
            setDurationMs(status.duration * 1000);
          }
          setPlaying(!!status.playing);
        });
        try {
          player.setActiveForLockScreen(true, {
            title: resolved.title,
            artist: resolved.channel || 'YouTube',
          });
        } catch {
          // lock screen controls unavailable on this platform
        }
        player.play();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      playerRef.current?.pause();
      try {
        playerRef.current?.release();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [params.url, t]);

  useEffect(() => {
    if (!data || data.captions.length === 0) return;
    const idx = data.captions.findIndex(
      (cap) => currentMs >= cap.start_ms && currentMs < cap.end_ms
    );
    if (idx >= 0 && idx !== activeIdx) {
      setActiveIdx(idx);
      listRef.current?.scrollToIndex({
        index: idx,
        viewPosition: 0.5,
        animated: true,
      });
    }
  }, [currentMs, data, activeIdx]);

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.pause();
    else player.play();
  };

  const jumpTo = (idx: number) => {
    const cap = data?.captions[idx];
    if (!cap) return;
    setActiveIdx(idx);
    playerRef.current?.seekTo(Math.max(cap.start_ms / 1000, 0));
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.25 : speed === 1.25 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    playerRef.current?.setPlaybackRate(next);
  };

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]}>
        <ActivityIndicator color={c.accent} style={styles.center} />
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]}>
        <View style={styles.center}>
          <Text style={{ color: c.accent, textAlign: 'center', paddingHorizontal: 30 }}>
            {error || t('podcastNoCaptions')}
          </Text>
          <Pressable
            style={[styles.backBtn, { backgroundColor: c.buttonBg }]}
            onPress={() => router.back()}
          >
            <Text style={{ color: c.buttonText }}>{t('back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const progressPct =
    durationMs > 0 ? Math.min((currentMs / durationMs) * 100, 100) : 0;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.paper }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: c.inkMuted, fontSize: 18 }}>‹ {t('back')}</Text>
        </Pressable>
        <Pressable style={[styles.speedBtn, { borderColor: c.border }]} onPress={cycleSpeed}>
          <Text style={{ color: c.inkLight, fontSize: 12 }}>{speed.toFixed(2).replace(/0$/, '')}×</Text>
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: c.ink, fontFamily: serif }]} numberOfLines={2}>
          {data.title}
        </Text>
        {data.channel ? (
          <Text style={[styles.channel, { color: c.inkMuted }]}>{data.channel}</Text>
        ) : null}
        <View style={[styles.bgBadge, { backgroundColor: `${c.accent}18` }]}>
          <Text style={{ color: c.accent, fontSize: 11 }}>{t('podcastBackground')}</Text>
        </View>
      </View>

      <View style={styles.progressArea}>
        <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
          <View
            style={[styles.progressFill, { backgroundColor: c.progressBar, width: `${progressPct}%` }]}
          />
        </View>
        <View style={styles.timeRow}>
          <Text style={{ color: c.inkMuted, fontSize: 11 }}>{fmt(currentMs)}</Text>
          <Text style={{ color: c.inkMuted, fontSize: 11 }}>
            {data.duration_sec ? fmt(data.duration_sec * 1000) : fmt(durationMs)}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => jumpTo(Math.max(0, activeIdx - 1))} hitSlop={10}>
          <Text style={{ color: c.ink, fontSize: 22 }}>⏮</Text>
        </Pressable>
        <Pressable
          style={[styles.play, { backgroundColor: c.buttonBg }]}
          onPress={togglePlay}
        >
          <Text style={{ color: c.buttonText, fontSize: 24 }}>{playing ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            jumpTo(Math.min(data.captions.length - 1, activeIdx + 1))
          }
          hitSlop={10}
        >
          <Text style={{ color: c.ink, fontSize: 22 }}>⏭</Text>
        </Pressable>
      </View>

      <Text style={[styles.subsLabel, { color: c.inkMuted }]}>
        {t('podcastSubsLabel')}
      </Text>
      <FlatList
        ref={listRef}
        data={data.captions}
        keyExtractor={(item, i) => `${item.start_ms}-${i}`}
        contentContainerStyle={styles.subsList}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => {
          const active = index === activeIdx;
          return (
            <Pressable
              style={[
                styles.sub,
                active && { backgroundColor: `${c.accent}18` },
              ]}
              onPress={() => jumpTo(index)}
            >
              <Text style={[styles.subTime, { color: c.inkMuted }]}>{fmt(item.start_ms)}</Text>
              <Text
                style={[
                  styles.subText,
                  { color: active ? c.ink : c.inkLight },
                  active && { fontWeight: '600' },
                ]}
              >
                {item.text}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  backBtn: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 32 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  speedBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  titleBlock: { paddingHorizontal: 20, paddingTop: 10 },
  title: { fontSize: 19, fontWeight: '700', lineHeight: 26 },
  channel: { fontSize: 12, marginTop: 4 },
  bgBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
  },
  progressArea: { paddingHorizontal: 20, paddingTop: 20 },
  progressTrack: { height: 5, borderRadius: 3 },
  progressFill: { height: '100%', borderRadius: 3 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 30,
    paddingVertical: 12,
  },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subsLabel: { fontSize: 12, paddingHorizontal: 20, paddingBottom: 6 },
  subsList: { paddingHorizontal: 16, paddingBottom: 30 },
  sub: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  subTime: { fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  subText: { flex: 1, fontSize: 14, lineHeight: 20 },
});
