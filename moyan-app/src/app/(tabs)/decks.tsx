import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createDeck, deleteDeck, listDecks } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { confirmAsync, useToast } from '../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../lib/ui';
import type { Deck } from '../../lib/types';

export default function DecksScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const c = theme.colors;
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

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
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const systemDecks = decks.filter((d) => d.owner_user_id === 'system');
  const myDecks = decks.filter((d) => d.owner_user_id !== 'system');

  const renderDeck = (deck: Deck) => (
    <Pressable
      key={deck.id}
      style={cardStyle(c.card)}
      onPress={() => router.push(`/deck/${deck.id}`)}
    >
      <View style={styles.deckRow}>
        <View style={[styles.dot, { backgroundColor: deck.color || '#2B2B2B' }]} />
        <View style={styles.deckBody}>
          <Text style={[styles.deckName, { color: c.ink }]} numberOfLines={1}>
            {deck.name}
          </Text>
          {deck.description ? (
            <Text style={[styles.deckDesc, { color: c.inkLight }]} numberOfLines={1}>
              {deck.description}
            </Text>
          ) : null}
          <Text style={[styles.deckCount, { color: c.inkLight }]}>
            {deck.card_count} {t('wordUnit')}
          </Text>
        </View>
        {deck.owner_user_id !== 'system' ? (
          <Pressable
            hitSlop={10}
            onPress={() => handleDelete(deck)}
          >
            <Text style={{ color: c.inkMuted, fontSize: 16 }}>🗑</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );

  const handleDelete = (deck: Deck) => {
    void confirmAsync(t('delete'), `确定删除「${deck.name}」吗？`).then(async (ok) => {
      if (!ok) return;
      try {
        await deleteDeck(deck.id);
        setDecks((prev) => prev.filter((d) => d.id !== deck.id));
        toast(t('saved'));
      } catch (err) {
        toast(`${t('syncFailed')}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createDeck({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        color: '#2B2B2B',
      });
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      const data = await listDecks();
      setDecks(data);
    } catch (err) {
      toast(`${t('syncFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <View style={styles.titleRow}>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('tabDecks')}
          </Text>
          <Pressable
            style={[roundButton, { backgroundColor: c.buttonBg }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={{ color: c.buttonText, fontSize: 18 }}>＋</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: c.accent }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={[{ key: 'system' }, { key: 'mine' }]}
          keyExtractor={(item) => item.key}
          contentContainerStyle={[screen.body, styles.list]}
          renderItem={({ item }) => {
            const list = item.key === 'system' ? systemDecks : myDecks;
            return (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: c.inkLight }]}>
                  {item.key === 'system' ? t('systemDecks') : t('myDecks')}
                </Text>
                {list.map(renderDeck)}
                {list.length === 0 && (
                  <Text style={[styles.empty, { color: c.inkLight }]}>{t('noDecks')}</Text>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal
        visible={showCreate}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <Pressable style={styles.mask} onPress={() => setShowCreate(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serif }]}>{t('newDeck')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder={t('deckNamePlaceholder')}
              placeholderTextColor={c.inkMuted}
              value={newName}
              onChangeText={setNewName}
            />
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder={t('deckDescPlaceholder')}
              placeholderTextColor={c.inkMuted}
              value={newDesc}
              onChangeText={setNewDesc}
            />
            <Pressable style={[styles.createBtn, { backgroundColor: c.buttonBg }]} onPress={handleCreate}>
              <Text style={{ color: c.buttonText, fontWeight: '600' }}>{t('create')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  list: { paddingBottom: 100 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '500', marginBottom: 12 },
  deckRow: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, marginRight: 10 },
  deckBody: { flex: 1 },
  deckName: { fontSize: 15, fontWeight: '500' },
  deckDesc: { fontSize: 12, marginTop: 2 },
  deckCount: { fontSize: 11, marginTop: 6 },
  empty: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  createBtn: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
});
