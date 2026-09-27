import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachFeedback } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph } from './CoachUi';

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
    if (feedback) setOpen(false);
  }, [feedback]);

  if (!feedback) return null;

  const first = feedback.corrections[0];
  const natural = feedback.better_phrasing?.natural;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.studyCard,
          borderColor: c.border,
          borderLeftColor: c.accent,
        },
      ]}
    >
      <Pressable style={styles.header} onPress={() => setOpen((value) => !value)}>
        <CoachGlyph name="check" color={c.accent} size={15} />
        <Text style={[styles.headerText, { color: c.accent }]}>
          {t('coachBetterPhrasing')}
        </Text>
        <Text style={{ color: c.studyMuted, marginLeft: 'auto' }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {!open && (natural || first) ? (
        <Text numberOfLines={1} style={[styles.preview, { color: c.studyMuted }]}>
          {natural ?? first?.corrected}
        </Text>
      ) : null}

      {open ? (
        <View style={styles.body}>
          {first ? (
            <View>
              <Text style={[styles.old, { color: c.studyMuted }]}>{first.original}</Text>
              <Text style={[styles.new, { color: c.ink }]}>{first.corrected}</Text>
              {first.explanation_zh ? (
                <Text style={[styles.note, { color: c.inkLight }]}>{first.explanation_zh}</Text>
              ) : null}
            </View>
          ) : null}

          {!first && natural ? (
            <Pressable onPress={() => onSpeak(natural)}>
              <Text style={[styles.new, { color: c.ink }]}>{natural}</Text>
              {feedback.better_phrasing?.note_zh ? (
                <Text style={[styles.note, { color: c.inkLight }]}>
                  {feedback.better_phrasing.note_zh}
                </Text>
              ) : null}
            </Pressable>
          ) : null}

          {feedback.corrections.length > 1 ? (
            <View style={styles.moreCorrections}>
              {feedback.corrections.slice(1).map((item) => (
                <Text key={`${item.original}-${item.corrected}`} style={[styles.note, { color: c.inkLight }]}>
                  · {item.original} → {item.corrected}
                </Text>
              ))}
            </View>
          ) : null}

          {(first || natural || feedback.expressions.length > 0) ? (
            <View style={styles.chips}>
              {first ? (
                <Text style={[styles.chip, { backgroundColor: c.inputBg, color: c.inkLight }]}>
                  {first.original} → {first.corrected}
                </Text>
              ) : null}
              {natural ? (
                <Pressable
                  onPress={() => onSpeak(natural)}
                  style={[styles.chip, { backgroundColor: c.inputBg }]}
                >
                  <Text style={{ color: c.inkLight, fontSize: 10.5 }}>{natural}</Text>
                </Pressable>
              ) : null}
              {feedback.expressions.slice(0, 2).map((expression) => (
                <Pressable
                  key={expression.en}
                  onPress={() => onSpeak(expression.en)}
                  style={[styles.chip, { backgroundColor: c.inputBg }]}
                >
                  <Text style={{ color: c.inkLight, fontSize: 10.5 }}>{expression.en}</Text>
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
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 16,
    padding: 15,
    marginTop: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  preview: { fontSize: 12, lineHeight: 18, marginTop: 7, paddingRight: 12 },
  body: { marginTop: 10, gap: 9 },
  old: { fontSize: 12.5, lineHeight: 20, textDecorationLine: 'line-through' },
  new: { fontSize: 13, lineHeight: 21, fontWeight: '600' },
  note: { fontSize: 11.5, lineHeight: 18, marginTop: 4 },
  moreCorrections: { gap: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4 },
});
