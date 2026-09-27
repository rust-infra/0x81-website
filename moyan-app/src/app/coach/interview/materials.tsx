import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  CoachGlyph,
  CoachHeader,
  PrimaryButton,
  SecondaryButton,
  type CoachGlyphName,
} from '../../../components/coach/CoachUi';
import { MaterialSourceSheet, type MaterialSource } from '../../../components/coach/MaterialSourceSheet';
import { SensitiveHints } from '../../../components/coach/SensitiveHints';
import { extractInterviewText, postInterviewProfile } from '../../../lib/coach-api-runtime';
import { ApiError } from '../../../lib/api-error';
import { buildInterviewForm } from '../../../lib/coach-files';
import {
  deletePreparedFiles,
  pickDocuments,
  pickImages,
} from '../../../lib/coach-files-runtime';
import { removeSensitiveHits, scanSensitive } from '../../../lib/sensitive-scan';
import { useI18n } from '../../../lib/i18n';
import { useTheme } from '../../../lib/theme-context';
import { useToast } from '../../../lib/toast';

export default function InterviewMaterialsScreen() {
  const {
    kind: rawKind,
    interviewerId,
    source: rawSource,
  } = useLocalSearchParams<{
    kind?: string;
    interviewerId?: string;
    source?: string;
  }>();
  const kind = rawKind === 'job' ? 'job' : 'resume';
  const initialSource =
    rawSource === 'camera' || rawSource === 'library' || rawSource === 'document' || rawSource === 'paste'
      ? rawSource
      : undefined;
  const router = useRouter();
  const { t } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const inputRef = useRef<TextInput | null>(null);
  const ranInitialSource = useRef(false);
  const requestSeq = useRef(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [sourceCount, setSourceCount] = useState(1);
  const [sourceKind, setSourceKind] = useState<MaterialSource | null>(initialSource ?? null);
  const [showSource, setShowSource] = useState(false);
  const [failure, setFailure] = useState<'scanned' | 'vision' | 'permission' | null>(null);
  const [error, setError] = useState('');
  const [deletedCount, setDeletedCount] = useState(0);
  const hits = useMemo(() => scanSensitive(text), [text]);

  const recognize = async (source: Exclude<MaterialSource, 'paste'>) => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setRecognizing(true);
    setFailure(null);
    setError('');
    setSourceKind(source);
    let files: Array<{ uri: string }> = [];
    try {
      if (source === 'document') {
        const docs = await pickDocuments();
        if (docs.length === 0) return;
        files = docs;
        setSourceCount(docs.length);
        const result = await extractInterviewText(buildInterviewForm({ docs }));
        if (requestSeq.current !== requestId) return;
        setText(result.text);
        if (result.likely_scanned) setFailure('scanned');
      } else {
        const images = await pickImages(source);
        if (images.length === 0) return;
        files = images;
        setSourceCount(images.length);
        const result = await extractInterviewText(buildInterviewForm({ images }));
        if (requestSeq.current !== requestId) return;
        setText(result.text);
      }
    } catch (err) {
      if (requestSeq.current !== requestId) return;
      if (err instanceof ApiError && err.reason === 'vision_not_supported') {
        setFailure('vision');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        if (/permission|denied|restricted/i.test(message)) {
          setFailure('permission');
          toast(t('coachPhotoPermissionDenied'));
        } else {
          setError(message);
        }
      }
    } finally {
      await deletePreparedFiles(files);
      if (requestSeq.current === requestId) setRecognizing(false);
    }
  };

  useEffect(() => {
    if (ranInitialSource.current || !initialSource || initialSource === 'paste') {
      if (initialSource === 'paste') inputRef.current?.focus();
      return;
    }
    ranInitialSource.current = true;
    void recognize(initialSource);
  }, [initialSource]);

  const chooseSource = (source: MaterialSource) => {
    setShowSource(false);
    if (source === 'paste') {
      setSourceKind('paste');
      setFailure(null);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }
    void recognize(source);
  };

  const cancelRecognition = () => {
    requestSeq.current += 1;
    setRecognizing(false);
    setFailure(null);
    setError('');
  };

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
          source: sourceKind ?? undefined,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('coachProfileFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (recognizing) {
    return (
      <ImportState
        headerTitle={t('coachRecognizingTitle')}
        onBack={cancelRecognition}
        icon="file"
        title={t('coachRecognizingImages', { count: sourceCount })}
        paragraphs={[t('coachRecognizingHint')]}
        primary={t('coachCancelRecognition')}
        onPrimary={cancelRecognition}
      />
    );
  }

  if (failure) {
    const config = {
      scanned: {
        icon: 'file' as CoachGlyphName,
        title: t('coachScannedTitle'),
        paragraphs: [t('coachScannedDesc1'), t('coachScannedDesc2'), t('coachScannedFootnote')],
        primary: t('coachCamera'),
        secondary: t('coachPasteText'),
      },
      vision: {
        icon: 'image' as CoachGlyphName,
        title: t('coachVisionTitle'),
        paragraphs: [t('coachVisionDesc1'), t('coachVisionDesc2'), t('coachVisionFootnote')],
        primary: t('coachPasteText'),
        secondary: t('coachKnowIt'),
      },
      permission: {
        icon: 'camera' as CoachGlyphName,
        title: t('coachPhotoPermissionDenied'),
        paragraphs: [t('coachMaterialHint')],
        primary: t('coachCamera'),
        secondary: t('coachPasteText'),
      },
    }[failure];
    return (
      <ImportState
        headerTitle={t('coachImportFailed')}
        onBack={() => router.back()}
        {...config}
        onPrimary={() => {
          if (failure === 'vision') {
            setFailure(null);
            setTimeout(() => inputRef.current?.focus(), 100);
          } else {
            setFailure(null);
            setShowSource(true);
          }
        }}
        onSecondary={() => {
          setFailure(null);
          setSourceKind('paste');
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader
        title={t('coachConfirmMaterial')}
        onBack={() => router.back()}
        right={
          <Pressable onPress={() => setShowSource(true)} hitSlop={12}>
            <Text style={{ color: c.inkMuted, fontSize: 12 }}>{t('coachRecognizeAgain')}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.sourceLine}>
          <View style={[styles.sourceDot, { backgroundColor: c.accent }]} />
          <Text style={{ color: c.inkMuted, fontSize: 11.5, flex: 1 }}>
            {sourceKind === 'paste'
              ? t('coachPasteDesc')
              : t('coachRecognizedSource', { count: sourceCount })}
          </Text>
        </View>

        <TextInput
          ref={inputRef}
          accessibilityLabel="interview-material-input"
          value={text}
          onChangeText={setText}
          placeholder={t('coachPastePlaceholder')}
          placeholderTextColor={c.inkMuted}
          multiline
          maxLength={20_000}
          style={[
            styles.input,
            { backgroundColor: c.card, color: c.ink, borderColor: c.border },
          ]}
        />
        <View style={styles.counterRow}>
          <Text style={{ color: c.inkMuted, fontSize: 11 }}>
            {t('coachDeletedCount', { count: deletedCount })}
          </Text>
          <Text style={{ color: c.inkMuted, fontSize: 11 }}>{text.length} / 20000</Text>
        </View>

        <SensitiveHints
          hits={hits}
          onDelete={() => {
            setDeletedCount((value) => value + hits.length);
            setText((value) => removeSensitiveHits(value, hits));
          }}
        />
        <View style={[styles.risk, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={{ color: c.inkMuted, fontSize: 12, lineHeight: 18 }}>
            {t('coachRiskNotice')}
          </Text>
        </View>
        {error ? <Text style={{ color: c.accent, marginTop: 10 }}>{error}</Text> : null}
        <View style={styles.actions}>
          <PrimaryButton
            label={busy ? t('saving') : t('coachGenerateProfile')}
            onPress={() => void generate()}
            disabled={busy || !text.trim()}
            variant="accent"
          />
          <Text style={{ color: c.inkMuted, fontSize: 11, textAlign: 'center' }}>
            {t('coachGenerateHint')}
          </Text>
        </View>
      </ScrollView>

      <MaterialSourceSheet
        visible={showSource}
        title={kind === 'job' ? t('coachAddJob') : t('coachAddResume')}
        onCancel={() => setShowSource(false)}
        onSelect={chooseSource}
      />
    </SafeAreaView>
  );
}

function ImportState({
  headerTitle,
  onBack,
  icon,
  title,
  paragraphs,
  primary,
  secondary,
  onPrimary,
  onSecondary,
}: {
  headerTitle: string;
  onBack: () => void;
  icon: CoachGlyphName;
  title: string;
  paragraphs: string[];
  primary: string;
  secondary?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={headerTitle} onBack={onBack} />
      <View style={styles.stateBody}>
        <View style={[styles.stateIcon, { backgroundColor: c.card, borderColor: c.border }]}>
          <CoachGlyph name={icon} color={c.accent} size={28} />
        </View>
        <Text style={[styles.stateTitle, { color: c.ink }]}>{title}</Text>
        {paragraphs.map((paragraph) => (
          <Text key={paragraph} style={[styles.stateParagraph, { color: c.inkMuted }]}>
            {paragraph}
          </Text>
        ))}
        <View style={styles.stateActions}>
          <PrimaryButton label={primary} onPress={onPrimary} variant="accent" />
          {secondary && onSecondary ? (
            <SecondaryButton label={secondary} onPress={onSecondary} />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  sourceLine: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  input: {
    minHeight: 300,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    textAlignVertical: 'top',
    fontSize: 12.5,
    lineHeight: 21,
  },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  risk: { borderRadius: 13, borderWidth: 1, padding: 13, marginTop: 12 },
  actions: { gap: 9, marginTop: 18 },
  stateBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, paddingBottom: 60 },
  stateIcon: { width: 96, height: 96, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { fontSize: 20, fontWeight: '700', marginTop: 24, textAlign: 'center' },
  stateParagraph: { fontSize: 13, lineHeight: 21, marginTop: 10, textAlign: 'center' },
  stateActions: { alignSelf: 'stretch', gap: 9, marginTop: 26 },
});
