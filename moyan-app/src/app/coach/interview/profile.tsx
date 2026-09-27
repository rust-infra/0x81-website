import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoachGlyph, CoachHeader, PrimaryButton } from '../../../components/coach/CoachUi';
import { listCoachScenarios } from '../../../lib/coach-api-runtime';
import { saveInterviewProfile } from '../../../lib/coach-storage';
import type { CoachScenario, InterviewKind } from '../../../lib/coach-types';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';
import { useToast } from '../../../lib/toast';

export default function InterviewProfileScreen() {
  const { kind: rawKind, profile: rawProfile, interviewerId, source } = useLocalSearchParams<{
    kind?: string;
    profile?: string;
    interviewerId?: string;
    source?: string;
  }>();
  const kind: InterviewKind = rawKind === 'job' ? 'job' : 'resume';
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [profile, setProfile] = useState(rawProfile ?? '');
  const [interviewer, setInterviewer] = useState<CoachScenario | null>(null);

  useEffect(() => {
    void listCoachScenarios(lang)
      .then((items) =>
        setInterviewer(
          items.find((item) => item.id === (interviewerId ?? 'interview_behavioral')) ?? null
        )
      )
      .catch(() => {});
  }, [interviewerId, lang]);

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

  const edited = profile !== (rawProfile ?? '');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader
        title={t('coachProfileTitle')}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() =>
              router.replace({
                pathname: '/coach/interview/materials',
                params: { kind, interviewerId, source },
              })
            }
            hitSlop={12}
          >
            <Text style={{ color: c.inkMuted, fontSize: 12 }}>{t('coachRegenerate')}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.notice, { backgroundColor: c.card, borderLeftColor: c.accent }]}>
          <View style={styles.noticeTitleRow}>
            <CoachGlyph name="check" color={c.accent} size={17} />
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12.5 }}>
              {t('coachProfileGenerated')}
            </Text>
          </View>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 22, marginTop: 9 }}>
            {t('coachProfileUseOnly')}
          </Text>
        </View>
        <TextInput
          value={profile}
          onChangeText={setProfile}
          multiline
          maxLength={3_000}
          style={[
            styles.input,
            { backgroundColor: c.card, color: c.ink, borderColor: c.border },
          ]}
        />
        <View style={styles.counterRow}>
          <View style={styles.editedRow}>
            <View
              style={[
                styles.editedDot,
                { backgroundColor: edited ? c.accent : c.inkMuted },
              ]}
            />
            <Text style={{ color: c.inkMuted, fontSize: 11 }}>
              {edited ? t('coachEdited') : t('saved')}
            </Text>
          </View>
          <Text style={{ color: c.inkMuted, fontSize: 11 }}>{profile.length} / 3000</Text>
        </View>
        <View style={[styles.risk, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
            {t('coachProfileRisk')}
          </Text>
        </View>
        <View style={styles.actions}>
          <PrimaryButton
            label={t('coachStartInterview')}
            onPress={() => void start()}
            disabled={!profile.trim()}
            variant="accent"
          />
          {interviewer ? (
            <Text style={[styles.footer, { color: c.inkMuted }]}>
              {t('coachInterviewerFooter', {
                name: interviewer.persona.name,
                role: interviewer.persona.role,
                locale: interviewer.persona.locale,
              })}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  notice: { borderLeftWidth: 3, borderRadius: 16, padding: 14 },
  noticeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  input: {
    minHeight: 330,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    textAlignVertical: 'top',
    marginTop: 12,
    fontSize: 14,
    lineHeight: 22,
  },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  editedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editedDot: { width: 7, height: 7, borderRadius: 4 },
  risk: { borderRadius: 13, borderWidth: 1, padding: 13, marginTop: 12 },
  actions: { marginTop: 18 },
  footer: { textAlign: 'center', fontSize: 11, marginTop: 12 },
});
