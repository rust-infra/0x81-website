import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SensitiveHit } from '../../lib/sensitive-scan';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph } from './CoachUi';

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
    <View
      style={[
        styles.card,
        { backgroundColor: c.accentLight, borderLeftColor: c.accent },
      ]}
    >
      <View style={styles.titleRow}>
        <CoachGlyph name="alert" color={c.accent} size={17} />
        <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12.5 }}>
          {t('coachSensitiveTitle', { count: hits.length })}
        </Text>
      </View>
      <View style={styles.hits}>
        {hits.map((hit) => (
          <Text
            key={`${hit.start}-${hit.value}`}
            style={[styles.hit, { color: c.ink, backgroundColor: c.card }]}
          >
            {hit.value}
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={{ color: c.inkMuted, fontSize: 11, flex: 1 }}>
          {t('coachSensitiveHint')}
        </Text>
        <Pressable
          onPress={onDelete}
          style={[styles.delete, { backgroundColor: c.accentLight, borderColor: c.accent }]}
        >
          <Text style={{ color: c.accent, fontWeight: '600', fontSize: 11 }}>
            {t('coachDeleteAll')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 3, borderRadius: 14, padding: 12, marginTop: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  hit: { fontSize: 12, borderRadius: 7, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  delete: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
});
