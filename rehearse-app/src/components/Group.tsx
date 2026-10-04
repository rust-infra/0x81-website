import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';

/**
 * 分组容器：无内边距，行与行之间用发丝线分隔（iOS 分组列表形态）。
 *
 * 与旧的 `styles.card`（`padding: 6` + 16dp 圆角 + 描边）相比：
 * - 去掉内边距后，行的左右内边距由各行业自己负责，内容左边距从 38dp 降到 14dp，
 *   411dp 宽的屏上可用宽度多出 ~24dp；
 * - 行与行之间用发丝线而不是「各自一个小圆角块」，视觉噪音更低。
 */
export function Group({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const items = Children.toArray(children);

  return (
    <View style={[styles.group, { backgroundColor: c.card, borderColor: c.border }]}>
      {items.map((child, index) => (
        <View
          key={index}
          style={
            index > 0
              ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.divider }
              : undefined
          }
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/** 分组上方的小标题。 */
export function SectionLabel({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return <Text style={[styles.section, { color: theme.colors.inkMuted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  group: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  section: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
});
