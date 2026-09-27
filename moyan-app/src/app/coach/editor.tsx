import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CoachGlyph,
  CoachGroup,
  CoachHeader,
  CoachRow,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from '../../components/coach/CoachUi';
import { draftCoachScenario } from '../../lib/coach-api-runtime';
import {
  deleteCustomScenario,
  loadCustomScenarios,
  saveCustomScenario,
} from '../../lib/coach-storage';
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
import { confirmAsync, useToast } from '../../lib/toast';
import { serif } from '../../lib/ui';

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
  const [draftGenerated, setDraftGenerated] = useState(false);

  useEffect(() => {
    if (!scenarioId) return;
    void loadCustomScenarios().then((items) => {
      const found = items.find((item) => item.id === scenarioId);
      if (!found) return;
      setScenario(found);
      setFocusText(found.focus_points.join(', '));
      setDraftGenerated(true);
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
      setDraftGenerated(true);
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

  const categoryOptions = [
    { value: 'daily', label: t('coachCategoryDaily') },
    { value: 'engineering', label: t('coachCategoryEngineering') },
    { value: 'high_stakes', label: t('coachCategoryHighStakes') },
  ];
  const toneOptions = [
    { value: 'friendly', label: t('coachToneFriendly') },
    { value: 'neutral', label: t('coachToneNeutral') },
    { value: 'direct', label: t('coachToneDirect') },
    { value: 'challenging', label: t('coachToneChallenging') },
  ];
  const settingOptions = [
    { value: 'meeting', label: t('coachSettingMeeting') },
    { value: 'one_on_one', label: t('coachSettingOneOnOne') },
    { value: 'coffee_chat', label: t('coachSettingCoffeeChat') },
    { value: 'phone_call', label: t('coachSettingPhoneCall') },
  ];
  const difficultyOptions = [
    { value: 'easy', label: t('coachDifficultyEasy') },
    { value: 'core', label: t('coachDifficultyCore') },
    { value: 'challenge', label: t('coachDifficultyChallenge') },
  ];

  const remove = async () => {
    if (!scenarioId) return;
    const ok = await confirmAsync(t('coachDelete'), scenario.title);
    if (!ok) return;
    await deleteCustomScenario(scenarioId);
    toast(t('saved'));
    router.replace('/(tabs)/coach');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader
        title={scenarioId ? t('coachEdit') : t('coachNewScenario')}
        onBack={() => router.back()}
        right={
          <Pressable onPress={() => void save()} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '700' }}>{t('save')}</Text>
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.draftCard, { backgroundColor: c.accentLight }]}>
          <View style={styles.draftTitleRow}>
            <CoachGlyph name="spark" color={c.accent} size={17} />
            <Text style={[styles.draftTitle, { color: c.accent }]}>{t('coachAiDraftTitle')}</Text>
          </View>
          <Text style={[styles.draftDesc, { color: c.inkLight }]}>{t('coachAiDraftDesc')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.draftInput,
              { backgroundColor: c.card, color: c.ink, borderColor: 'transparent' },
            ]}
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
            style={[styles.draftButton, { backgroundColor: busy ? c.inkMuted : c.accent }]}
          >
            <Text style={{ color: c.buttonText, fontWeight: '700' }}>
              {busy ? t('saving') : draftGenerated ? t('coachRegenerate') : t('coachGenerateDraft')}
            </Text>
          </Pressable>
          <Text style={[styles.hint, { color: c.inkMuted }]}>{t('coachPrivacyHint')}</Text>
        </View>

        <SectionLabel>{t('coachFromTemplate')}</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {['incident_sync', 'scope_deadline', 'cross_timezone_handoff', 'growth_1on1'].map((id) => {
            const template = scenarioFromTemplate(id, lang);
            if (!template) return null;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  apply({ ...template, id: scenario.id });
                  setDraftGenerated(true);
                }}
                style={[styles.chip, { backgroundColor: c.inputBg, borderColor: c.border }]}
              >
                <Text style={{ color: c.ink, fontSize: 12 }}>{template.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {draftGenerated ? (
          <>
            <SectionLabel>{t('coachGeneratedFields')}</SectionLabel>
            <CoachGroup>
              <CoachRow
                title={t('coachPersonaSummary')}
                subtitle={`${scenario.persona.name} · ${scenario.persona.role}`}
                meta={`${scenario.persona.locale} · ${toneOptions.find((item) => item.value === scenario.persona.tone)?.label ?? scenario.persona.tone}`}
              />
              <CoachRow
                title={t('coachOpeningLine')}
                subtitle={scenario.opening_line || t('coachPasteText')}
                meta={scenario.opening_line ? t('coachKept') : undefined}
              />
              <CoachRow
                title={t('coachFocusPoints')}
                subtitle={focusText || '—'}
                meta={t('coachItems', {
                  count: focusText.split(/[,，、]/).filter((item) => item.trim()).length,
                })}
              />
              <CoachRow
                title={`${t('coachDifficulty')} / ${t('coachMaxTurns')}`}
                subtitle={`${t(
                  scenario.difficulty === 'easy'
                    ? 'coachDifficultyEasy'
                    : scenario.difficulty === 'challenge'
                      ? 'coachDifficultyChallenge'
                      : 'coachDifficultyCore'
                )} · ${t('coachTurns', { count: scenario.max_turns })}`}
              />
            </CoachGroup>
          </>
        ) : null}

        <SectionLabel>{t('coachManualEntry')}</SectionLabel>
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
        <Text style={[styles.fieldLabel, { color: c.inkLight }]}>{t('coachPersonaLabel')}</Text>
        <View style={styles.twoColumns}>
          <Field
            style={styles.twoColumnField}
            hideLabel
            label={t('coachPersonaName')}
            value={scenario.persona.name}
            onChange={(value) => apply({ ...scenario, persona: { ...scenario.persona, name: value } })}
            invalid={!!errors.name}
            maxLength={40}
          />
          <Field
            style={styles.twoColumnField}
            hideLabel
            label={t('coachPersonaRole')}
            value={scenario.persona.role}
            onChange={(value) => apply({ ...scenario, persona: { ...scenario.persona, role: value } })}
            invalid={!!errors.role}
            maxLength={80}
          />
        </View>
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
          options={categoryOptions}
          selected={scenario.category}
          onSelect={(value) => apply({ ...scenario, category: value as CoachCategory })}
        />
        <Selector
          label={t('coachLocale')}
          options={['en-US', 'en-GB', 'en-IN', 'en-AU', 'zh-CN'].map((value) => ({ value, label: value }))}
          selected={scenario.persona.locale}
          onSelect={(value) =>
            apply({ ...scenario, persona: { ...scenario.persona, locale: value as CoachLocale } })
          }
        />
        {scenario.persona.locale === 'zh-CN' ? (
          <Text style={[styles.hint, { color: c.inkMuted }]}>{t('coachAccentHint')}</Text>
        ) : null}
        <Selector
          label={t('coachTone')}
          options={toneOptions}
          selected={scenario.persona.tone}
          onSelect={(value) =>
            apply({ ...scenario, persona: { ...scenario.persona, tone: value as CoachTone } })
          }
        />
        <Selector
          label={t('coachSetting')}
          options={settingOptions}
          selected={scenario.setting}
          onSelect={(value) => apply({ ...scenario, setting: value as CoachSetting })}
        />
        <Selector
          label={t('coachDifficulty')}
          options={difficultyOptions}
          selected={scenario.difficulty}
          onSelect={(value) => apply({ ...scenario, difficulty: value as CoachDifficulty })}
        />
        <Field
          label={t('coachMaxTurns')}
          value={String(scenario.max_turns)}
          onChange={(value) => apply({ ...scenario, max_turns: Number(value) || 3 })}
          keyboardType="number-pad"
        />

        <View style={styles.actions}>
          <PrimaryButton label={t('coachSaveScenario')} onPress={() => void save()} variant="accent" />
          {scenarioId ? (
            <SecondaryButton label={t('coachDelete')} onPress={() => void remove()} />
          ) : null}
        </View>
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
  style,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad';
  style?: object;
  hideLabel?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.field, style]}>
      {hideLabel ? null : (
        <Text style={[styles.fieldLabel, { color: c.inkLight }]}>{label}</Text>
      )}
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
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.inkLight }]}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            style={[
              styles.chip,
              {
                backgroundColor: option.value === selected ? c.accentLight : c.inputBg,
                borderColor: option.value === selected ? c.accent : c.border,
              },
            ]}
          >
            <Text
              style={{
                color: option.value === selected ? c.accent : c.inkLight,
                fontSize: 12,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  draftCard: { borderRadius: 16, padding: 15 },
  draftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  draftTitle: { fontSize: 14, fontWeight: '700' },
  draftDesc: { fontSize: 11.5, lineHeight: 18, marginTop: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13.5,
  },
  draftInput: { minHeight: 74, textAlignVertical: 'top', marginTop: 10, fontSize: 13.5 },
  draftButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  hint: { fontSize: 11, lineHeight: 17, marginTop: 10 },
  field: { marginTop: 15 },
  fieldLabel: { fontSize: 11.5, fontWeight: '600', marginBottom: 6 },
  multiline: { minHeight: 74, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: 8 },
  twoColumnField: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  actions: { gap: 10, marginTop: 24 },
});
