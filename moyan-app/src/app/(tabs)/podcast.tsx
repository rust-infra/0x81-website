import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAppConfig } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { loadRecent, type RecentItem } from '../../lib/podcast';
import { useTheme } from '../../lib/theme-context';
import { screen, serif } from '../../lib/ui';

interface SearchItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
}

export default function PodcastScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'home' | 'results'>('home');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false);
  const apiKeyRef = useRef('');

  useEffect(() => {
    getAppConfig()
      .then((cfg) => {
        apiKeyRef.current = cfg.podcast?.youtube_api_key || '';
        setDisabled(cfg.podcast ? !cfg.podcast.enabled : false);
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecent().then(setRecent);
    }, [])
  );

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    if (!apiKeyRef.current) {
      setError(t('podcastNoKey'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(
        q
      )}&key=${encodeURIComponent(apiKeyRef.current)}`;
      const res = await fetch(url);
      const body = await res.json();
      const items: SearchItem[] = (body.items || [])
        .map((it: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> } }) => ({
          id: it.id?.videoId || '',
          title: it.snippet?.title || '',
          channel: it.snippet?.channelTitle || '',
          thumbnail:
            it.snippet?.thumbnails?.high?.url ||
            it.snippet?.thumbnails?.default?.url ||
            null,
        }))
        .filter((i: SearchItem) => i.id);
      setResults(items);
      setMode('results');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openPlayer = (item: SearchItem, url: string) => {
    router.push({
      pathname: '/podcast/player',
      params: {
        url,
        title: item.title,
        channel: item.channel,
        thumbnail: item.thumbnail || '',
      },
    });
  };

  const renderCard = (item: SearchItem, url: string) => (
    <Pressable
      key={item.id}
      style={[styles.card, { backgroundColor: c.card }]}
      onPress={() => openPlayer(item, url)}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={{ fontSize: 18 }}>🎙️</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.title, { color: c.ink }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.meta, { color: c.inkMuted }]} numberOfLines={1}>
          {item.channel}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      {disabled ? (
        <View style={styles.center}>
          <Text style={[styles.empty, { color: c.inkMuted }]}>{t('podcastDisabled')}</Text>
        </View>
      ) : mode === 'home' ? (
        <>
          <View style={screen.header}>
            <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
              {t('tabPodcast')}
            </Text>
          </View>
          <View style={styles.search}>
            <View style={styles.searchField}>
              <Text style={[styles.searchIcon, { color: c.inkMuted }]}>🔍</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder={t('podcastSearchPlaceholder')}
                placeholderTextColor={c.inkMuted}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={search}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Pressable style={[styles.searchBtn, { backgroundColor: c.buttonBg }]} onPress={search}>
              <Text style={{ color: c.buttonText }}>{t('search')}</Text>
            </Pressable>
          </View>
          {error ? (
            <Text style={[styles.error, { color: c.accent }]}>{error}</Text>
          ) : null}
          <Text style={[styles.sectionLabel, { color: c.inkLight }]}>{t('podcastRecent')}</Text>
          <FlatList
            data={recent}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => renderCard(item, item.url)}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: c.inkMuted }]}>
                {t('podcastRecentEmpty')}
              </Text>
            }
          />
        </>
      ) : (
        <>
          <View style={styles.resultsHead}>
            <Pressable
              style={[styles.back, { borderColor: c.border, backgroundColor: c.card }]}
              onPress={() => {
                setMode('home');
                setError('');
              }}
            >
              <Text style={{ color: c.ink }}>‹</Text>
            </Pressable>
            <Text style={[styles.resultsTitle, { color: c.ink }]}>
              {t('podcastSearchResults')}
            </Text>
          </View>
          {loading ? (
            <ActivityIndicator color={c.accent} style={styles.center} />
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) =>
                renderCard(item, `https://www.youtube.com/watch?v=${item.id}`)
              }
              ListEmptyComponent={
                <Text style={[styles.empty, { color: c.inkMuted }]}>
                  {t('podcastNoResults')}
                </Text>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 20 },
  searchField: { flex: 1, position: 'relative' },
  searchIcon: { position: 'absolute', left: 14, top: 14, fontSize: 15, zIndex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 12,
    paddingLeft: 38,
    paddingRight: 14,
    fontSize: 14,
  },
  searchBtn: {
    width: 56,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { fontSize: 12, paddingHorizontal: 22, marginTop: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '500', padding: 18, paddingBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 110 },
  card: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  thumb: { width: 110, height: 62, borderRadius: 8 },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8c3b3b',
  },
  cardBody: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  meta: { fontSize: 11, marginTop: 4 },
  empty: { textAlign: 'center', paddingVertical: 40, fontSize: 13 },
  resultsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsTitle: { fontSize: 17, fontWeight: '700' },
});
