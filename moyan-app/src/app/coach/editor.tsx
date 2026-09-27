import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { draftCoachScenario } from '../../lib/coach-api-runtime';
import { loadCustomScenarios, saveCustomScenario } from '../../lib/coach-storage';
import type {
  CoachCategory,
  CoachDifficulty,
  CoachLocale,
  CoachScenario,
  CoachSetting,
  CoachTone,
} from '../../lib/coach-types';
import {
  normalizeCoachScenario,
  scenarioFromTemplate,
  type CoachScenarioErrors,
} from '../../lib/coach-validation';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { cardStyle, roundButton, screen, serif } from '../../lib/ui';

function newScenario(): CoachScenario {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'custom',
    category: 'engineering',
    title: '',
    description: '',
    persona: { name: 'Alex', role: 'Teammate', locale: 'en-US', tone: 'friendly' },
    setting: 'meeting',
    opening_line: '',
    focus_points: [],
    difficulty: 'core',
    max_turns: 8,
  };
}

export default function CoachEditorScreen() {
  const { scenarioId } = useLocalSearchParams<{ scenarioId?: string }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const c = theme.colors;
  const [scenario, setScenario] = useState<CoachScenario>(newScenario);
  const [description, setDescription] = useState('');
  const [focusText, setFocusText] = useState('');
  const [errors, setErrors] = useState<CoachScenarioErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scenarioId) return;
    void loadCustomScenarios().then((items) => {
      const found = items.find((item) => item.id === scenarioId);
      if (!found) return;
      setScenario(found);
      setFocusText(found.focus_points.join(', '));
    });
  }, [scenarioId]);

  const apply = (next: CoachScenario) => {
    setScenario(next);
    setFocusText(next.focus_points.join(', '));
    setErrors({});
  };

  const generate = async () => {
    if (!description.trim()) return;
    setBusy(true);
    try {
      const draft = await draftCoachScenario(description.trim(), lang);
      apply({ ...draft, id: scenario.id, source: 'custom' });
    } catch {
      toast(t('coachDraftFailed'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const focusPoints = focusText
      .split(/[,，、]/)
      .map((point) => point.trim())
      .filter(Boolean);
    const result = normalizeCoachScenario({ ...scenario, focus_points: focusPoints });
    if (!result.ok) {
      setErrors(result.errors);
      toast(t('coachValidationFailed'));
      return;
    }
    await saveCustomScenario(result.scenario);
    toast(t('saved'));
    router.replace('/(tabs)/coach');
  };

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <View style={screen.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={[roundButton, { backgroundColor: c.inputBg }]}
          >
            <Text style={{ color: c.ink, fontSize: 24, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
            {scenarioId ? t('coachEdit') : t('coachNew')}
          </Text>
          <Pressable onPress={() => void save()} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '700' }}>{t('save')}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={[screen.body, styles.body]} keyboardShouldPersistTaps="handled">
        <View style={[cardStyle(c.card, c.border), styles.draftCard]}>
          <Text style={[styles.cardTitle, { color: c.ink, fontFamily: serif }]}>
            {t('coachAiDraft')}
          </Text>
          <TextInput
            style={[styles.input, styles.draftInput, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('coachAiDraftPlaceholder')}
            placeholderTextColor={c.inkMuted}
            multiline
            maxLength={200}
          />
          <Pressable
            disabled={busy || !description.trim()}
            onPress={() => void generate()}
            style={[styles.primarySmall, { backgroundColor: busy ? c.inkMuted : c.buttonBg }]}
          >
            <Text style={{ color: c.buttonText, fontWeight: '600' }}>
              {busy ? t('saving') : t('coachGenerateDraft')}
            </Text>
          </Pressable>
          <Text style={[styles.hint, { color: c.inkMuted }]}>{t('coachPrivacyHint')}</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('coachFromTemplate')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {['incident_sync', 'scope_deadline', 'cross_timezone_handoff', 'growth_1on1'].map((id) => {
            const template = scenarioFromTemplate(id);
            if (!template) return null;
            return (
              <Pressable
                key={id}
                onPress={() => apply({ ...template, id: scenario.id })}
                style={[styles.chip, { backgroundColor: c.inputBg, borderColor: c.border }]}
              >
                <Text style={{ color: c.ink, fontSize: 12 }}>{template.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Field
          label={t('coachTitle')}
          value={scenario.title}
          onChange={(value) => apply({ ...scenario, title: value })}
          invalid={!!errors.title}
          maxLength={80}
        />
        <Field
          label={t('coachDescription')}
          value={scenario.description}
          onChange={(value) => apply({ ...scenario, description: value })}
          invalid={!!errors.description}
          multiline
          maxLength={220}
        />
        <Field
          label={t('coachPersonaName')}
          value={scenario.persona.name}
          onChange={(value) => apply({ ...scenario, persona: { ...scenario.persona, name: value } })}
          invalid={!!errors.name}
          maxLength={40}
        />
        <Field
          label={t('coachPersonaRole')}
          value={scenario.persona.role}
          onChange={(value) => apply({ ...scenario, persona: { ...scenario.persona, role: value } })}
          invalid={!!errors.role}
          maxLength={80}
        />
        <Field
          label={t('coachOpeningLine')}
          value={scenario.opening_line}
          onChange={(value) => apply({ ...scenario, opening_line: value })}
          invalid={!!errors.opening_line}
          multiline
          maxLength={220}
        />
        <Field
          label={t('coachFocusPoints')}
          value={focusText}
          onChange={setFocusText}
          invalid={!!errors.focus_points}
          multiline
        />

        <Selector
          label={t('coachCategory')}
          values={['daily', 'engineering', 'high_stakes']}
          selected={scenario.category}
          onSelect={(value) => apply({ ...scenario, category: value as CoachCategory })}
        />
        <Selector
          label={t('coachLocale')}
          values={['en-US', 'en-GB', 'en-IN', 'en-AU', 'zh-CN']}
          selected={scenario.persona.locale}
          onSelect={(value) =>
            apply({ ...scenario, persona: { ...scenario.persona, locale: value as CoachLocale } })
          }
        />
        <Selector
          label={t('coachTone')}
          values={['friendly', 'neutral', 'direct', 'challenging']}
          selected={scenario.persona.tone}
          onSelect={(value) =>
            apply({ ...scenario, persona: { ...scenario.persona, tone: value as CoachTone } })
          }
        />
        <Selector
          label={t('coachSetting')}
          values={['meeting', 'one_on_one', 'coffee_chat', 'phone_call']}
          selected={scenario.setting}
          onSelect={(value) => apply({ ...scenario, setting: value as CoachSetting })}
        />
        <Selector
          label={t('coachDifficulty')}
          values={['easy', 'core', 'challenge']}
          selected={scenario.difficulty}
          onSelect={(value) => apply({ ...scenario, difficulty: value as CoachDifficulty })}
        />
        <Field
          label={t('coachMaxTurns')}
          value={String(scenario.max_turns)}
          onChange={(value) => apply({ ...scenario, max_turns: Number(value) || 3 })}
          keyboardType="number-pad"
        />

        <Pressable onPress={() => void save()} style={[styles.primary, { backgroundColor: c.buttonBg }]}>
          <Text style={{ color: c.buttonText, fontWeight: '700' }}>{t('coachSaveScenario')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  invalid,
  multiline,
  maxLength,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad';
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.field}>
      <Text style={{ color: c.inkLight, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            backgroundColor: c.inputBg,
            color: c.ink,
            borderColor: invalid ? c.accent : c.border,
          },
        ]}
      />
    </View>
  );
}

function Selector({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.field}>
      <Text style={{ color: c.inkLight, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      <View style={styles.chips}>
        {values.map((value) => (
          <Pressable
            key={value}
            onPress={() => onSelect(value)}
            style={[
              styles.chip,
              {
                backgroundColor: value === selected ? c.accentLight : c.inputBg,
                borderColor: value === selected ? c.accent : c.border,
              },
            ]}
          >
            <Text style={{ color: value === selected ? c.accent : c.inkLight, fontSize: 12 }}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  body: { paddingBottom: 40 },
  draftCard: { marginBottom: 18 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  draftInput: { minHeight: 78, textAlignVertical: 'top' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  primarySmall: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginTop: 10 },
  primary: { alignItems: 'center', borderRadius: 16, paddingVertical: 15, marginTop: 22 },
  hint: { fontSize: 11, lineHeight: 17, marginTop: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  field: { marginTop: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
});
