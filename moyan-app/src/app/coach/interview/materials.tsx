import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SensitiveHints } from '../../../components/coach/SensitiveHints';
import { postInterviewProfile } from '../../../lib/coach-api-runtime';
import { removeSensitiveHits, scanSensitive } from '../../../lib/sensitive-scan';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';
import { useToast } from '../../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../../lib/ui';

export default function InterviewMaterialsScreen() {
  const { kind: rawKind, interviewerId } = useLocalSearchParams<{
    kind?: string;
    interviewerId?: string;
  }>();
  const kind = rawKind === 'job' ? 'job' : 'resume';
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hits = useMemo(() => scanSensitive(text), [text]);

  const generate = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await postInterviewProfile({ kind, text });
      router.replace({
        pathname: '/coach/interview/profile',
        params: {
          kind: result.kind,
          profile: result.profile,
          interviewerId: interviewerId ?? 'interview_behavioral',
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('coachProfileFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={[roundButton, { backgroundColor: c.inputBg }]}>
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {kind === 'job' ? t('coachJob') : t('coachResume')}
          </Text>
          <View style={roundButton} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[screen.body, styles.body]} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
          {t('coachMaterialHint')}
        </Text>
        <View style={styles.importRow}>
          {[
            { label: t('coachCamera'), icon: '▣' },
            { label: t('coachGallery'), icon: '▧' },
            { label: t('coachFile'), icon: '▤' },
          ].map((item) => (
            <Pressable
              key={item.label}
              onPress={() => toast(t('coachNativeImportUnavailable'))}
              style={[styles.importButton, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <Text style={{ color: c.ink, fontSize: 18 }}>{item.icon}</Text>
              <Text style={{ color: c.inkLight, fontSize: 12, marginTop: 4 }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('coachPastePlaceholder')}
          placeholderTextColor={c.inkMuted}
          multiline
          maxLength={20_000}
          style={[
            styles.input,
            { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border },
          ]}
        />
        <Text style={{ color: c.inkMuted, textAlign: 'right', fontSize: 11, marginTop: 5 }}>
          {text.length} / 20000
        </Text>
        <SensitiveHints
          hits={hits}
          onDelete={() => setText((value) => removeSensitiveHits(value, hits))}
        />
        <View style={[cardStyle(c.card, c.border), styles.risk]}>
          <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
            {t('coachRiskNotice')}
          </Text>
        </View>
        {error ? <Text style={{ color: c.accent, marginTop: 10 }}>{error}</Text> : null}
        <Pressable
          disabled={busy || !text.trim()}
          onPress={() => void generate()}
          style={[styles.primary, { backgroundColor: busy ? c.inkMuted : c.buttonBg }]}
        >
          {busy ? <ActivityIndicator color={c.buttonText} /> : null}
          <Text style={{ color: c.buttonText, fontWeight: '700' }}>
            {busy ? t('coachRecognizeLoading') : t('coachGenerateProfile')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { paddingBottom: 40 },
  importRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  importButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 13,
  },
  input: {
    minHeight: 260,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    textAlignVertical: 'top',
    marginTop: 14,
    fontSize: 14,
    lineHeight: 21,
  },
  risk: { marginTop: 12 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 15,
    marginTop: 18,
  },
});
