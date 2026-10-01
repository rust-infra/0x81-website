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
