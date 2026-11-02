import { Redirect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CoachGlyph } from '../components/rehearse/CoachUi';
import {
  googleMobileLogin,
  kimiDevice,
  kimiTokenPoll,
  type KimiDeviceInfo,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { getGoogleClientId, getGoogleRedirectUri } from '../lib/config';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme-context';

function randomDeviceId(): string {
  return `rehearse-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * 登录页（设计稿第 1 屏）。
 *
 * 结构按稿子：居中的麦克风标记 + 职演 + 一句话 + 场景行，底部两个按钮
 * （Google 主、Kimi 次）+「已有墨言账号」提示。**不出现「注册」**——用户要么
 * 有 0x81 账号，要么就是新用户，两条路都指向同一个按钮。
 *
 * ⚠️ 与稿子的一处有意差异：底部多一个「开发：粘贴 token」的**小字链接**。
 * 本地开发没有 Google/Kimi 账号时，这是唯一能进 App 的路（rehearse-backend
 * 只验签、不签发）。它被刻意降级成 11px 的弱化文本，不参与正式登录的层级。
 */
export default function LoginScreen() {
  const { token, signIn } = useAuth();
  const { theme } = useTheme();
  const { t } = useI18n();
  const c = theme.colors;
  const [mode, setMode] = useState<'choose' | 'kimi' | 'token'>('choose');
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<KimiDeviceInfo | null>(null);
  const [pollStatus, setPollStatus] = useState('');
  const deviceIdRef = useRef<string>('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);

  const [googleRequest, googleResponse, googlePrompt] = Google.useAuthRequest({
    clientId: getGoogleClientId(),
    redirectUri: getGoogleRedirectUri(),
  });

  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  useEffect(() => {
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (googleResponse?.type === 'success' && googleResponse.params?.code) {
      void handleGoogleCode(googleResponse.params.code);
    } else if (googleResponse?.type === 'error') {
      setError(t('loginFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  const handleGoogleCode = async (code: string) => {
    setError('');
    try {
      const login = await googleMobileLogin(code);
      await signIn(login.token, login.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGoogleLogin = () => {
    if (!getGoogleClientId()) {
      setError(t('googleNotConfigured'));
      return;
    }
    void googlePrompt();
  };

  const startKimiLogin = async () => {
    setError('');
    setPollStatus(t('kimiFetchingCode'));
    try {
      const deviceId = randomDeviceId();
      deviceIdRef.current = deviceId;
      const info = await kimiDevice(deviceId);
      setDeviceInfo(info);
      setMode('kimi');
      setPollStatus(t('kimiAuthorize'));
      await WebBrowser.openBrowserAsync(info.verification_uri_complete);
      startPolling(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPollStatus('');
    }
  };

  const startPolling = (info: KimiDeviceInfo) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const intervalMs = Math.max(info.interval, 2) * 1000;
    const poll = async () => {
      if (!aliveRef.current) return;
      try {
        const result = await kimiTokenPoll(info.device_code, deviceIdRef.current);
        if (result.status === 'ok') {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setPollStatus(t('kimiAuthorizing'));
          await signIn(result.token, result.user);
        }
      } catch (err) {
        if (!aliveRef.current) return;
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setError(err instanceof Error ? err.message : String(err));
        setPollStatus('');
      }
    };
    pollTimerRef.current = setInterval(poll, intervalMs);
  };

  const cancelKimi = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setDeviceInfo(null);
    setPollStatus('');
    setError('');
    setMode('choose');
  };

  const handleLogin = async () => {
    const value = tokenInput.trim();
    if (!value) {
      setError(t('loginTokenRequired'));
      return;
    }
    await signIn(value, {
      id: 'local',
      name: t('devUserName'),
      email: '',
      avatar: '',
      provider: 'local',
    });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.paper }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.hero}>
          <View style={[styles.mark, { backgroundColor: c.accentLight }]}>
            <CoachGlyph name="mic" color={c.accent} size={34} />
          </View>
          <Text style={[styles.title, { color: c.ink }]}>{t('appName')}</Text>
          <Text style={[styles.tagline, { color: c.inkLight }]}>{t('appDesc')}</Text>
          <Text style={[styles.scopes, { color: c.inkMuted }]}>{t('loginScopes')}</Text>
        </View>

        <View style={styles.actions}>
          {mode === 'choose' && (
            <>
              <Pressable
                accessibilityRole="button"
                style={[styles.button, { backgroundColor: c.buttonBg }]}
                onPress={handleGoogleLogin}
              >
                <GoogleGlyph color={c.buttonText} />
                <Text style={[styles.buttonText, { color: c.buttonText }]}>
                  {t('loginGoogle')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.ghost, { borderColor: c.border }]}
                onPress={startKimiLogin}
              >
                <Text style={[styles.buttonText, { color: c.ink }]}>{t('loginKimi')}</Text>
              </Pressable>
              <Text style={[styles.note, { color: c.inkMuted }]}>
                {t('loginExistingAccount')}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setError('');
                  setMode('token');
                }}
              >
                <Text style={[styles.devLink, { color: c.inkMuted }]}>{t('loginDevToken')}</Text>
              </Pressable>
            </>
          )}

          {mode === 'kimi' && deviceInfo && (
            <View style={styles.kimiBox}>
              <Text style={[styles.kimiHint, { color: c.inkMuted }]}>{t('loginHint')}</Text>
              <Text style={[styles.userCode, { color: c.accent }]}>{deviceInfo.user_code}</Text>
              <Text style={[styles.kimiHint, { color: c.inkMuted }]}>{pollStatus}</Text>
              <Pressable
                style={[styles.ghost, { borderColor: c.border }]}
                onPress={() => WebBrowser.openBrowserAsync(deviceInfo.verification_uri_complete)}
              >
                <Text style={[styles.buttonText, { color: c.ink }]}>{t('openVerify')}</Text>
              </Pressable>
              <Pressable onPress={cancelKimi}>
                <Text style={[styles.cancel, { color: c.inkMuted }]}>{t('cancel')}</Text>
              </Pressable>
            </View>
          )}

          {mode === 'token' && (
            <>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border },
                ]}
                placeholder={t('loginPlaceholder')}
                placeholderTextColor={c.inkMuted}
                value={tokenInput}
                onChangeText={setTokenInput}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                style={[styles.button, { backgroundColor: c.buttonBg }]}
                onPress={handleLogin}
              >
                <Text style={[styles.buttonText, { color: c.buttonText }]}>{t('login')}</Text>
              </Pressable>
              <Pressable onPress={() => setMode('choose')}>
                <Text style={[styles.cancel, { color: c.inkMuted }]}>{t('back')}</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={[styles.error, { color: c.accent }]}>{error}</Text> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Google 的「G」。设计稿里是单色（跟随按钮文字色），不是品牌四色——
 * 主按钮已经是深底白字，再塞四色会抢层级。
 */
function GoogleGlyph({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M21.6 12.2c0-.7-.06-1.36-.18-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.74 3-4.3 3-7.3z" />
      <Path d="M12 22c2.7 0 4.96-.9 6.6-2.42l-3.2-2.5c-.9.6-2.04.95-3.4.95-2.6 0-4.8-1.76-5.6-4.12H3.1v2.6A10 10 0 0 0 12 22z" />
      <Path d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6z" />
      <Path d="M12 6.06c1.47 0 2.8.5 3.83 1.5l2.86-2.86A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.82 9.4 6.06 12 6.06z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 40,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  hero: { alignItems: 'center', paddingTop: 96 },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: 0.2 },
  tagline: { fontSize: 14, marginTop: 8 },
  scopes: { fontSize: 12, marginTop: 6 },
  actions: { gap: 12 },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  ghost: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 2 },
  devLink: { fontSize: 11, textAlign: 'center', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  error: { fontSize: 13, textAlign: 'center' },
  kimiBox: { alignItems: 'center', gap: 10 },
  kimiHint: { fontSize: 13, textAlign: 'center' },
  userCode: { fontSize: 40, fontWeight: '800', letterSpacing: 6, marginVertical: 4 },
  cancel: { fontSize: 13, marginTop: 4, textAlign: 'center' },
});
