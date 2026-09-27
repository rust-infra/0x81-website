import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoachGroup, CoachHeader, SectionLabel } from '../../components/coach/CoachUi';
import {
  DEFAULT_COACH_PREFS,
  loadCoachPrefs,
  saveCoachPrefs,
} from '../../lib/coach-storage';
import type { CoachLocale, CoachMode, CoachPrefs } from '../../lib/coach-types';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';

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
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('tabSettings')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <SectionLabel>{t('coachPageTitle')}</SectionLabel>
        <CoachGroup>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachDefaultMode')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>
                {t('coachDefaultModeDesc')}
              </Text>
            </View>
            <View style={[styles.segment, { borderColor: c.border }]}>
              {(['feedback', 'immersion'] as CoachMode[]).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => update({ defaultMode: mode })}
                  style={[styles.segmentItem, prefs.defaultMode === mode && { backgroundColor: c.accentLight }]}
                >
                  <Text
                    style={{
                      color: prefs.defaultMode === mode ? c.accent : c.inkMuted,
                      fontSize: 10,
                      fontWeight: prefs.defaultMode === mode ? '700' : '500',
                    }}
                  >
                    {mode === 'feedback' ? t('coachFeedbackMode') : t('coachImmersion')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.rowColumn}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachAccentPreference')}</Text>
                <Text style={[styles.rowDesc, { color: c.inkMuted }]}>
                  {t('coachAccentPreferenceDesc')}
                </Text>
              </View>
            </View>
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
                  <Text style={{ color: prefs.accentPreference === locale ? c.accent : c.inkMuted, fontSize: 11 }}>
                    {locale}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachAutoPlay')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{t('coachAutoPlayDesc')}</Text>
            </View>
            <Switch
              value={prefs.autoPlay}
              onValueChange={(value) => update({ autoPlay: value })}
              trackColor={{ true: c.accent, false: c.divider }}
            />
          </View>

          <Pressable onPress={() => router.push('/coach/interview')} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachMaterials')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>
                {t('coachManageMaterials')}
              </Text>
            </View>
            <Text style={{ color: c.inkMuted }}>{t('coachManage')} ›</Text>
          </Pressable>
        </CoachGroup>

        <SectionLabel>{t('voiceSection')}</SectionLabel>
        <CoachGroup>
          <Pressable onPress={() => router.push('/(tabs)/settings')} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceEn')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{t('coachVoiceFollowsSettings')}</Text>
            </View>
            <Text style={{ color: c.inkMuted }}>›</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/settings')} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('speechRate')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{t('coachVoiceFollowsSettings')}</Text>
            </View>
            <Text style={{ color: c.inkMuted }}>›</Text>
          </Pressable>
        </CoachGroup>
        <Text style={[styles.note, { color: c.inkMuted }]}>{t('coachSettingsNote')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  row: { minHeight: 58, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowColumn: { paddingVertical: 10, paddingHorizontal: 13 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, lineHeight: 17, marginTop: 3 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  segmentItem: { paddingHorizontal: 8, paddingVertical: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  chip: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  note: { fontSize: 11.5, lineHeight: 18, marginTop: 14 },
});
