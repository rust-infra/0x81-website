import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachFeedback } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph } from './CoachUi';

/**
 * The feedback itself: corrections, the more natural phrasing, the note and the
 * speakable chips. This is what gets attached to the message it corrects, so it
 * sits next to the sentence it is about rather than in a panel of its own.
 */
export function FeedbackBody({
  feedback,
  onSpeak,
}: {
  feedback: CoachFeedback;
  onSpeak: (text: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const first = feedback.corrections[0];
  const natural = feedback.better_phrasing?.natural;

  return (
    <View style={styles.body}>
      {first ? (
        <View>
          <Text style={[styles.old, { color: c.studyMuted }]}>{first.original}</Text>
          <Text style={[styles.new, { color: c.ink }]}>{first.corrected}</Text>
          {first.explanation_zh ? (
            <Text style={[styles.note, { color: c.inkLight }]}>
              {first.explanation_zh}
            </Text>
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
            <Text
              key={`${item.original}-${item.corrected}`}
              style={[styles.note, { color: c.inkLight }]}
            >
              · {item.original} → {item.corrected}
            </Text>
          ))}
        </View>
      ) : null}

      {natural || feedback.expressions.length > 0 ? (
        <View style={styles.chips}>
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
  );
}

/** Header label shared by both placements; each wrapper owns the row. */
function FeedbackHeading() {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <>
      <CoachGlyph name="check" color={theme.colors.accent} size={15} />
      <Text style={[styles.headerText, { color: theme.colors.accent }]}>
        {t('coachBetterPhrasing')}
      </Text>
    </>
  );
}

/** One-line summary shown while a feedback card is folded away. */
function FeedbackPreview({ feedback }: { feedback: CoachFeedback }) {
  const { theme } = useTheme();
  const preview =
    feedback.better_phrasing?.natural ?? feedback.corrections[0]?.corrected;
  if (!preview) return null;
  return (
    <Text numberOfLines={1} style={[styles.preview, { color: theme.colors.studyMuted }]}>
      {preview}
    </Text>
  );
}

/**
 * The feedback for one turn, rendered *inside* that turn's own bubble: a
 * hairline divider, then the foldable header and body. Keeping it in the bubble
 * gives the message a single width (no detached panel sticking out past a short
 * bubble) and leaves no doubt about which turn it belongs to. Expanded by
 * default — the point is to read it while scrolling back — and one tap folds it
 * down to a single line.
 */
export function InlineFeedback({
  feedback,
  onSpeak,
  defaultOpen = true,
}: {
  feedback: CoachFeedback;
  onSpeak: (text: string) => void;
  defaultOpen?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <View style={[styles.section, { borderTopColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        style={styles.header}
        onPress={() => setOpen((value) => !value)}
      >
        <FeedbackHeading />
        <Text style={{ color: c.studyMuted, marginLeft: 'auto' }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {!open ? <FeedbackPreview feedback={feedback} /> : null}

      {open ? <FeedbackBody feedback={feedback} onSpeak={onSpeak} /> : null}
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
  // 附加在气泡内部的反馈区：靠一条细分隔线区分，而不是再套一层卡片外框。
  section: { marginTop: 9, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth },
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
