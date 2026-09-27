import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { CoachGlyph, type CoachGlyphName } from './CoachUi';

export type MaterialSource = 'camera' | 'library' | 'document' | 'paste';

export function MaterialSourceSheet({
  visible,
  title,
  onSelect,
  onCancel,
}: {
  visible: boolean;
  title: string;
  onSelect: (source: MaterialSource) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const options: Array<{
    source: MaterialSource;
    icon: CoachGlyphName;
    title: string;
    desc: string;
  }> = [
    { source: 'camera', icon: 'camera', title: t('coachCamera'), desc: t('coachCameraDesc') },
    { source: 'library', icon: 'image', title: t('coachGallery'), desc: t('coachGalleryDesc') },
    { source: 'document', icon: 'file', title: t('coachFile'), desc: t('coachFileDesc') },
    { source: 'paste', icon: 'text', title: t('coachPasteText'), desc: t('coachPasteDesc') },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.mask} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: c.card }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: c.divider }]} />
          <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
          {options.map((option, index) => (
            <Pressable
              key={option.source}
              onPress={() => onSelect(option.source)}
              style={[
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.divider },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: c.tagBg }]}>
                <CoachGlyph name={option.icon} color={c.ink} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{option.title}</Text>
                <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{option.desc}</Text>
              </View>
            </Pressable>
          ))}
          <Pressable
            onPress={onCancel}
            style={[styles.cancel, { backgroundColor: c.inputBg, borderColor: c.border }]}
          >
            <Text style={{ color: c.ink, fontWeight: '600' }}>{t('cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.36)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
  },
  handle: { width: 48, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, marginTop: 3 },
  cancel: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
});
