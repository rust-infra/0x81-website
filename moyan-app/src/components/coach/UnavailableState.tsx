import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { cardStyle, serif } from '../../lib/ui';

export function UnavailableState({
  kind,
  resetsAt,
}: {
  kind: 'quota' | 'llm' | 'network';
  resetsAt?: string;
}) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const resetTime = resetsAt
    ? new Date(resetsAt).toLocaleTimeString(lang, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const title =
    kind === 'quota'
      ? t('coachQuotaExceeded', { time: resetTime })
      : kind === 'llm'
        ? t('coachUnavailableLLM')
        : t('coachLoadFailed');

  return (
    <View style={[cardStyle(c.card, c.border), styles.wrap]}>
      <Text style={[styles.title, { color: c.ink, fontFamily: serif }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  title: { fontSize: 14, lineHeight: 21 },
});
