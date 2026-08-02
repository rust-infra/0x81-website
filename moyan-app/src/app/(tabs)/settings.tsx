import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
} from '../../lib/speech';
import { useTheme } from '../../lib/theme-context';
import { useToast } from '../../lib/toast';
import { screen, serif } from '../../lib/ui';
import { voicesForProvider, type VoiceOption } from '../../lib/voices';

const PROVIDERS = [
  { key: 'webspeech', labelKey: 'providerWebspeech' },
  { key: 'google', labelKey: 'providerGoogle' },
  { key: 'elevenlabs', labelKey: 'providerElevenlabs' },
  { key: 'aliyun', labelKey: 'providerAliyun' },
] as const;

export default function SettingsScreen() {
  const { theme, themeName, setTheme, themes } = useTheme();
  const { user, signOut } = useAuth();
  const { lang, setLang, t } = useI18n();
  const toast = useToast();
  const c = theme.colors;
  const [speech, setSpeech] = useState<SpeechSettings | null>(null);
  const [voicePicker, setVoicePicker] = useState<'en' | 'zh' | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('settings_last_sync')
      .then((v) => {
        if (v) setLastSync(new Date(v));
      })
      .catch(() => {});
  }, []);

  const currentVoiceValue = (zh: boolean): string => {
    switch (speech?.provider) {
      case 'google':
        return zh ? speech.googleZhVoice || '' : speech.googleVoice || '';
      case 'elevenlabs':
        return zh ? speech.elevenLabsZhVoiceId || '' : speech.elevenLabsVoiceId || '';
      case 'aliyun':
        return zh ? speech.aliyunVoice || '' : speech.aliyunVoice || '';
      default:
        return '';
    }
  };

  const currentVoiceName = (zh: boolean): string => {
    const id = currentVoiceValue(zh);
    if (!id) return '—';
    const found = voicesForProvider(speech?.provider, zh).find((v) => v.id === id);
    return found ? found.name : id;
  };

  const pickVoice = (option: VoiceOption) => {
    if (!speech) return;
    if (speech.provider === 'google') {
      updateSpeech(voicePicker === 'zh' ? { googleZhVoice: option.id } : { googleVoice: option.id });
    } else if (speech.provider === 'elevenlabs') {
      updateSpeech(voicePicker === 'zh' ? { elevenLabsZhVoiceId: option.id } : { elevenLabsVoiceId: option.id });
    } else if (speech.provider === 'aliyun') {
      updateSpeech({ aliyunVoice: option.id });
    }
    setVoicePicker(null);
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
      if (remote.language) setLang(remote.language as 'zh-CN' | 'en');
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

  const updateSpeech = (patch: Partial<SpeechSettings>) => {
    setSpeech((prev) => {
      const next = { ...(prev || {}), ...patch };
      void saveSpeechSettings(next);
      return next;
    });
  };

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
      if (remote.language) setLang(remote.language as 'zh-CN' | 'en');
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

  const changeLanguage = async (next: 'zh-CN' | 'en') => {
    setLang(next);
    try {
      await saveUserSettings({ language: next });
      toast(t('saved'));
    } catch {
      // 后端不可达时仅本地生效
    }
  };

  const speed = speech?.speech_speed ?? 0.9;

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          {t('tabSettings')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('theme')}</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {themes.map((th) => {
            const active = th.name === themeName;
            return (
              <Pressable
                key={th.name}
                style={[styles.row, active && { backgroundColor: c.tagBg }]}
                onPress={() => setTheme(th.name)}
              >
                <View style={[styles.themeDot, { backgroundColor: th.preview }]} />
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: c.ink }]}>{th.label}</Text>
                  <Text style={[styles.rowDesc, { color: c.inkMuted }]}>{th.description}</Text>
                </View>
                <Text style={[styles.check, active ? { color: c.accent } : { color: 'transparent' }]}>✓</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('language')}</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <View style={styles.langRow}>
            {(['zh-CN', 'en'] as const).map((lg) => (
              <Pressable
                key={lg}
                style={[
                  styles.langBtn,
                  { borderColor: c.border },
                  lang === lg && { backgroundColor: c.accent, borderColor: c.accent },
                ]}
                onPress={() => changeLanguage(lg)}
              >
                <Text style={{ color: lang === lg ? '#fff' : c.ink }}>
                  {lg === 'zh-CN' ? '中文' : 'English'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('voice')}</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {PROVIDERS.map((p) => (
            <Pressable
              key={p.key}
              style={[styles.row, speech?.provider === p.key && { backgroundColor: c.tagBg }]}
              onPress={() => updateSpeech({ provider: p.key })}
            >
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t(p.labelKey)}</Text>
              <Text
                style={[styles.check, speech?.provider === p.key ? { color: c.accent } : { color: 'transparent' }]}
              >
                ✓
              </Text>
            </Pressable>
          ))}

          {speech?.provider !== 'webspeech' && (
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder={speech?.provider === 'google' ? 'Google API Key' : speech?.provider === 'elevenlabs' ? 'ElevenLabs API Key' : '阿里云 API Key'}
              placeholderTextColor={c.inkMuted}
              secureTextEntry
              value={
                speech?.provider === 'google'
                  ? speech.googleKey || ''
                  : speech?.provider === 'elevenlabs'
                    ? speech.elevenLabsKey || ''
                    : speech?.aliyunKey || ''
              }
              onChangeText={(v) =>
                updateSpeech(
                  speech?.provider === 'google'
                    ? { googleKey: v }
                    : speech?.provider === 'elevenlabs'
                      ? { elevenLabsKey: v }
                      : { aliyunKey: v }
                )
              }
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          {speech?.provider !== 'webspeech' && speech?.provider !== 'aliyun' && (
            <>
              <Pressable
                style={styles.row}
                onPress={() => setVoicePicker('en')}
              >
                <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceEn')}</Text>
                <Text style={{ color: c.inkMuted, fontSize: 13 }} numberOfLines={1}>
                  {currentVoiceName(false)}
                </Text>
              </Pressable>
              <Pressable style={styles.row} onPress={() => setVoicePicker('zh')}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceZh')}</Text>
                <Text style={{ color: c.inkMuted, fontSize: 13 }} numberOfLines={1}>
                  {currentVoiceName(true)}
                </Text>
              </Pressable>
            </>
          )}
          {speech?.provider === 'aliyun' && (
            <Pressable style={styles.row} onPress={() => setVoicePicker('zh')}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{t('voiceZh')}</Text>
              <Text style={{ color: c.inkMuted, fontSize: 13 }} numberOfLines={1}>
                {currentVoiceName(true)}
              </Text>
            </Pressable>
          )}

          <View style={[styles.row, { paddingVertical: 14 }]}>
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

          <View style={[styles.row, { paddingVertical: 14 }]}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('autoSpeak')}</Text>
            <Switch
              value={!!speech?.auto_play}
              onValueChange={(v) => updateSpeech({ auto_play: v })}
              trackColor={{ true: c.accent, false: c.divider }}
            />
          </View>

          <View style={[styles.row, { paddingVertical: 14 }]}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('audioCache')}</Text>
            <Switch
              value={speech?.cacheEnabled !== false}
              onValueChange={(v) => updateSpeech({ cacheEnabled: v })}
              trackColor={{ true: c.accent, false: c.divider }}
            />
          </View>
          <Pressable style={styles.row} onPress={handleClearCache}>
            <Text style={{ color: c.accent, fontSize: 14 }}>{t('clearCache')}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={handleTestVoice}>
            <Text style={{ color: c.ink, fontSize: 14, fontWeight: '500' }}>{t('testVoiceEn')}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={handleTestVoiceZh}>
            <Text style={{ color: c.ink, fontSize: 14, fontWeight: '500' }}>{t('testVoiceZh')}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={handleReset}>
            <Text style={{ color: c.inkMuted, fontSize: 14 }}>{t('resetDefaults')}</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('sync')}</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          <Text style={[styles.rowDesc, { color: c.inkMuted, paddingHorizontal: 12, paddingTop: 8 }]}>
            {t('lastSync')}: {lastSync ? lastSync.toLocaleString() : t('never')}
          </Text>
          <Pressable style={[styles.syncBtn, { backgroundColor: c.buttonBg }]} onPress={syncToBackend}>
            <Text style={{ color: c.buttonText }}>{t('uploadSettings')}</Text>
          </Pressable>
          <Pressable style={[styles.syncBtn, { backgroundColor: `${c.accent}18` }]} onPress={downloadSettings}>
            <Text style={{ color: c.accent }}>{t('downloadSettings')}</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>{t('account')}</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
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
              <View style={styles.accountBody}>
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
          <Pressable style={[styles.logout, { backgroundColor: `${c.accent}18` }]} onPress={signOut}>
            <Text style={{ color: c.accent }}>{t('logout')}</Text>
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
              data={voicesForProvider(speech?.provider, voicePicker === 'zh')}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, currentVoiceValue(voicePicker === 'zh') === item.id && { backgroundColor: c.tagBg }]}
                  onPress={() => pickVoice(item)}
                >
                  <Text style={[styles.rowTitle, { color: c.ink }]} numberOfLines={1}>
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
  body: { paddingBottom: 120 },
  sectionTitle: { fontSize: 13, fontWeight: '500', marginTop: 8, marginBottom: 10 },
  card: { borderRadius: 16, padding: 6, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  themeDot: { width: 30, height: 30, borderRadius: 15, marginRight: 14 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowDesc: { fontSize: 12, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '700' },
  langRow: { flexDirection: 'row', gap: 10, padding: 8 },
  langBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
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
  syncBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  logout: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 16, fontWeight: '600' },
  accountBody: { flex: 1 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
});
