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
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { getSyncedSettings, putSyncedSettings } from '../../lib/rehearse-api-runtime';
import { applySyncedSettings, buildSyncedSettings } from '../../lib/rehearse-sync';
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
  light: { label: 'themeLight', description: 'themeLightDesc' },
  dark: { label: 'themeDark', description: 'themeDarkDesc' },
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
  const [systemVoices, setSystemVoices] = useState<VoiceOption[]>([]);
  const skippedFirstFocus = useRef(false);
  // 最新一份语音设置。事件处理器闭包里的 `speech` 可能是上一次渲染的，
  // 连续两次改动（比如连点两个开关）会丢掉前一次。
  const speechRef = useRef<SpeechSettings | null>(null);
  // 本次进入设置页后用户改过设置。远端文档可能是改动之前的快照，
  // 这时再套用会把刚改的那一项冲掉。
  const editedRef = useRef(false);
  // 上传队列只保留「还有一份没发」这一个事实。文档在**发送那一刻**才从
  // 上面几个 ref 组装，所以连续改动合并成最后一次，且服务端最终拿到的是最新状态。
  const pendingPushRef = useRef(false);
  const pushingRef = useRef(false);

  // 排队上传读的是发送时的值，不是排队时的闭包。处理器改完状态要同步写这里，
  // 因为 setState 触发的重渲染发生在 push 之后。
  const themeNameRef = useRef(themeName);
  const langRef = useRef(lang);
  themeNameRef.current = themeName;
  langRef.current = lang;

  // 本机上次成功同步时服务端给的 updated_at。远端不比它新就不覆盖本机——
  // 两台设备各自改设置时，后写的那台赢（设计稿 §7.5.1）。
  //
  // 键按用户分开：同一台设备换账号登录时，上一个账号的同步时间不能拿来
  // 压住新账号的远端设置（本机的主题/语音是设备级的，会带过来）。
  const syncedAtKey = `rehearse_settings_synced_at:${user?.id ?? 'anonymous'}`;

  const flushSettings = useCallback(async () => {
    if (pushingRef.current) return;
    pushingRef.current = true;
    try {
      while (pendingPushRef.current) {
        pendingPushRef.current = false;
        const speech = speechRef.current;
        if (!speech) break;
        const doc = buildSyncedSettings(themeNameRef.current, langRef.current, speech);
        const saved = await putSyncedSettings(doc);
        if (saved?.updated_at) {
          await AsyncStorage.setItem(syncedAtKey, saved.updated_at);
        }
      }
      editedRef.current = false;
    } catch {
      // 离线：本机设置仍然生效，下一次改动会重新入队
    } finally {
      pushingRef.current = false;
    }
  }, [syncedAtKey]);

  const applySpeech = useCallback((next: SpeechSettings, persist = true) => {
    speechRef.current = next;
    setSpeech(next);
    if (persist) void saveSpeechSettings(next);
    // 加载完成前就点了主题/语言时，那一份还压在队列里。
    if (pendingPushRef.current) void flushSettings();
  }, [flushSettings]);

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
      void getSpeechSettings().then((next) => applySpeech(next, false));
    }, [applySpeech])
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
    const next = { ...(speechRef.current || {}), ...patch };
    applySpeech(next);
    void pushSettings();
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
    applySpeech(defaults, false);
    void pushSettings();
    toast(t('saved'));
  };

  // 本地先生效，再用远端「更新的那一份」覆盖。离线或服务端不可达时保持本机设置。
  const loadSettings = useCallback(async () => {
    const local = await getSpeechSettings();
    applySpeech(local, false);
    try {
      const remote = await getSyncedSettings();
      // 请求在飞的时候用户可能已经改了设置，这时远端是旧快照。
      if (editedRef.current) return;
      const remoteAt = remote?.updated_at;
      if (!remoteAt) return;
      const syncedAt = await AsyncStorage.getItem(syncedAtKey);
      if (syncedAt && remoteAt <= syncedAt) return;

      if (remote.theme && themes.some((th) => th.name === remote.theme)) {
        setTheme(remote.theme as typeof themes[number]['name']);
      }
      if (remote.language === 'zh-CN' || remote.language === 'en') {
        setLang(remote.language);
      }
      if (remote.speech) {
        applySpeech(applySyncedSettings(remote, local));
      }
      await AsyncStorage.setItem(syncedAtKey, remoteAt);
    } catch {
      // 离线：本机设置照常可用，下次进入本页再试
    }
  }, [applySpeech, setTheme, themes, setLang, syncedAtKey]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // 每次本地改动后全量上传。凭据字段在 buildSyncedSettings 里被剔除（§7.5.1）。
  // 只入队、不并发：同时发两份全量文档时，先发的若后到，服务端会留下旧的一份。
  // 失败不打扰用户：本机设置已经生效，下一次改动会重新入队。
  const pushSettings = useCallback(() => {
    editedRef.current = true;
    pendingPushRef.current = true;
    void flushSettings();
  }, [flushSettings]);

  const changeLanguage = async (next: LangKey) => {
    langRef.current = next;
    setLang(next);
    void pushSettings();
    toast(t('saved'));
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
                    onPress={() => {
                      themeNameRef.current = th.name;
                      setTheme(th.name);
                      void pushSettings();
                    }}
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
          <Pressable style={styles.row} onPress={() => router.push('/rehearse/settings')}>
            <Text style={[styles.rowTitle, { color: c.ink }]}>{t('coachSettingsTitle')}</Text>
            <Text style={{ color: c.accent }}>›</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/history')}>
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
  // 与 rehearse / history 两个 Tab 对齐：浮动 Tab 栏约 90pt，48 会盖住最后一组。
  body: { paddingBottom: 150 },
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
  footerTextBtn: { flex: 1, paddingVertical: 8, alignItems: 'center' },
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
