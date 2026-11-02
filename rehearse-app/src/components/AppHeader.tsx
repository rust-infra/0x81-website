// 只放一个 `BackButton`——文件名是上游叫法，没跟着改名（§8.1 只改目录与端点）。
// ⚠️ 搬迁时差点把它当成「墨言首页的头部」删掉：它确实叫 AppHeader，但内容是
// 通用的返回按钮，coach 的每一个栈页都在用（CoachUi 与 session）。
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme-context';

export function BackButton({
  onPress,
  color,
  style,
}: {
  onPress: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityLabel={t('back')}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <Text style={[styles.icon, { color: color ?? c.ink }]}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 28, lineHeight: 28, marginTop: -2 },
});
