import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme-context';

export default function LoginScreen() {
  const { token, signIn } = useAuth();
  const { theme } = useTheme();
  const c = theme.colors;
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');

  if (token) {
    return <Redirect href="/(tabs)" />;
  }

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

        <TextInput
          style={[styles.input, { backgroundColor: c.inputBg, color: c.ink, borderColor: c.border }]}
          placeholder="粘贴登录 token"
          placeholderTextColor={c.inkMuted}
          value={tokenInput}
          onChangeText={setTokenInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {error ? <Text style={[styles.error, { color: c.accent }]}>{error}</Text> : null}

        <Pressable
          style={[styles.button, { backgroundColor: c.accent }]}
          onPress={handleLogin}
        >
          <Text style={styles.buttonText}>登录</Text>
        </Pressable>
        <Text style={[styles.hint, { color: c.inkMuted }]}>
          开发版暂用 token 登录；Google / Kimi OAuth 接入中
        </Text>
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
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
});
