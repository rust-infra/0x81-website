import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { saveInterviewProfile } from '../../../lib/coach-storage';
import type { InterviewKind } from '../../../lib/coach-types';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';
import { useToast } from '../../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../../lib/ui';

export default function InterviewProfileScreen() {
  const { kind: rawKind, profile: rawProfile, interviewerId } = useLocalSearchParams<{
    kind?: string;
    profile?: string;
    interviewerId?: string;
  }>();
  const kind: InterviewKind = rawKind === 'job' ? 'job' : 'resume';
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [profile, setProfile] = useState(rawProfile ?? '');

  const start = async () => {
    if (!profile.trim()) return;
    const id = `profile_${kind}_${Date.now()}`;
    await saveInterviewProfile({
      id,
      kind,
      profile: profile.trim(),
      updatedAt: new Date().toISOString(),
    });
    toast(t('saved'));
    router.push({
      pathname: '/coach/session',
      params: {
        scenarioId: interviewerId ?? 'interview_behavioral',
        source: 'preset',
        interviewKind: kind,
        profile: profile.trim(),
      },
    });
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={[roundButton, { backgroundColor: c.inputBg }]}>
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {t('coachProfileTitle')}
          </Text>
          <View style={roundButton} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[screen.body, styles.body]} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
          {t('coachProfileHint')}
        </Text>
        <TextInput
          value={profile}
          onChangeText={setProfile}
          multiline
          maxLength={3_000}
          style={[
            styles.input,
            { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border },
          ]}
        />
        <Text style={{ color: c.inkMuted, textAlign: 'right', fontSize: 11, marginTop: 5 }}>
          {profile.length} / 3000
        </Text>
        <View style={[cardStyle(c.card, c.border), styles.risk]}>
          <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
            {t('coachRiskNotice')}
          </Text>
        </View>
        <Pressable
          disabled={!profile.trim()}
          onPress={() => void start()}
          style={[styles.primary, { backgroundColor: profile.trim() ? c.buttonBg : c.inkMuted }]}
        >
          <Text style={{ color: c.buttonText, fontWeight: '700' }}>{t('coachStartInterview')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { paddingBottom: 40 },
  input: {
    minHeight: 320,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    textAlignVertical: 'top',
    marginTop: 14,
    fontSize: 14,
    lineHeight: 22,
  },
  risk: { marginTop: 12 },
  primary: { alignItems: 'center', borderRadius: 16, paddingVertical: 15, marginTop: 18 },
});
