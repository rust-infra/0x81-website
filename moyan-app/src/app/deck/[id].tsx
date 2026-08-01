import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createCard,
  deleteCard,
  deleteDeck,
  listCards,
  listDecks,
  listStudyCards,
  updateCard,
  updateDeck,
} from '../../lib/api';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';
import type { Card, Deck, StudyCard } from '../../lib/types';

const STATUS_LABEL: Record<string, string> = {
  new: '新词',
  learning: '学习中',
  review: '复习中',
  relearning: '再学习',
};

interface CardForm {
  front: string;
  back: string;
  pronunciation: string;
  exampleEn: string;
  exampleZh: string;
}

const EMPTY_FORM: CardForm = {
  front: '',
  back: '',
  pronunciation: '',
  exampleEn: '',
  exampleZh: '',
};

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [studyCards, setStudyCards] = useState<StudyCard[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDeckEdit, setShowDeckEdit] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [deckDesc, setDeckDesc] = useState('');
  const [showCardModal, setShowCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [form, setForm] = useState<CardForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [decks, cardList, studyList] = await Promise.all([
        listDecks(),
        listCards(id),
        listStudyCards(id),
      ]);
      const d = decks.find((x) => x.id === id) || null;
      setDeck(d);
      setDeckName(d?.name || '');
      setDeckDesc(d?.description || '');
      setCards(cardList);
      setStudyCards(studyList);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const progressOf = (cardId: string) =>
    studyCards.find((sc) => sc.card.id === cardId)?.progress;

  const filtered = query.trim()
    ? cards.filter((card) =>
        `${card.front} ${card.back}`.toLowerCase().includes(query.trim().toLowerCase())
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

  const openCreate = () => {
    setEditingCard(null);
    setForm(EMPTY_FORM);
    setShowCardModal(true);
  };

  const openEdit = (card: Card) => {
    setEditingCard(card);
    setForm({
      front: card.front,
      back: card.back,
      pronunciation: card.pronunciation || '',
      exampleEn: card.examples?.[0]?.sentence_en || '',
      exampleZh: card.examples?.[0]?.translation_zh || '',
    });
    setShowCardModal(true);
  };

  const saveCard = async () => {
    if (!form.front.trim() || !form.back.trim() || !id) return;
    setSaving(true);
    try {
      const examples =
        form.exampleEn.trim() || form.exampleZh.trim()
          ? [
              {
                sentence_en: form.exampleEn.trim(),
                translation_zh: form.exampleZh.trim(),
              },
            ]
          : undefined;
      if (editingCard) {
        await updateCard(editingCard.id, {
          front: form.front.trim(),
          back: form.back.trim(),
          pronunciation: form.pronunciation.trim() || null,
          examples,
        });
      } else {
        await createCard(id, {
          front: form.front.trim(),
          back: form.back.trim(),
          pronunciation: form.pronunciation.trim() || undefined,
          examples,
        });
      }
      setShowCardModal(false);
      await load();
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeCard = (card: Card) => {
    Alert.alert('删除卡片', `确定删除「${card.front}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCard(card.id);
            setShowCardModal(false);
            await load();
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  const saveDeck = async () => {
    if (!id || !deckName.trim()) return;
    try {
      await updateDeck(id, {
        name: deckName.trim(),
        description: deckDesc.trim() || undefined,
      });
      setShowDeckEdit(false);
      await load();
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : String(err));
    }
  };

  const removeDeck = () => {
    if (!id || !deck) return;
    Alert.alert('删除词库', `确定删除「${deck.name}」及其卡片吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDeck(id);
            router.replace('/decks');
          } catch (err) {
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: c.accent }]}>‹ 返回</Text>
        </Pressable>
        {deck ? (
          <Pressable onPress={() => setShowDeckEdit(true)} hitSlop={12}>
            <Text style={{ color: c.inkLight }}>编辑</Text>
          </Pressable>
        ) : null}
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

          <View style={styles.actions}>
            <Pressable
              style={[styles.start, { backgroundColor: c.accent }]}
              onPress={() => router.push(`/study/${deck.id}`)}
            >
              <Text style={styles.startText}>开始学习</Text>
            </Pressable>
            <Pressable
              style={[styles.addCard, { backgroundColor: c.buttonBg }]}
              onPress={openCreate}
            >
              <Text style={{ color: c.buttonText }}>＋ 添加卡片</Text>
            </Pressable>
          </View>

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
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.cardList}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: c.inkMuted }]}>暂无卡片</Text>
            }
            renderItem={({ item }) => {
              const status = progressOf(item.id)?.srs_status;
              return (
                <Pressable
                  style={[styles.cardRow, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => openEdit(item)}
                >
                  <View style={styles.cardRowBody}>
                    <Text style={[styles.cardFront, { color: c.ink }]} numberOfLines={1}>
                      {item.front}
                    </Text>
                    <Text style={[styles.cardBack, { color: c.inkMuted }]} numberOfLines={2}>
                      {item.back}
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: `${statusColor(status)}18` }]}>
                    <Text style={[styles.badgeText, { color: statusColor(status) }]}>
                      {status ? STATUS_LABEL[status] || status : '未学'}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={{ color: c.inkMuted }}>词库不存在</Text>
        </View>
      )}

      {/* 词库编辑 */}
      <Modal visible={showDeckEdit} transparent animationType="slide" onRequestClose={() => setShowDeckEdit(false)}>
        <Pressable style={styles.mask} onPress={() => setShowDeckEdit(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serif }]}>编辑词库</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder="名称"
              placeholderTextColor={c.inkMuted}
              value={deckName}
              onChangeText={setDeckName}
            />
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder="描述"
              placeholderTextColor={c.inkMuted}
              value={deckDesc}
              onChangeText={setDeckDesc}
            />
            <Pressable style={[styles.createBtn, { backgroundColor: c.buttonBg }]} onPress={saveDeck}>
              <Text style={{ color: c.buttonText, fontWeight: '600' }}>保存</Text>
            </Pressable>
            <Pressable onPress={removeDeck} style={styles.deleteDeck}>
              <Text style={{ color: c.accent }}>删除词库</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 卡片编辑 */}
      <Modal visible={showCardModal} transparent animationType="slide" onRequestClose={() => setShowCardModal(false)}>
        <Pressable style={styles.mask} onPress={() => setShowCardModal(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serif }]}>
              {editingCard ? '编辑卡片' : '添加卡片'}
            </Text>
            <ScrollView>
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder="单词 / 正面"
                placeholderTextColor={c.inkMuted}
                value={form.front}
                onChangeText={(v) => setForm((f) => ({ ...f, front: v }))}
              />
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder="释义 / 背面"
                placeholderTextColor={c.inkMuted}
                value={form.back}
                onChangeText={(v) => setForm((f) => ({ ...f, back: v }))}
              />
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder="音标（可选）"
                placeholderTextColor={c.inkMuted}
                value={form.pronunciation}
                onChangeText={(v) => setForm((f) => ({ ...f, pronunciation: v }))}
              />
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder="例句 EN（可选）"
                placeholderTextColor={c.inkMuted}
                value={form.exampleEn}
                onChangeText={(v) => setForm((f) => ({ ...f, exampleEn: v }))}
              />
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
                placeholder="例句 中文（可选）"
                placeholderTextColor={c.inkMuted}
                value={form.exampleZh}
                onChangeText={(v) => setForm((f) => ({ ...f, exampleZh: v }))}
              />
            </ScrollView>
            <Pressable
              style={[styles.createBtn, { backgroundColor: c.buttonBg, opacity: saving ? 0.6 : 1 }]}
              onPress={saveCard}
            >
              <Text style={{ color: c.buttonText, fontWeight: '600' }}>{saving ? '保存中...' : '保存'}</Text>
            </Pressable>
            {editingCard ? (
              <Pressable onPress={() => removeCard(editingCard)} style={styles.deleteDeck}>
                <Text style={{ color: c.accent }}>删除卡片</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: { fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, flex: 1 },
  hero: {
    borderRadius: 16,
    padding: 24,
  },
  heroName: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  heroMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 6 },
  desc: { fontSize: 13, marginTop: 12, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  start: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  startText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  addCard: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
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
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },
  cardRowBody: { flex: 1, marginRight: 8 },
  cardFront: { fontSize: 15, fontWeight: '600' },
  cardBack: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 13 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
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
  deleteDeck: { alignItems: 'center', paddingVertical: 14 },
});
