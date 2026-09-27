import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SensitiveHit } from '../../lib/sensitive-scan';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';

export function SensitiveHints({
  hits,
  onDelete,
}: {
  hits: SensitiveHit[];
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  if (hits.length === 0) return null;
  return (
    <View style={[styles.card, { borderColor: c.accent, backgroundColor: c.card }]}>
      <Text style={{ color: c.ink, fontWeight: '600' }}>
        {t('coachSensitiveFound', { count: hits.length })}
      </Text>
      <View style={styles.hits}>
        {hits.map((hit) => (
          <Text key={`${hit.start}-${hit.value}`} style={[styles.hit, { color: c.accent }]}>
            {hit.value}
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={{ color: c.inkMuted, fontSize: 11, flex: 1 }}>{t('coachRiskNotice')}</Text>
        <Pressable onPress={onDelete}>
          <Text style={{ color: c.accent, fontWeight: '600' }}>
            {t('coachDeleteFound', { count: hits.length })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  hits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  hit: { fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 10 },
});
