import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { roundButton, screen, serif } from '../../lib/ui';

export default function CoachSessionScaffold() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.studyBg }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.row}>
          <Pressable onPress={() => router.back()} style={[roundButton, { backgroundColor: c.studyCard }]}>
            <Text style={{ color: c.studyText, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.studyText, fontFamily: serif }]}>
            {t('tabCoach')}
          </Text>
        </View>
      </View>
      <View style={styles.center}>
        <Text style={{ color: c.studyMuted, textAlign: 'center' }}>
          {t('coachSessionScaffold')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});
