import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listDecks, listStudyCards } from '../../lib/api';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';
import type { Deck, StudyCard } from '../../lib/types';

const STATUS_LABEL: Record<string, string> = {
  new: '新词',
  learning: '学习中',
  review: '复习中',
  relearning: '再学习',
};

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [decks, studyCards] = await Promise.all([
          listDecks(),
          id ? listStudyCards(id) : Promise.resolve([]),
        ]);
        if (!cancelled) {
          setDeck(decks.find((d) => d.id === id) || null);
          setCards(studyCards);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const filtered = query.trim()
    ? cards.filter((sc) =>
        `${sc.card.front} ${sc.card.back}`.toLowerCase().includes(query.trim().toLowerCase())
      )
    : cards;

  const statusColor = (status?: string): string => {
    switch (status) {
      case 'new':
        return '#2B6B4F';
      case 'learning':
        return '#B7791F';
      case 'review':
        return '#3B5A7A';
      case 'relearning':
        return '#A84040';
      default:
        return c.inkMuted;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: c.accent }]}>‹ 返回</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : deck ? (
        <View style={styles.body}>
          <View style={[styles.hero, { backgroundColor: deck.color || c.accent }]}>
            <Text style={[styles.heroName, { fontFamily: serif }]}>{deck.name}</Text>
            <Text style={styles.heroMeta}>{deck.card_count} 词</Text>
          </View>
          {deck.description ? (
            <Text style={[styles.desc, { color: c.inkMuted }]}>{deck.description}</Text>
          ) : null}
          <Pressable
            style={[styles.start, { backgroundColor: c.accent }]}
            onPress={() => router.push(`/study/${deck.id}`)}
          >
            <Text style={styles.startText}>开始学习</Text>
          </Pressable>

          <TextInput
            style={[styles.search, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
            placeholder="搜索卡片..."
            placeholderTextColor={c.inkMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.card.id}
            contentContainerStyle={styles.cardList}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: c.inkMuted }]}>暂无卡片</Text>
            }
            renderItem={({ item }) => {
              const status = item.progress?.srs_status;
              return (
                <View style={[styles.cardRow, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={styles.cardRowBody}>
                    <Text style={[styles.cardFront, { color: c.ink }]} numberOfLines={1}>
                      {item.card.front}
                    </Text>
                    <Text style={[styles.cardBack, { color: c.inkMuted }]} numberOfLines={2}>
                      {item.card.back}
                    </Text>
                  </View>
                  <View
                    style={[styles.badge, { backgroundColor: `${statusColor(status)}18` }]}
                  >
                    <Text style={[styles.badgeText, { color: statusColor(status) }]}>
                      {status ? STATUS_LABEL[status] || status : '未学'}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={{ color: c.inkMuted }}>词库不存在</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  back: { fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20 },
  hero: {
    borderRadius: 16,
    padding: 24,
  },
  heroName: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  heroMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 6 },
  desc: { fontSize: 13, marginTop: 12, lineHeight: 20 },
  start: {
    marginTop: 28,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  startText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  search: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  cardList: { paddingTop: 12, paddingBottom: 24 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardRowBody: { flex: 1, marginRight: 8 },
  cardFront: { fontSize: 15, fontWeight: '600' },
  cardBack: { fontSize: 12, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 13 },
});
