import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Segmented from '../../components/Segmented';
import { CoachGlyph, CoachHeader } from '../../components/rehearse/CoachUi';
import { ENGLISH_LESSONS } from '../../lib/english-learning-data';
import { getCoachQuota } from '../../lib/rehearse-api-runtime';
import { canStartCoach } from '../../lib/rehearse-selection';
import type { CoachQuotaStatus, CoachScenario } from '../../lib/rehearse-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

type Deck = '第一册' | '第二册';

export default function EnglishLearningScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/rehearse');
  };
  const [deck, setDeck] = useState<Deck>('第一册');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [quota, setQuota] = useState<CoachQuotaStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      getCoachQuota()
        .then(setQuota)
        .catch(() => setQuota(null));
    }, [])
  );

  const start = (scenario: CoachScenario) => {
    if (quota) {
      const check = canStartCoach({ quota, scenario });
      if (!check.ok) {
        toast(t(check.reason === 'llm' ? 'coachUnavailableLLM' : 'coachQuotaTitle'));
        return;
      }
    }
    router.push({
      pathname: '/rehearse/session',
      params: { scenarioId: scenario.id, source: 'custom' },
    });
  };

  const lessons = ENGLISH_LESSONS.filter((lesson) => lesson.deck === deck);
  const main = lessons.filter((lesson) => lesson.track === 'main');
  const tech = lessons.filter((lesson) => lesson.track === 'tech');
  const deckOptions = [
    { key: '第一册' as const, label: t('englishDeck1') },
    { key: '第二册' as const, label: t('englishDeck2') },
  ];

  const renderLesson = (lesson: (typeof lessons)[number]) => {
    const open = !!expanded[lesson.id];
    return (
      <View key={lesson.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded((prev) => ({ ...prev, [lesson.id]: !prev[lesson.id] }))}
          style={styles.lessonHead}
        >
          <View style={styles.lessonTitleBlock}>
            <Text style={[styles.lessonNumber, { color: c.inkMuted }]}>Lesson {lesson.number}</Text>
            <Text style={[styles.lessonTitle, { color: c.ink, fontFamily: serif }]}>
              {lesson.title}
            </Text>
            {lesson.chinese ? (
              <Text style={[styles.lessonChinese, { color: c.inkMuted }]}>{lesson.chinese}</Text>
            ) : null}
          </View>
          <View style={styles.lessonMeta}>
            <Text style={[styles.metaText, { color: c.inkMuted }]}>
              {t('englishDialogueCount', { count: lesson.dialogues.length })}
            </Text>
            <Text style={[styles.chevron, { color: c.inkMuted }]}>{open ? '⌃' : '⌄'}</Text>
          </View>
        </Pressable>
        {open ? (
          <View style={[styles.dialogueList, { borderTopColor: c.divider }]}>
            {lesson.dialogues.map((dialogue) => (
              <Pressable
                key={dialogue.id}
                accessibilityRole="button"
                onPress={() => start(dialogue.scenario)}
                style={[styles.dialogueRow, { backgroundColor: c.inputBg }]}
              >
                <CoachGlyph name="chat" color={c.accent} size={16} />
                <Text style={[styles.dialogueText, { color: c.ink }]}>{dialogue.title}</Text>
                <CoachGlyph name="arrowRight" color={c.accent} size={15} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('englishLearningTitle')} onBack={goBack} />
      <View style={styles.deckRow}>
        <Segmented
          options={deckOptions}
          value={deck}
          onChange={setDeck}
          style={styles.deckSegmented}
        />
      </View>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {main.map(renderLesson)}
        {tech.length ? (
          <>
            <Text style={[styles.sectionLabel, { color: c.inkMuted }]}>{t('englishTech')}</Text>
            {tech.map(renderLesson)}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  deckRow: { paddingHorizontal: 20, paddingBottom: 12 },
  deckSegmented: { alignSelf: 'flex-start', minWidth: 200 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  lessonHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  lessonTitleBlock: { flex: 1, gap: 2 },
  lessonNumber: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  lessonTitle: { fontSize: 15, fontWeight: '600' },
  lessonChinese: { fontSize: 11.5 },
  lessonMeta: { alignItems: 'flex-end', gap: 4 },
  metaText: { fontSize: 11 },
  chevron: { fontSize: 14 },
  dialogueList: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  dialogueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  dialogueText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500' },
});
