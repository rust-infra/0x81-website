import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CoachExpression } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph } from './CoachUi';

/**
 * 一条教练回复的「接下来可以怎么说」。
 *
 * 推荐语是**跟这条回复一起生成**的，所以它一出现就是定稿：这里没有"生成中"
 * 状态 —— 早先那个跳动的 pending 提示只在推荐语晚于回复到达时才成立，
 * 现在只会让已经定稿的旧卡无谓地显示"正在思考…"（教练思考由聊天里的
 * typing 气泡负责表达）。
 *
 * `embedded` 用于把它并进教练回复气泡内部（同一张卡片，用一条分隔线区分），
 * 而不是自己再画一张卡 —— 两者本来就是同一条回复的两部分。
 *
 * `defaultOpen` 让「最新一条」默认展开，而旧卡只留一行折叠入口：
 * 过期的推荐语不该继续抢注意力，但点开还能回看当时给了什么。
 */
export function NextLinesPanel({
  lines,
  onSpeak,
  embedded = false,
  defaultOpen = true,
}: {
  lines: CoachExpression[];
  onSpeak: (text: string) => void;
  embedded?: boolean;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(defaultOpen);
  const shown = lines.slice(0, 2);

  // 有新的回复出现时，这张卡从「最新」变成「旧卡」：跟着收起，
  // 免得每轮又留一张展开的大卡把聊天撑得很长。
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  if (!shown.length) return null;

  return (
    <View
      style={
        embedded
          ? [styles.embedded, { borderTopColor: c.border }]
          : [styles.card, { backgroundColor: c.studyCard, borderColor: c.border, borderLeftColor: c.accent }]
      }
    >
      <Pressable accessibilityRole="button" style={styles.header} onPress={() => setOpen((value) => !value)}>
        <CoachGlyph name="chat" color={c.accent} size={15} />
        <Text style={[styles.headerText, { color: c.accent }]}>{t('coachNextLines')}</Text>
        <Text style={{ color: c.studyMuted, marginLeft: 'auto' }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.lines}>
          {shown.map((line) => (
            <Pressable key={line.en} accessibilityRole="button" onPress={() => onSpeak(line.en)} style={[styles.line, { backgroundColor: c.inputBg }]}>
              <View style={styles.lineText}>
                <Text style={[styles.en, { color: c.ink }]}>{line.en}</Text>
                {line.zh ? <Text style={[styles.zh, { color: c.inkLight }]}>{line.zh}</Text> : null}
              </View>
              <CoachGlyph name="mic" color={c.inkLight} size={14} />
            </Pressable>
          ))}
        </View>
      ) : (
        // 折叠状态下预览行也要能点开 —— 用户点的是那张卡，而不是那一行小标题。
        <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)}>
          <Text numberOfLines={1} style={[styles.preview, { color: c.studyMuted }]}>{shown[0].en}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 16, padding: 15, marginTop: 10 },
  // 并进教练气泡时不再画自己的边框/背景，只留一条上分隔线。
  embedded: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  preview: { fontSize: 12, lineHeight: 18, marginTop: 7, paddingRight: 12 },
  lines: { marginTop: 10, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  lineText: { flex: 1, minWidth: 0 },
  en: { fontSize: 13.5, lineHeight: 20, fontWeight: '600' },
  zh: { fontSize: 11.5, lineHeight: 17, marginTop: 2 },
});
