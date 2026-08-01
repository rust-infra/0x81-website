import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listDecks } from '../../lib/api';
import { useTheme } from '../../lib/theme-context';
import type { Deck } from '../../lib/types';

export default function DecksScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setError('');
        try {
          const data = await listDecks();
          if (!cancelled) setDecks(data);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.ink }]}>词库</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: c.accent }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => router.push(`/deck/${item.id}`)}
            >
              <View style={[styles.dot, { backgroundColor: item.color || c.accent }]} />
              <View style={styles.cardBody}>
                <Text style={[styles.deckName, { color: c.ink }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.deckDesc, { color: c.inkMuted }]} numberOfLines={1}>
                  {item.description || ''}
                </Text>
              </View>
              <Text style={[styles.count, { color: c.inkMuted }]}>{item.card_count}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  cardBody: { flex: 1, marginRight: 8 },
  deckName: { fontSize: 15, fontWeight: '600' },
  deckDesc: { fontSize: 11, marginTop: 2 },
  count: { fontSize: 12 },
});
