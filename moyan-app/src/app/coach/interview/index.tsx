import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialSourceSheet, type MaterialSource } from '../../../components/coach/MaterialSourceSheet';
import {
  CoachGlyph,
  CoachGroup,
  CoachHeader,
  CoachRow,
  PrimaryButton,
  SectionLabel,
} from '../../../components/coach/CoachUi';
import { listCoachScenarios } from '../../../lib/coach-api-runtime';
import { loadInterviewProfiles } from '../../../lib/coach-storage';
import type { CoachScenario, InterviewProfileRecord } from '../../../lib/coach-types';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';

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
  const [sourceKind, setSourceKind] = useState<'resume' | 'job' | null>(null);

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

  const openMaterials = (kind: 'resume' | 'job', source?: MaterialSource) => {
    router.push({
      pathname: '/coach/interview/materials',
      params: { kind, interviewerId: selected, source },
    });
  };

  const start = () => {
    if (!resume) {
      setSourceKind('resume');
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
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={t('coachInterviewTitle')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={[styles.intro, { backgroundColor: c.accentLight }]}>
          <View style={styles.introTitleRow}>
            <CoachGlyph name="spark" color={c.accent} size={17} />
            <Text style={[styles.introTitle, { color: c.accent }]}>{t('coachInterviewIntro')}</Text>
          </View>
          <Text style={[styles.introText, { color: c.inkLight }]}>{t('coachReminder')}</Text>
        </View>

        <SectionLabel>{t('coachChooseInterviewer')}</SectionLabel>
        <CoachGroup>
          {interviewers.map((interviewer) => {
            const isSelected = selected === interviewer.id;
            return (
              <CoachRow
                key={interviewer.id}
                icon="person"
                selected={isSelected}
                title={interviewer.title}
                subtitle={interviewer.description}
                meta={`${interviewer.persona.name} · ${interviewer.persona.locale}`}
                badge={isSelected ? t('coachSelected') : undefined}
                onPress={() => setSelected(interviewer.id)}
              />
            );
          })}
        </CoachGroup>

        <SectionLabel>{t('coachMaterials')}</SectionLabel>
        <CoachGroup>
          <CoachRow
            icon="file"
            title={resume ? t('coachMyResume') : t('coachAddResume')}
            subtitle={resume ? t('coachProfileTitle') : t('coachPasteText')}
            meta={resume ? t('coachProfileChars', { count: resume.profile.length }) : undefined}
            onPress={() => setSourceKind('resume')}
          />
          <CoachRow
            icon="plus"
            title={job ? t('coachJob') : t('coachAddJob')}
            subtitle={job ? t('coachChars', { count: job.profile.length }) : t('coachPasteText')}
            dashed={!job}
            onPress={() => setSourceKind('job')}
          />
        </CoachGroup>
        <Text style={[styles.help, { color: c.inkMuted }]}>
          {t('coachMaterialHint')} {t('coachMaterialLocalOnly')}
        </Text>

        <View style={styles.actions}>
          <PrimaryButton label={t('coachStartInterview')} onPress={start} variant="accent" />
        </View>
      </ScrollView>
      <MaterialSourceSheet
        visible={!!sourceKind}
        title={sourceKind === 'job' ? t('coachAddJob') : t('coachAddResume')}
        onCancel={() => setSourceKind(null)}
        onSelect={(source) => {
          const kind = sourceKind ?? 'resume';
          setSourceKind(null);
          openMaterials(kind, source);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  intro: { borderRadius: 18, padding: 15 },
  introTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  introTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  introText: { fontSize: 11.5, lineHeight: 18, marginTop: 5 },
  help: { fontSize: 11.5, lineHeight: 18, marginTop: 9 },
  actions: { marginTop: 20 },
});
