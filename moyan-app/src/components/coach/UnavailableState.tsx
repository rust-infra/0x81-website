import { StyleSheet, Text, View } from 'react-native';
import type { CoachQuotaStatus } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph, PrimaryButton, SecondaryButton } from './CoachUi';

export function UnavailableState({
  kind,
  resetsAt,
  quota,
  onRetry,
  onHistory,
}: {
  kind: 'quota' | 'llm' | 'network';
  resetsAt?: string;
  quota?: CoachQuotaStatus;
  onRetry?: () => void;
  onHistory?: () => void;
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
      ? t('coachQuotaTitle')
      : kind === 'llm'
        ? t('coachUnavailableLLM')
        : t('coachLoadFailed');
  const description =
    kind === 'quota'
      ? t('coachQuotaDesc', { limit: quota?.limit ?? 100, time: resetTime })
      : kind === 'llm'
        ? t('coachUnavailableLLMDesc')
        : t('coachNetworkDesc');

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.icon,
          { backgroundColor: kind === 'network' ? c.tagBg : c.accentLight },
        ]}
      >
        <CoachGlyph
          name={kind === 'quota' ? 'clock' : 'alert'}
          color={kind === 'network' ? c.ink : c.accent}
          size={30}
        />
      </View>
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      <Text style={[styles.desc, { color: c.inkMuted }]}>{description}</Text>

      {kind === 'quota' && quota ? (
        <View style={[styles.quotaCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.quotaRow}>
            <Text style={{ color: c.inkMuted, fontSize: 12 }}>{t('coachQuotaUsed')}</Text>
            <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>
              {quota.used} / {quota.limit}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: c.tagBg }]}>
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: c.accent,
                  width: `${Math.min(100, (quota.used / Math.max(quota.limit, 1)) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {kind === 'network' && onRetry ? (
          <PrimaryButton label={t('coachRetry')} onPress={onRetry} />
        ) : null}
        {kind === 'quota' && onHistory ? (
          <SecondaryButton label={t('coachViewHistory')} onPress={onHistory} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 96 },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '700', marginTop: 24, textAlign: 'center' },
  desc: { fontSize: 13, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  quotaCard: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 22 },
  quotaRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 9 },
  fill: { height: '100%', borderRadius: 3 },
  actions: { alignSelf: 'stretch', gap: 9, marginTop: 22 },
});
