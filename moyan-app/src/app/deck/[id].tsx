import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listDecks } from '../../lib/api';
import { useTheme } from '../../lib/theme-context';
import type { Deck } from '../../lib/types';

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decks = await listDecks();
        if (!cancelled) setDeck(decks.find((d) => d.id === id) || null);
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
            <Text style={styles.heroName}>{deck.name}</Text>
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
});
