import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoachHeader } from '../components/coach/CoachUi';
import { Group, SectionLabel } from '../components/Group';
import { useI18n } from '../lib/i18n';
import { getSpeechSettings, saveSpeechSettings, type SpeechSettings } from '../lib/speech';
import { useTheme } from '../lib/theme-context';

/**
 * 语音服务的密钥与模型。
 *
 * 这些字段「配一次就不再动」，放在设置主页会把页面撑到 2.5 屏（见 2026-09-28 的
 * 设置页密度整理）。主页只留两条摘要行 —— 识别一条、发音一条 —— 各自紧跟对应的
 * provider 选择器，用 `?scope=stt|tts` 进来只渲染那一段。
 */
export default function SpeechSettingsScreen() {
  const router = useRouter();
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { t } = useI18n();
  const { theme } = useTheme();
  const c = theme.colors;
  const [speech, setSpeech] = useState<SpeechSettings | null>(null);

  useEffect(() => {
    void getSpeechSettings().then(setSpeech);
  }, []);

  const update = (patch: Partial<SpeechSettings>) => {
    setSpeech((prev) => {
      const next = { ...(prev ?? {}), ...patch } as SpeechSettings;
      void saveSpeechSettings(next);
      return next;
    });
  };

  const sttProvider = speech?.sttProvider ?? 'system';
  const ttsProvider = speech?.provider ?? 'webspeech';

  const showStt = scope !== 'tts';
  const showTts = scope !== 'stt';
  const title =
    scope === 'stt' ? t('sttKeys') : scope === 'tts' ? t('ttsKeys') : t('speechSettingsTitle');

  const inputStyle = [
    styles.input,
    { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border },
  ];
  const placeholderColor = c.inkMuted;

  const ttsKey = {
    google: speech?.googleKey ?? '',
    elevenlabs: speech?.elevenLabsKey ?? '',
    aliyun: speech?.aliyunKey ?? '',
  } as Record<string, string>;

  const setTtsKey = (value: string) => {
    if (ttsProvider === 'google') update({ googleKey: value });
    else if (ttsProvider === 'elevenlabs') update({ elevenLabsKey: value });
    else if (ttsProvider === 'aliyun') update({ aliyunKey: value });
  };

  const googleCloudReady = !!speech?.googleCloudServiceAccountJson?.trim();
  const geminiReady = !!speech?.geminiApiKey?.trim();
  const ttsReady = !!ttsKey[ttsProvider];

  const sttSection = (
    <>
      <SectionLabel>{t('sttLabel')}</SectionLabel>
      <Group>
        {sttProvider === 'google-cloud' ? (
          <>
            <View style={styles.field}>
              <TextInput
                style={[...inputStyle, styles.multiline]}
                placeholder={t('googleCloudServiceAccount')}
                placeholderTextColor={placeholderColor}
                value={speech?.googleCloudServiceAccountJson || ''}
                onChangeText={(value) => update({ googleCloudServiceAccountJson: value })}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
            </View>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('googleCloudProject')}
                placeholderTextColor={placeholderColor}
                value={speech?.googleCloudProjectId || ''}
                onChangeText={(value) => update({ googleCloudProjectId: value })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('googleCloudLocation')}
                placeholderTextColor={placeholderColor}
                value={speech?.googleCloudLocation || ''}
                onChangeText={(value) => update({ googleCloudLocation: value })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('googleCloudModel')}
                placeholderTextColor={placeholderColor}
                value={speech?.googleCloudSttModel || ''}
                onChangeText={(value) => update({ googleCloudSttModel: value })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.hint}>
              <Text style={[styles.hintText, { color: c.inkMuted }]}>{t('googleCloudKeyHint')}</Text>
            </View>
            {!googleCloudReady ? (
              <View style={styles.hint}>
                <Text style={[styles.hintText, { color: c.accent }]}>
                  {t('googleCloudKeyMissing')}
                </Text>
              </View>
            ) : null}
          </>
        ) : sttProvider === 'gemini' ? (
          <>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('geminiApiKey')}
                placeholderTextColor={placeholderColor}
                secureTextEntry
                value={speech?.geminiApiKey || ''}
                onChangeText={(value) => update({ geminiApiKey: value })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('geminiModel')}
                placeholderTextColor={placeholderColor}
                value={speech?.geminiSttModel || ''}
                onChangeText={(value) => update({ geminiSttModel: value })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.hint}>
              <Text style={[styles.hintText, { color: c.inkMuted }]}>{t('geminiKeyHint')}</Text>
            </View>
            {!geminiReady ? (
              <View style={styles.hint}>
                <Text style={[styles.hintText, { color: c.accent }]}>{t('geminiKeyMissing')}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.hint}>
            <Text style={[styles.hintText, { color: c.inkMuted }]}>{t('currentSttHint')}</Text>
          </View>
        )}
      </Group>
    </>
  );

  const ttsSection = (
    <>
      <SectionLabel>{t('ttsLabel')}</SectionLabel>
      <Group>
        {ttsProvider === 'webspeech' ? (
          <View style={styles.hint}>
            <Text style={[styles.hintText, { color: c.inkMuted }]}>{t('noKeyNeeded')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.field}>
              <TextInput
                style={inputStyle}
                placeholder={t('apiKeyPlaceholder')}
                placeholderTextColor={placeholderColor}
                secureTextEntry
                value={ttsKey[ttsProvider] ?? ''}
                onChangeText={setTtsKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {!ttsReady ? (
              <View style={styles.hint}>
                <Text style={[styles.hintText, { color: c.inkMuted }]}>
                  {t('apiKeyMissingHint')}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </Group>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top', 'bottom']}>
      <CoachHeader title={title} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {showStt ? sttSection : null}
        {showTts ? ttsSection : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  field: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  multiline: { minHeight: 118, textAlignVertical: 'top' },
  hint: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
  hintText: { fontSize: 12, lineHeight: 17 },
});
