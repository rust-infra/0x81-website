import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { serif } from '../../lib/ui';

export function EndSessionSheet({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.mask} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: c.studyCard }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: c.divider }]} />
          <Text style={[styles.title, { color: c.studyText, fontFamily: serif }]}>
            {t('coachEndConfirm')}
          </Text>
          <Text style={{ color: c.studyMuted, lineHeight: 20 }}>{t('coachEndMessage')}</Text>
          <Pressable style={[styles.primary, { backgroundColor: c.accent }]} onPress={onConfirm}>
            <Text style={{ color: c.buttonText, fontWeight: '700' }}>{t('coachFinishNow')}</Text>
          </Pressable>
          <Pressable
            style={[styles.cancel, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={onCancel}
          >
            <Text style={{ color: c.studyText, fontWeight: '600' }}>
              {t('coachContinuePractice')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 },
  handle: { width: 48, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  primary: { alignItems: 'center', borderRadius: 14, paddingVertical: 14, marginTop: 20 },
  cancel: { alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 13, marginTop: 9 },
});
