import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../lib/i18n';
import { podcastPlayer } from '../lib/podcast-player';
import { useTheme } from '../lib/theme-context';

/**
 * Floating mini player shown on every screen while a podcast is loaded. It
 * displays the currently playing subtitle (with Chinese translation when
 * available) and re-opens the player page on tap, so playback stays visible
 * even after leaving the player.
 */
export default function PodcastMiniPlayer() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [en, setEn] = useState('');
  const [zh, setZh] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    const unsub = podcastPlayer.subscribe(() => {
      const src = podcastPlayer.getSource();
      const cap = podcastPlayer.getActiveCaption();
      setVisible(!!src && !pathname.startsWith('/podcast/player'));
      setPlaying(podcastPlayer.getSnapshot().playing);
      setEn(cap?.en || '');
      setZh(cap?.zh || '');
      setTitle(src?.title || '');
    });
    return unsub;
  }, [pathname]);

  if (!visible) return null;

  const openPlayer = () => {
    const src = podcastPlayer.getSource();
    if (!src) return;
    router.push({
      pathname: '/podcast/player',
      params: {
        url: src.youtubeUrl,
        title: src.title,
        channel: src.channel,
      },
    });
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        style={[
          styles.card,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            shadowColor: '#000',
          },
        ]}
        onPress={openPlayer}
      >
        <Pressable
          style={[styles.playBtn, { backgroundColor: c.buttonBg }]}
          onPress={(e) => {
            e.stopPropagation();
            podcastPlayer.togglePlay();
          }}
          hitSlop={6}
        >
          <Text style={{ color: c.buttonText, fontSize: 15 }}>
            {playing ? '⏸' : '▶'}
          </Text>
        </Pressable>
        <View style={styles.body}>
          {en ? (
            <Text style={[styles.en, { color: c.ink }]} numberOfLines={1}>
              {en}
            </Text>
          ) : (
            <Text style={[styles.en, { color: c.inkLight }]} numberOfLines={1}>
              {title || t('tabPodcast')}
            </Text>
          )}
          {zh ? (
            <Text style={[styles.zh, { color: c.inkMuted }]} numberOfLines={1}>
              {zh}
            </Text>
          ) : null}
        </View>
        <Text style={{ color: c.inkMuted, fontSize: 13, marginLeft: 4 }}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingBottom: 92,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  en: { fontSize: 13, fontWeight: '600' },
  zh: { fontSize: 12 },
});
