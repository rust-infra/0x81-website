import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Segmented from '../../components/Segmented';
import { CoachGlyph, CoachHeader } from '../../components/rehearse/CoachUi';
import {
  buildPodcastEpisodes,
  episodeMinutes,
  type PodcastEpisode,
} from '../../lib/podcast';
import {
  clearAudioCache,
  getSpeechSettings,
  saveSpeechSettings,
} from '../../lib/speech';
import {
  loadPodcastProgress,
  type PodcastProgress,
} from '../../lib/podcast-progress';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

type Deck = '第一册' | '第二册';

export default function PodcastScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [deck, setDeck] = useState<Deck>('第一册');
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [voiceProvider, setVoiceProvider] = useState('webspeech');
  const [resume, setResume] = useState<PodcastProgress | null>(null);
  const episodes = useMemo(() => buildPodcastEpisodes(deck), [deck]);
  const resumeEpisode = useMemo(() => {
    if (!resume) return undefined;
    return (
      episodes.find((episode) => episode.id === resume.episodeId) ??
      episodes[resume.episodeIndex]
    );
  }, [episodes, resume]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/rehearse');
  };

  useEffect(() => {
    getSpeechSettings()
      .then((settings) => {
        setCacheEnabled(!!settings.cacheEnabled);
        setVoiceProvider(settings.provider || 'webspeech');
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadPodcastProgress(deck)
        .then((progress) => {
          if (!cancelled) setResume(progress);
        })
        .catch(() => {
          if (!cancelled) setResume(null);
        });
      return () => {
        cancelled = true;
      };
    }, [deck])
  );

  const toggleCache = async (value: boolean) => {
    const settings = await getSpeechSettings();
    await saveSpeechSettings({ ...settings, cacheEnabled: value });
    setCacheEnabled(value);
    toast(t(value ? 'podcastCacheOn' : 'podcastCacheOff'));
  };

  const clearCache = async () => {
    const count = await clearAudioCache();
    toast(count > 0 ? t('podcastCacheCleared', { count }) : t('podcastCacheEmpty'));
  };
  const groups = useMemo(() => {
    const out: Array<{ key: string; title: string; number: number; track: PodcastEpisode['track']; items: PodcastEpisode[] }> = [];
    for (const episode of episodes) {
      const key = `${episode.track}-${episode.lessonNumber}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(episode);
      else
        out.push({
          key,
          title: episode.lessonTitle,
          number: episode.lessonNumber,
          track: episode.track,
          items: [episode],
        });
    }
    return out;
  }, [episodes]);

  const open = (episode: PodcastEpisode) => {
    router.push({
      pathname: '/rehearse/podcast-player',
      params: { scenarioId: episode.id, deck },
    });
  };

  const openResume = () => {
    if (!resumeEpisode || !resume) return;
    router.push({
      pathname: '/rehearse/podcast-player',
      params: {
        scenarioId: resumeEpisode.id,
        deck,
        turn: String(resume.turnIndex),
      },
    });
  };

  const deckOptions = [
    { key: '第一册' as const, label: t('englishDeck1') },
    { key: '第二册' as const, label: t('englishDeck2') },
  ];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={styles.shell}>
      <CoachHeader title={t('podcastTitle')} onBack={goBack} />
      <View style={styles.deckRow}>
        <Segmented options={deckOptions} value={deck} onChange={setDeck} style={styles.deckSegmented} />
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {resumeEpisode && resume ? (
          <Pressable
            accessibilityRole="button"
            onPress={openResume}
            style={[styles.resumeCard, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <View style={[styles.resumeDot, { backgroundColor: c.accentLight }]}>
              <CoachGlyph name="arrowRight" color={c.accent} size={16} />
            </View>
            <View style={styles.resumeBody}>
              <Text style={[styles.resumeLabel, { color: c.accent }]}>
                {t('podcastResume')}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.resumeTitle, { color: c.ink }]}
              >
                {resumeEpisode.title}
              </Text>
              <Text style={[styles.resumeMeta, { color: c.inkMuted }]}>
                {t('podcastLinePosition', {
                  current: Math.min(
                    resume.turnIndex + 1,
                    resumeEpisode.turns.length
                  ),
                  total: resumeEpisode.turns.length,
                })}
              </Text>
            </View>
            <CoachGlyph name="arrowRight" color={c.inkMuted} size={16} />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={episodes.length === 0}
          onPress={() => episodes[0] && open(episodes[0])}
          style={[
            styles.playAll,
            resumeEpisode
              ? { borderWidth: 1, borderColor: c.border, backgroundColor: c.card }
              : { backgroundColor: c.buttonBg },
          ]}
        >
          <Text
            style={[
              styles.playAllIcon,
              { color: resumeEpisode ? c.ink : c.buttonText },
            ]}
          >
            ▶
          </Text>
          <Text
            style={[
              styles.playAllText,
              { color: resumeEpisode ? c.ink : c.buttonText },
            ]}
          >
            {t(resumeEpisode ? 'podcastPlayAllFromStart' : 'podcastPlayAll')}
          </Text>
        </Pressable>

        {groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <Text style={[styles.lessonLabel, { color: c.inkMuted }]}>
              {group.track === 'tech' ? `${t('englishTech')} · ` : ''}Lesson {group.number} ·{' '}
              {group.title}
            </Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {group.items.map((episode) => (
                <Pressable
                  key={episode.id}
                  accessibilityRole="button"
                  onPress={() => open(episode)}
                  style={styles.episodeRow}
                >
                  <View style={[styles.playDot, { backgroundColor: c.accentLight }]}>
                    <CoachGlyph name="arrowRight" color={c.accent} size={15} />
                  </View>
                  <View style={styles.episodeBody}>
                    <Text style={[styles.episodeTitle, { color: c.ink }]} numberOfLines={2}>
                      {episode.title}
                    </Text>
                    <Text style={[styles.episodeMeta, { color: c.inkMuted }]}>
                      {episode.turns.length} {t('podcastTurns')} · ~{episodeMinutes(episode.turns)} min
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <View style={[styles.cacheCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cacheHead}>
            <View style={styles.cacheCopy}>
              <Text style={[styles.cacheTitle, { color: c.ink }]}>{t('podcastCacheTitle')}</Text>
              <Text style={[styles.cacheDesc, { color: c.inkMuted }]}>
                {t('podcastCacheDesc')}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t('podcastCacheTitle')}
              value={cacheEnabled}
              onValueChange={(value) => void toggleCache(value)}
              trackColor={{ false: c.border, true: c.accentLight }}
              thumbColor={cacheEnabled ? c.accent : c.inkMuted}
            />
          </View>
          {voiceProvider === 'webspeech' ? (
            <Text style={[styles.cacheHint, { color: c.inkMuted }]}>
              {t('podcastCacheNativeHint')}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => void clearCache()}
            style={[styles.cacheClear, { borderColor: c.border }]}
          >
            <Text style={[styles.cacheClearText, { color: c.ink }]}>
              {t('podcastCacheClear')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  shell: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  deckRow: { paddingHorizontal: 20, paddingBottom: 12 },
  deckSegmented: { alignSelf: 'flex-start', minWidth: 200 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
  },
  playAllIcon: { fontSize: 14 },
  playAllText: { fontSize: 14, fontWeight: '700' },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  resumeDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeBody: { flex: 1, minWidth: 0, gap: 2 },
  resumeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  resumeTitle: { fontSize: 13.5, fontWeight: '700' },
  resumeMeta: { fontSize: 11, fontVariant: ['tabular-nums'] },
  group: { gap: 7 },
  lessonLabel: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 4 },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  playDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  episodeBody: { flex: 1, gap: 2 },
  episodeTitle: { fontSize: 13.5, fontWeight: '600', lineHeight: 19 },
  episodeMeta: { fontSize: 11 },
  cacheCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  cacheHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cacheCopy: { flex: 1, gap: 5 },
  cacheTitle: { fontSize: 14, fontWeight: '700' },
  cacheDesc: { fontSize: 11.5, lineHeight: 17 },
  cacheHint: { fontSize: 11, lineHeight: 17 },
  cacheClear: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  cacheClearText: { fontSize: 12, fontWeight: '600' },
});
