import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachFeedback } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';

export function FeedbackPanel({
  feedback,
  onSpeak,
}: {
  feedback?: CoachFeedback | null;
  onSpeak: (text: string) => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (feedback?.corrections.length) setOpen(true);
  }, [feedback]);

  if (!feedback) return null;

  return (
    <View style={[styles.card, { backgroundColor: c.studyCard, borderColor: c.border }]}>
      <Pressable style={styles.header} onPress={() => setOpen((value) => !value)}>
        <Text style={{ color: c.studyText, fontWeight: '700' }}>{t('coachCorrections')}</Text>
        <Text style={{ color: c.studyMuted }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {feedback.corrections.map((item) => (
            <View key={`${item.original}-${item.corrected}`} style={styles.row}>
              <Text style={{ color: c.studyMuted, textDecorationLine: 'line-through' }}>
                {item.original}
              </Text>
              <Text style={{ color: c.studyText, marginTop: 3 }}>{item.corrected}</Text>
              {item.explanation_zh ? (
                <Text style={{ color: c.studyMuted, fontSize: 12, marginTop: 3 }}>
                  {item.explanation_zh}
                </Text>
              ) : null}
            </View>
          ))}
          {feedback.better_phrasing ? (
            <View style={styles.row}>
              <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>
                {t('coachBetterPhrasing')}
              </Text>
              <Pressable
                style={styles.speakRow}
                onPress={() => onSpeak(feedback.better_phrasing?.natural ?? '')}
              >
                <Text style={{ color: c.studyText, flex: 1 }}>
                  {feedback.better_phrasing.natural}
                </Text>
                <Text style={{ color: c.accent }}>{t('coachReplay')}</Text>
              </Pressable>
            </View>
          ) : null}
          {feedback.expressions.length ? (
            <View style={styles.row}>
              <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>
                {t('coachExpressions')}
              </Text>
              {feedback.expressions.map((expression) => (
                <Pressable
                  key={expression.en}
                  style={styles.speakRow}
                  onPress={() => onSpeak(expression.en)}
                >
                  <Text style={{ color: c.studyText, flex: 1 }}>{expression.en}</Text>
                  <Text style={{ color: c.studyMuted, fontSize: 12 }}>{expression.zh}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  body: { marginTop: 10, gap: 10 },
  row: { gap: 4 },
  speakRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 },
});
