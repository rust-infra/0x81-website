import { Redirect } from 'expo-router';
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
import {
  kimiDevice,
  kimiLogin,
  kimiTokenPoll,
  type KimiDeviceInfo,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme-context';

function randomDeviceId(): string {
  return `moyan-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export default function LoginScreen() {
  const { token, signIn } = useAuth();
  const { theme } = useTheme();
  const c = theme.colors;
  const [mode, setMode] = useState<'choose' | 'kimi' | 'token'>('choose');
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<KimiDeviceInfo | null>(null);
  const [pollStatus, setPollStatus] = useState('');
  const deviceIdRef = useRef<string>('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);

  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  useEffect(() => {
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const startKimiLogin = async () => {
    setError('');
    setPollStatus('正在获取验证码...');
    try {
      const deviceId = randomDeviceId();
      deviceIdRef.current = deviceId;
      const info = await kimiDevice(deviceId);
      setDeviceInfo(info);
      setMode('kimi');
      setPollStatus('请在浏览器中完成授权');
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
          setPollStatus('授权成功，登录中...');
          const login = await kimiLogin(result.accessToken);
          await signIn(login.token, login.user);
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
      setError('请输入 token');
      return;
    }
    await signIn(value, {
      id: 'local',
      name: 'Token User',
      email: `${value.slice(0, 12)}@moyan.local`,
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
        <Text style={[styles.title, { color: c.ink }]}>墨言单词</Text>
        <Text style={[styles.subtitle, { color: c.inkMuted }]}>
          水墨风格英语单词学习
        </Text>

        {mode === 'choose' && (
          <>
            <Pressable
              style={[styles.button, { backgroundColor: c.accent }]}
              onPress={startKimiLogin}
            >
              <Text style={styles.buttonText}>使用 Kimi 登录</Text>
            </Pressable>
            <Pressable
              style={[styles.secondary, { borderColor: c.border }]}
              onPress={() => {
                setError('');
                setMode('token');
              }}
            >
              <Text style={{ color: c.inkMuted }}>使用 token 登录（开发）</Text>
            </Pressable>
          </>
        )}

        {mode === 'kimi' && deviceInfo && (
          <View style={styles.kimiBox}>
            <Text style={[styles.kimiHint, { color: c.inkMuted }]}>
              在打开的页面中输入验证码
            </Text>
            <Text style={[styles.userCode, { color: c.accent }]}>
              {deviceInfo.user_code}
            </Text>
            <Text style={[styles.kimiHint, { color: c.inkMuted }]}>
              {pollStatus}
            </Text>
            <Pressable
              style={[styles.secondary, { borderColor: c.border }]}
              onPress={() =>
                WebBrowser.openBrowserAsync(deviceInfo.verification_uri_complete)
              }
            >
              <Text style={{ color: c.inkMuted }}>重新打开验证页面</Text>
            </Pressable>
            <Pressable onPress={cancelKimi}>
              <Text style={[styles.cancel, { color: c.inkMuted }]}>取消</Text>
            </Pressable>
          </View>
        )}

        {mode === 'token' && (
          <>
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
              placeholder="粘贴登录 token"
              placeholderTextColor={c.inkMuted}
              value={tokenInput}
              onChangeText={setTokenInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.button, { backgroundColor: c.accent }]}
              onPress={handleLogin}
            >
              <Text style={styles.buttonText}>登录</Text>
            </Pressable>
            <Pressable onPress={() => setMode('choose')}>
              <Text style={[styles.cancel, { color: c.inkMuted }]}>返回</Text>
            </Pressable>
          </>
        )}

        {error ? <Text style={[styles.error, { color: c.accent }]}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  error: { fontSize: 13, marginBottom: 12, textAlign: 'center' },
  button: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  secondary: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  kimiBox: { alignItems: 'center' },
  kimiHint: { fontSize: 13, textAlign: 'center', marginBottom: 8 },
  userCode: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 6,
    marginVertical: 12,
  },
  cancel: { fontSize: 13, marginTop: 16, textAlign: 'center' },
});
