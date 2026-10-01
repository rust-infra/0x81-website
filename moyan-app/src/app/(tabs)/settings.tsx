import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Group, SectionLabel } from '../../components/Group';
import Segmented from '../../components/Segmented';
import { fetchUserSettings, saveUserSettings } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import {
  clearAudioCache,
  getSpeechSettings,
  resetSpeechSettings,
  saveSpeechSettings,
  speak,
  type SpeechSettings,
  type SttProvider,
} from '../../lib/speech';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { screen, serif } from '../../lib/ui';
import {
  getWebspeechVoices,
  voicesForProvider,
  type VoiceOption,
} from '../../lib/voices';

const THEME_TEXT: Record<string, { label: string; description: string }> = {
  xuanzhi: { label: 'themeXuanzhi', description: 'themeXuanzhiDesc' },
  shenyemo: { label: 'themeShenyemo', description: 'themeShenyemoDesc' },
  dailan: { label: 'themeDailan', description: 'themeDailanDesc' },
  fense: { label: 'themeFense', description: 'themeFenseDesc' },
};

// 分段控件用短标签：完整名（"ElevenLabs AI Voice"）在半宽按钮里放不下。
const TTS_SEGMENTS = [
  { key: 'webspeech', labelKey: 'segSystem' },
  { key: 'google', labelKey: 'segGoogle' },
  { key: 'elevenlabs', labelKey: 'segElevenLabs' },
  { key: 'aliyun', labelKey: 'segAliyun' },
] as const;

const STT_SEGMENTS = [
  { key: 'system', labelKey: 'segSystem' },
  { key: 'google-cloud', labelKey: 'segGoogle' },
  { key: 'gemini', labelKey: 'segGemini' },
] as const;

const LANGUAGES = [
  { key: 'zh-CN', labelKey: 'languageChinese' },
  { key: 'en', labelKey: 'languageEnglish' },
] as const;

type TtsProvider = (typeof TTS_SEGMENTS)[number]['key'];
type LangKey = (typeof LANGUAGES)[number]['key'];

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, themeName, setTheme, themes } = useTheme();
  const { user, signOut } = useAuth();
  const { lang, setLang, t } = useI18n();
  const toast = useToast();
  const c = theme.colors;
  const [speech, setSpeech] = useState<SpeechSettings | null>(null);
  const [voicePicker, setVoicePicker] = useState<'en' | 'zh' | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [systemVoices, setSystemVoices] = useState<VoiceOption[]>([]);
  const skippedFirstFocus = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('settings_last_sync')
      .then((v) => {
        if (v) setLastSync(new Date(v));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (speech?.provider === 'webspeech') {
      void getWebspeechVoices().then(setSystemVoices);
    }
  }, [speech?.provider]);

  // 密钥与模型在二级页编辑，回到本页时要重新读一次本地设置，否则摘要行是旧的。
  useFocusEffect(
    useCallback(() => {
      if (!skippedFirstFocus.current) {
        skippedFirstFocus.current = true;
        return;
      }
      void getSpeechSettings().then(setSpeech);
    }, [])
  );

  const currentVoiceValue = (zh: boolean): string => {
    switch (speech?.provider) {
      case 'google':
        return zh ? speech.googleZhVoice || '' : speech.googleVoice || '';
      case 'elevenlabs':
        return zh ? speech.elevenLabsZhVoiceId || '' : speech.elevenLabsVoiceId || '';
      case 'aliyun':
        return zh ? speech.aliyunVoice || '' : speech.aliyunVoice || '';
      case 'webspeech':
        return zh ? speech.speech_zh_voice || '' : speech.speech_voice || '';
      default:
        return '';
    }
  };

  const currentVoiceName = (zh: boolean): string => {
    const id = currentVoiceValue(zh);
    if (!id) return '—';
    const list =
      speech?.provider === 'webspeech'
        ? systemVoices
        : voicesForProvider(speech?.provider, zh);
    const found = list.find((v) => v.id === id);
    return found ? found.name : id;
  };

  const updateSpeech = (patch: Partial<SpeechSettings>) => {
    setSpeech((prev) => {
      const next = { ...(prev || {}), ...patch };
      void saveSpeechSettings(next);
      return next;
    });
  };

  const pickVoice = (option: VoiceOption) => {
    if (!speech) return;
    if (speech.provider === 'google') {
      updateSpeech(voicePicker === 'zh' ? { googleZhVoice: option.id } : { googleVoice: option.id });
    } else if (speech.provider === 'elevenlabs') {
      updateSpeech(voicePicker === 'zh' ? { elevenLabsZhVoiceId: option.id } : { elevenLabsVoiceId: option.id });
    } else if (speech.provider === 'aliyun') {
      updateSpeech({ aliyunVoice: option.id });
    } else {
      updateSpeech(
        voicePicker === 'zh'
          ? { speech_zh_voice: option.id }
          : { speech_voice: option.id }
      );
    }
    setVoicePicker(null);
  };

  const openVoicePicker = (zh: boolean) => {
    if (speech?.provider === 'webspeech' && systemVoices.length === 0) {
      void getWebspeechVoices().then(setSystemVoices);
    }
    setVoicePicker(zh ? 'zh' : 'en');
  };

  const handleClearCache = async () => {
    const cleared = await clearAudioCache();
    toast(t('cacheCleared', { count: cleared }));
  };

  const handleTestVoice = () => {
    void speak('Hello, this is a voice test.');
  };

  const handleTestVoiceZh = () => {
    void speak('你好，这是语音测试。');
  };

  const handleReset = async () => {
    const defaults = await resetSpeechSettings();
    setSpeech(defaults);
    toast(t('saved'));
  };

  const loadSettings = useCallback(async () => {
    const local = await getSpeechSettings();
    setSpeech(local);
    try {
      const remote = await fetchUserSettings();
      if (remote.language) setLang(remote.language as LangKey);
      // 仅当本机从未设置过主题/语音时才套用云端，避免覆盖用户刚点的选择
      const [themeStored, speechStored] = await Promise.all([
        AsyncStorage.getItem('app_theme'),
        AsyncStorage.getItem('speech_settings'),
      ]);
      if (!themeStored && remote.theme && themes.some((t) => t.name === remote.theme)) {
        setTheme(remote.theme as typeof themes[number]['name']);
      }
      if (!speechStored && (remote.speech_provider || remote.speech_speed != null || remote.auto_play != null)) {
        const merged: SpeechSettings = {
          ...local,
          provider: (remote.speech_provider as SpeechSettings['provider']) || local.provider,
          speech_voice: remote.speech_voice || local.speech_voice,
          speech_zh_voice: remote.speech_zh_voice || local.speech_zh_voice,
          speech_model: remote.speech_model || local.speech_model,
          speech_speed: remote.speech_speed ?? local.speech_speed,
          auto_play: remote.auto_play ?? local.auto_play,
        };
        setSpeech(merged);
        await saveSpeechSettings(merged);
      }
    } catch {
      // 后端不可达时静默
    }
  }, [setTheme, themes, setLang]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const syncToBackend = async () => {
    try {
      const s = speech || (await getSpeechSettings());
      await saveUserSettings({
        theme: themeName,
        language: lang,
        speech_provider: s.provider,
        speech_voice: s.speech_voice,
        speech_zh_voice: s.speech_zh_voice,
        speech_model: s.speech_model,
        speech_speed: s.speech_speed,
        auto_play: s.auto_play,
      });
      const now = new Date();
      setLastSync(now);
      AsyncStorage.setItem('settings_last_sync', now.toISOString()).catch(() => {});
      toast(t('synced'));
    } catch (err) {
      toast(`${t('syncFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const downloadSettings = async () => {
    try {
      const remote = await fetchUserSettings();
      if (remote.language) setLang(remote.language as LangKey);
      if (remote.theme && themes.some((t) => t.name === remote.theme)) {
        setTheme(remote.theme as typeof themes[number]['name']);
      }
      if (speech) {
        const merged: SpeechSettings = {
          ...speech,
          provider: (remote.speech_provider as SpeechSettings['provider']) || speech.provider,
          speech_voice: remote.speech_voice || speech.speech_voice,
          speech_zh_voice: remote.speech_zh_voice || speech.speech_zh_voice,
          speech_model: remote.speech_model || speech.speech_model,
          speech_speed: remote.speech_speed ?? speech.speech_speed,
          auto_play: remote.auto_play ?? speech.auto_play,
        };
        setSpeech(merged);
        await saveSpeechSettings(merged);
      }
      toast(t('restored'));
    } catch (err) {
      toast(`${t('syncFailed')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const changeLanguage = async (next: LangKey) => {
    setLang(next);
    try {
      await saveUserSettings({ language: next });
      toast(t('saved'));
    } catch {
      // 后端不可达时仅本地生效
    }
  };

  const speed = speech?.speech_speed ?? 0.9;
  const sttProvider: SttProvider = speech?.sttProvider ?? 'system';
  const ttsProvider: TtsProvider = (speech?.provider ?? 'webspeech') as TtsProvider;

  // 凭据入口按「识别 / 发音」拆开，各自紧跟对应的 provider 选择器；
  // 用系统识别或系统发音时不需要密钥，那两条就不渲染。
  const sttNeedsKey = sttProvider !== 'system';
  const sttKeyMissing =
    sttProvider === 'google-cloud'
      ? !speech?.googleCloudServiceAccountJson?.trim()
      : sttProvider === 'gemini'
        ? !speech?.geminiApiKey?.trim()
        : false;

  const ttsNeedsKey = ttsProvider !== 'webspeech';
  const ttsKeyMissing =
    ttsProvider === 'google'
      ? !speech?.googleKey
      : ttsProvider === 'elevenlabs'
        ? !speech?.elevenLabsKey
        : ttsProvider === 'aliyun'
          ? !speech?.aliyunKey
          : false;

  const showsEnVoice =
    ttsProvider === 'google' || ttsProvider === 'elevenlabs' || ttsProvider === 'webspeech';
  const showsZhVoice = showsEnVoice || ttsProvider === 'aliyun';

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          {t('tabSettings')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        <SectionLabel>{t('appearance')}</SectionLabel>
        <Group>
          <View style={styles.block}>
            <Text style={[styles.blockTitle, { color: c.ink }]}>{t('theme')}</Text>
            <View style={styles.swatchRow}>
              {themes.map((th) => {
                const active = th.name === themeName;
                return (
                  <Pressable
                    key={th.name}
                    style={styles.swatchItem}
                    onPress={() => setTheme(th.name)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <View
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: th.preview,
                          borderColor: active ? c.accent : c.border,
                          borderWidth: active ? 2 : 1,
                        },
                      ]}
                    >
                      {active ? (
                        <Text style={[styles.swatchCheck, { color: c.accent }]}>✓</Text>
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.swatchName,
                        { color: active ? c.accent : c.inkMuted },
                      ]}
                    >
                      {t(THEME_TEXT[th.name]?.label ?? '')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.inlineRow}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('language')}</Text>
            <Segmented
              style={styles.inlineControl}
              options={LANGUAGES.map((l) => ({ key: l.key, label: t(l.labelKey) }))}
              value={lang}
              onChange={(key) => void changeLanguage(key)}
            />
          </View>
        </Group>

        <SectionLabel>{t('speechSection')}</SectionLabel>
        <Group>
          <View style={styles.inlineRow}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('sttLabel')}</Text>
            <Segmented
              style={styles.inlineControl}
              options={STT_SEGMENTS.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
              value={sttProvider}
              onChange={(key) => updateSpeech({ sttProvider: key })}
            />
          </View>

          {sttNeedsKey ? (
            <Pressable style={styles.row} onPress={() => router.push('/speech-settings?scope=stt')}>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{t('sttKeys')}</Text>
                {sttKeyMissing ? (
                  <Text style={[styles.rowDesc, { color: c.accent }]}>{t('notConfigured')}</Text>
                ) : null}
              </View>
              <Text style={{ color: c.accent }}>›</Text>
            </Pressable>
          ) : null}

          <View style={styles.inlineRow}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('ttsLabel')}</Text>
            <Segmented
              style={styles.inlineControl}
              options={TTS_SEGMENTS.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
              value={ttsProvider}
              onChange={(key) => updateSpeech({ provider: key })}
            />
          </View>

          {ttsNeedsKey ? (
            <Pressable style={styles.row} onPress={() => router.push('/speech-settings?scope=tts')}>
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{t('ttsKeys')}</Text>
                {ttsKeyMissing ? (
                  <Text style={[styles.rowDesc, { color: c.accent }]}>{t('notConfigured')}</Text>
                ) : null}
              </View>
              <Text style={{ color: c.accent }}>›</Text>
            </Pressable>
          ) : null}

          {showsEnVoice ? (
            <Pressable style={styles.row} onPress={() => openVoicePicker(false)}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceEn')}</Text>
              <Text style={[styles.rowValue, { color: c.inkMuted }]} numberOfLines={1}>
                {currentVoiceName(false)}
              </Text>
            </Pressable>
          ) : null}

          {showsZhVoice ? (
            <Pressable style={styles.row} onPress={() => openVoicePicker(true)}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceZh')}</Text>
              <Text style={[styles.rowValue, { color: c.inkMuted }]} numberOfLines={1}>
                {currentVoiceName(true)}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.row}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('speechSpeed')}</Text>
            <View style={styles.speedCtrl}>
              <Pressable
                style={[styles.speedBtn, { borderColor: c.border }]}
                onPress={() => updateSpeech({ speech_speed: Math.max(0.5, +(speed - 0.1).toFixed(1)) })}
              >
                <Text style={{ color: c.ink }}>−</Text>
              </Pressable>
              <Text style={[styles.speedVal, { color: c.ink }]}>{speed.toFixed(1)}×</Text>
              <Pressable
                style={[styles.speedBtn, { borderColor: c.border }]}
                onPress={() => updateSpeech({ speech_speed: Math.min(1.5, +(speed + 0.1).toFixed(1)) })}
              >
                <Text style={{ color: c.ink }}>＋</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.row, styles.switchRow]}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('autoSpeak')}</Text>
            <Switch
              value={!!speech?.auto_play}
              onValueChange={(v) => updateSpeech({ auto_play: v })}
              trackColor={{ true: c.accent, false: c.divider }}
            />
          </View>

          <View style={[styles.row, styles.switchRow]}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('audioCache')}</Text>
            <Switch
              value={speech?.cacheEnabled !== false}
              onValueChange={(v) => updateSpeech({ cacheEnabled: v })}
              trackColor={{ true: c.accent, false: c.divider }}
            />
          </View>

          <View style={styles.testRow}>
            <Pressable style={[styles.testBtn, { borderColor: c.border }]} onPress={handleTestVoice}>
              <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13 }}>
                {t('voiceTestEn')}
              </Text>
            </Pressable>
            <Pressable style={[styles.testBtn, { borderColor: c.border }]} onPress={handleTestVoiceZh}>
              <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13 }}>
                {t('voiceTestZh')}
              </Text>
            </Pressable>
          </View>
        </Group>

        <SectionLabel>{t('coachSettingsTitle')}</SectionLabel>
        <Group>
          <Pressable style={styles.row} onPress={() => router.push('/coach/settings')}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachSettingsTitle')}</Text>
            <Text style={{ color: c.accent }}>›</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/coach/history')}>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachHistoryTitle')}</Text>
              <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{t('coachHistoryDesc')}</Text>
            </View>
            <Text style={{ color: c.accent }}>›</Text>
          </Pressable>
        </Group>

        <SectionLabel>{t('account')}</SectionLabel>
        <Group>
          {user ? (
            <View style={styles.accountRow}>
              {user.avatar ? (
                <View style={[styles.avatar, { backgroundColor: c.tagBg }]}>
                  <Text style={{ fontSize: 16 }}>👤</Text>
                </View>
              ) : (
                <View style={[styles.avatar, { backgroundColor: c.accentLight }]}>
                  <Text style={[styles.avatarText, { color: c.accent }]}>
                    {(user.name || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: c.ink }]} numberOfLines={1}>
                  {user.name || 'User'}
                </Text>
                {user.email ? (
                  <Text style={[styles.rowDesc, { color: c.inkMuted }]} numberOfLines={1}>
                    {user.email}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}
          <Pressable style={styles.row} onPress={signOut}>
            <Text style={{ color: c.accent, fontSize: 15 }}>{t('logout')}</Text>
          </Pressable>
        </Group>

        <SectionLabel>{t('actionsLabel')}</SectionLabel>
        <View style={styles.footerRow}>
          <Pressable
            style={[styles.footerBtn, { backgroundColor: c.buttonBg, borderColor: c.buttonBg }]}
            onPress={syncToBackend}
          >
            <Text numberOfLines={1} style={{ color: c.buttonText, fontSize: 13 }}>
              {t('uploadSettings')}
            </Text>
          </Pressable>
          <Pressable style={[styles.footerBtn, { borderColor: c.border }]} onPress={downloadSettings}>
            <Text numberOfLines={1} style={{ color: c.accent, fontSize: 13 }}>
              {t('downloadSettings')}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.footerCaption, { color: c.inkMuted }]}>
          {t('lastSync')}: {lastSync ? lastSync.toLocaleString() : t('never')}
        </Text>
        <View style={styles.footerRow}>
          <Pressable style={styles.footerTextBtn} onPress={handleClearCache}>
            <Text numberOfLines={1} style={{ color: c.accent, fontSize: 13 }}>
              {t('clearCache')}
            </Text>
          </Pressable>
          <Pressable style={styles.footerTextBtn} onPress={handleReset}>
            <Text numberOfLines={1} style={{ color: c.inkMuted, fontSize: 13 }}>
              {t('resetDefaults')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={voicePicker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setVoicePicker(null)}
      >
        <Pressable style={styles.mask} onPress={() => setVoicePicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: serif }]}>
              {voicePicker === 'zh' ? t('voiceZh') : t('voiceEn')}
            </Text>
            <FlatList
              data={
                speech?.provider === 'webspeech'
                  ? systemVoices.filter((v) =>
                      voicePicker === 'zh'
                        ? /zh|cmn|yue/.test(v.language)
                        : !/zh|cmn|yue/.test(v.language)
                    )
                  : voicesForProvider(speech?.provider, voicePicker === 'zh')
              }
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={[styles.sheetHint, { color: c.inkMuted }]}>
                  {t('noSystemVoices', {
                    language:
                      voicePicker === 'zh' ? t('languageChinese') : t('voiceEn'),
                  })}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.sheetRow,
                    currentVoiceValue(voicePicker === 'zh') === item.id && {
                      backgroundColor: c.tagBg,
                    },
                  ]}
                  onPress={() => pickVoice(item)}
                >
                  <Text style={[styles.rowTitle, { color: c.ink, flex: 1 }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ color: c.inkMuted, fontSize: 12 }}>{item.language}</Text>
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  switchRow: { paddingVertical: 12 },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inlineControl: { flex: 1 },
  testRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
  testBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowDesc: { fontSize: 12, marginTop: 2 },
  rowValue: { fontSize: 13, flexShrink: 1 },
  block: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  blockTitle: { fontSize: 15, fontWeight: '500' },
  swatchRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  swatchItem: { flex: 1, alignItems: 'center', gap: 5 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchCheck: { fontSize: 18, fontWeight: '700' },
  swatchName: { fontSize: 11 },
  speedCtrl: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  speedBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedVal: { fontSize: 15, minWidth: 32, textAlign: 'center' },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '600' },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  footerBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerTextBtn: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  footerCaption: { fontSize: 12, marginTop: 12 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  sheetHint: { fontSize: 12, paddingBottom: 4 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
