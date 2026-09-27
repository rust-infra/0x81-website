import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { screen, serif } from '../../lib/ui';

export default function CoachScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          {t('tabCoach')}
        </Text>
        <Text style={[styles.subtitle, { color: c.inkLight }]}>
          {t('coachComingSoon')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: 8, fontSize: 13 },
});
