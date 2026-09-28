import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachExpression } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph } from './CoachUi';

/**
 * 「接下来可以怎么说」—— 针对最新一条 AI 回复给出的、学习者可以直接照说的表达。
 *
 * 和消息里的反馈是两件事：那个讲的是*你刚说的这句*哪儿可以更好，这个讲的是
 * *下一句*可以怎么说。所以它不重复任何已经在消息里出现过的内容。
 * 最多两条，点一行就朗读。
 */
export function NextLinesPanel({
  lines,
  onSpeak,
}: {
  lines: CoachExpression[];
  onSpeak: (text: string) => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(true);

  const shown = lines.slice(0, 2);
  if (!shown.length) return null;

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
      <Pressable
        accessibilityRole="button"
        style={styles.header}
        onPress={() => setOpen((value) => !value)}
      >
        <CoachGlyph name="chat" color={c.accent} size={15} />
        <Text style={[styles.headerText, { color: c.accent }]}>
          {t('coachNextLines')}
        </Text>
        <Text style={{ color: c.studyMuted, marginLeft: 'auto' }}>
          {open ? '⌃' : '⌄'}
        </Text>
      </Pressable>

      {open ? (
        <View style={styles.lines}>
          {shown.map((line) => (
            <Pressable
              key={line.en}
              accessibilityRole="button"
              onPress={() => onSpeak(line.en)}
              style={[styles.line, { backgroundColor: c.inputBg }]}
            >
              <View style={styles.lineText}>
                <Text style={[styles.en, { color: c.ink }]}>{line.en}</Text>
                {line.zh ? (
                  <Text style={[styles.zh, { color: c.inkLight }]}>{line.zh}</Text>
                ) : null}
              </View>
              <CoachGlyph name="mic" color={c.inkLight} size={14} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text numberOfLines={1} style={[styles.preview, { color: c.studyMuted }]}>
          {shown[0].en}
        </Text>
      )}
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
  lines: { marginTop: 10, gap: 8 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  lineText: { flex: 1, minWidth: 0 },
  en: { fontSize: 13.5, lineHeight: 20, fontWeight: '600' },
  zh: { fontSize: 11.5, lineHeight: 17, marginTop: 2 },
});
