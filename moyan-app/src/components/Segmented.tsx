import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme-context';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

/**
 * 分段控件（iOS UISegmentedControl 形态）。
 *
 * 存在的理由：设置页里「N 选 1」的项（主题、识别服务、发音服务）以前每个选项占一整行
 * 62dp。同一信息用分段控件表达只要三分之一的高度，且一眼能看全所有选项。
 *
 * 说明：轨道用 tagBg、选中块用 card 底 + 描边，这样在任意主题下选中态都靠
 * 「层级翻转」而不是靠颜色区分，浅色/深色主题都成立。
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly SegmentOption<T>[];
  value: T | undefined;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <View style={[styles.track, { backgroundColor: c.tagBg }, style]}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && {
                backgroundColor: c.card,
                borderColor: c.border,
                borderWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? c.ink : c.inkMuted, fontWeight: active ? '600' : '400' },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12 },
});
