import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DEFAULT_COACH_PREFS,
  loadCoachPrefs,
  saveCoachPrefs,
} from '../../lib/coach-storage';
import type { CoachLocale, CoachMode, CoachPrefs } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../lib/ui';

export default function CoachSettingsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [prefs, setPrefs] = useState<CoachPrefs>(DEFAULT_COACH_PREFS);

  useEffect(() => {
    void loadCoachPrefs().then(setPrefs);
  }, []);

  const update = (patch: Partial<CoachPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void saveCoachPrefs(next).then(() => toast(t('saved')));
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={[roundButton, { backgroundColor: c.inputBg }]}>
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('coachSettingsTitle')}
          </Text>
          <View style={roundButton} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        <View style={[cardStyle(c.card, c.border), styles.card]}>
          <Text style={[styles.label, { color: c.ink }]}>{t('coachDefaultMode')}</Text>
          <View style={styles.chips}>
            {(['feedback', 'immersion'] as CoachMode[]).map((mode) => (
              <Pressable
                key={mode}
                onPress={() => update({ defaultMode: mode })}
                style={[
                  styles.chip,
                  {
                    backgroundColor: prefs.defaultMode === mode ? c.accentLight : c.inputBg,
                    borderColor: prefs.defaultMode === mode ? c.accent : c.border,
                  },
                ]}
              >
                <Text style={{ color: prefs.defaultMode === mode ? c.accent : c.inkLight }}>
                  {mode === 'feedback' ? t('coachFeedbackMode') : t('coachImmersion')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[cardStyle(c.card, c.border), styles.card]}>
          <Text style={[styles.label, { color: c.ink }]}>{t('coachAccentPreference')}</Text>
          <View style={styles.chips}>
            {(['en-US', 'en-GB', 'en-IN', 'en-AU', 'zh-CN'] as CoachLocale[]).map((locale) => (
              <Pressable
                key={locale}
                onPress={() => update({ accentPreference: locale })}
                style={[
                  styles.chip,
                  {
                    backgroundColor: prefs.accentPreference === locale ? c.accentLight : c.inputBg,
                    borderColor: prefs.accentPreference === locale ? c.accent : c.border,
                  },
                ]}
              >
                <Text style={{ color: prefs.accentPreference === locale ? c.accent : c.inkLight }}>
                  {locale}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[cardStyle(c.card, c.border), styles.card, styles.switchRow]}>
          <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachAutoPlay')}</Text>
          <Switch
            value={prefs.autoPlay}
            onValueChange={(value) => update({ autoPlay: value })}
            trackColor={{ true: c.accent, false: c.divider }}
          />
        </View>

        <Pressable
          onPress={() => router.push('/coach/history')}
          style={[cardStyle(c.card, c.border), styles.card, styles.switchRow]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachHistoryTitle')}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 4 }}>
              {t('coachHistoryDesc')}
            </Text>
          </View>
          <Text style={{ color: c.accent, fontSize: 20 }}>›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { paddingBottom: 40 },
  card: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
