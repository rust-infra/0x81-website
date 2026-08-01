import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getStudyQueue, listDecks } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';
import type { Deck } from '../../lib/types';

function formatDate(lang: 'zh-CN' | 'en') {
  const d = new Date();
  if (lang === 'zh-CN') {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${'日一二三四五六'[d.getDay()]}`;
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' });
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [stats, setStats] = useState<{
    due: number;
    fresh: number;
    total: number;
    today: number;
  } | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const queue = await getStudyQueue();
          const decks = await listDecks();
          if (!cancelled) {
            setStats({
              due: queue.due_count,
              fresh: queue.new_count,
              total: queue.total_cards,
              today: queue.today_reviewed,
            });
            setDecks(decks);
          }
        } catch {
          // ignore
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const progress = stats && stats.total > 0
    ? Math.min(100, Math.round(((stats.total - stats.fresh) / stats.total) * 100))
    : 0;
  const thirtyDayDecks = decks.filter((d) => d.name === '30天词汇');
  const otherDecks = decks.filter((d) => d.name !== '30天词汇');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: c.ink, fontFamily: serif }]}>
          {t('greeting')}，{user?.name?.split(' ')[0] || 'User'}。
        </Text>
        <Text style={[styles.date, { color: c.inkLight }]}>
          {formatDate(lang)} · {t('dailyDue', { count: stats?.due ?? 0 })}
        </Text>
      </View>

      {!stats ? (
        <ActivityIndicator color={c.accent} style={styles.center} />
      ) : (
        <View style={styles.body}>
          <View style={[styles.progressCard, { backgroundColor: c.buttonBg }]}>
            <View style={styles.progressRow}>
              <View>
                <Text style={styles.progressLabel}>{t('totalWords')}</Text>
                <Text style={styles.progressValue}>{progress}%</Text>
              </View>
              <View style={styles.progressRight}>
                <Text style={styles.progressLabel}>{t('todayReview')}</Text>
                <Text style={styles.progressToday}>{stats.today} {t('wordUnit')}</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.cta, { backgroundColor: c.buttonBg }]}
            onPress={() => setShowPicker(true)}
          >
            <Text style={styles.ctaTitle}>{t('dailyRequired')}</Text>
            <Text style={styles.ctaDesc}>
              {stats.due > 0
                ? t('dailyDue', { count: stats.due })
                : t('dailyDone')}
            </Text>
            <Text style={styles.ctaGo}>{t('chooseDeck')}</Text>
          </Pressable>

          <View style={styles.grid}>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.due}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('due')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.fresh}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('new')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.total}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('totalWords')}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.card }]}>
              <Text style={[styles.statValue, { color: c.ink }]}>{stats.today}</Text>
              <Text style={[styles.statLabel, { color: c.inkLight }]}>{t('todayReview')}</Text>
            </View>
          </View>
        </View>
      )}

      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={styles.mask} onPress={() => setShowPicker(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.paper }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serif }]}>
              {t('chooseDeck')}
            </Text>
            <FlatList
              data={['30天', '其他']}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const list = item === '30天' ? thirtyDayDecks : otherDecks;
                if (list.length === 0) return null;
                return (
                  <View style={{ marginBottom: 14 }}>
                    {item === '30天' ? (
                      <Text style={[styles.groupTitle, { color: c.inkLight }]}>30天词汇</Text>
                    ) : null}
                    {list.map((deck) => (
                      <Pressable
                        key={deck.id}
                        style={[styles.deckRow, { backgroundColor: c.card }]}
                        onPress={() => {
                          setShowPicker(false);
                          router.push(`/study/${deck.id}`);
                        }}
                      >
                        <View style={[styles.deckDot, { backgroundColor: deck.color || c.accent }]} />
                        <Text style={[styles.deckName, { color: c.ink }]} numberOfLines={1}>
                          {deck.name}
                        </Text>
                        <Text style={{ color: c.inkMuted, fontSize: 12 }}>{deck.card_count}</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 20 },
  greeting: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  date: { fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20 },
  progressCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginBottom: 4 },
  progressValue: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', fontFamily: serif },
  progressRight: { alignItems: 'flex-end' },
  progressToday: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  cta: {
    borderRadius: 24,
    padding: 22,
    marginBottom: 16,
  },
  ctaTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', fontFamily: serif },
  ctaDesc: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 6 },
  ctaGo: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 18, fontWeight: '500' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '47.5%',
    borderRadius: 16,
    padding: 16,
  },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 4 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '75%',
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  groupTitle: { fontSize: 12, fontWeight: '500', marginBottom: 8 },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 10,
  },
  deckDot: { width: 10, height: 10, borderRadius: 5 },
  deckName: { flex: 1, fontSize: 15, fontWeight: '500' },
});
