import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listCoachScenarios } from '../../../lib/coach-api-runtime';
import { loadInterviewProfiles } from '../../../lib/coach-storage';
import type { CoachScenario, InterviewProfileRecord } from '../../../lib/coach-types';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';
import { cardStyle, roundButton, screen, serif } from '../../../lib/ui';

const INTERVIEW_IDS = [
  'interview_behavioral',
  'interview_screening',
  'interview_technical',
];

export default function InterviewEntryScreen() {
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [interviewers, setInterviewers] = useState<CoachScenario[]>([]);
  const [profiles, setProfiles] = useState<InterviewProfileRecord[]>([]);
  const [selected, setSelected] = useState('interview_behavioral');

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        listCoachScenarios(lang).catch(() => []),
        loadInterviewProfiles(),
      ]).then(([scenarios, saved]) => {
        setInterviewers(scenarios.filter((scenario) => INTERVIEW_IDS.includes(scenario.id)));
        setProfiles(saved);
      });
    }, [lang])
  );

  const resume = profiles.find((profile) => profile.kind === 'resume');
  const job = profiles.find((profile) => profile.kind === 'job');

  const openMaterials = (kind: 'resume' | 'job') => {
    router.push({
      pathname: '/coach/interview/materials',
      params: { kind, interviewerId: selected },
    });
  };

  const start = () => {
    if (!resume) {
      openMaterials('resume');
      return;
    }
    const profile =
      job?.profile
        ? `[RESUME PROFILE]\n${resume.profile}\n\n[JOB PROFILE]\n${job.profile}`
        : resume.profile;
    router.push({
      pathname: '/coach/session',
      params: {
        scenarioId: selected,
        source: 'preset',
        interviewKind: job ? 'resume_job' : 'resume',
        profile,
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
            {t('coachInterviewTitle')}
          </Text>
          <View style={roundButton} />
        </View>
      </View>
      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        <View style={[cardStyle(c.card, c.border), styles.intro]}>
          <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachInterviewIntro')}</Text>
          <Text style={{ color: c.inkMuted, marginTop: 6, fontSize: 12 }}>
            {t('coachImmersion')} · {t('coachReminder')}
          </Text>
        </View>

        <Text style={[styles.section, { color: c.inkLight }]}>{t('coachChooseInterviewer')}</Text>
        {interviewers.map((interviewer) => (
          <Pressable
            key={interviewer.id}
            onPress={() => setSelected(interviewer.id)}
            style={[
              cardStyle(c.card, selected === interviewer.id ? c.accent : c.border),
              styles.rowCard,
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontWeight: '600' }}>{interviewer.title}</Text>
              <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 4 }}>
                {interviewer.persona.name} · {interviewer.persona.locale}
              </Text>
            </View>
            {selected === interviewer.id ? (
              <Text style={{ color: c.accent, fontWeight: '700' }}>✓</Text>
            ) : null}
          </Pressable>
        ))}

        <Text style={[styles.section, { color: c.inkLight }]}>{t('coachMaterials')}</Text>
        <Pressable
          onPress={() => openMaterials('resume')}
          style={[cardStyle(c.card, c.border), styles.rowCard]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachResume')}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 4 }}>
              {resume ? `${resume.profile.length}` : t('coachPasteText')}
            </Text>
          </View>
          <Text style={{ color: c.accent }}>›</Text>
        </Pressable>
        <Pressable
          onPress={() => openMaterials('job')}
          style={[cardStyle(c.card, c.border), styles.rowCard]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{t('coachAddJob')}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 12, marginTop: 4 }}>
              {job ? `${job.profile.length}` : t('coachPasteText')}
            </Text>
          </View>
          <Text style={{ color: c.accent }}>›</Text>
        </Pressable>

        <Pressable onPress={start} style={[styles.primary, { backgroundColor: c.buttonBg }]}>
          <Text style={{ color: c.buttonText, fontWeight: '700' }}>{t('coachStartInterview')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { paddingBottom: 40 },
  intro: { marginBottom: 14 },
  section: { fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  primary: { alignItems: 'center', borderRadius: 16, paddingVertical: 15, marginTop: 18 },
});
