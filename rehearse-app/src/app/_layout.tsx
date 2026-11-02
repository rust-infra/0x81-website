import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { I18nProvider } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme-context';
import { ToastProvider } from '../lib/toast';

function RootNavigator() {
  const { ready, token } = useAuth();
  const { theme } = useTheme();

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.paper,
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.paper },
        }}
      >
        {/* 根路由：把 `/` 分到演练 Tab 或登录页（见 index.tsx）。
            放在两棵守卫之外——它是入口，任何时候都必须存在。 */}
        <Stack.Screen name="index" />
        {/* 登录后才挂载业务路由。`Stack.Protected` 是 expo-router 的守卫：
            未登录时这些路由**不存在**，深链也进不去——比在页面里各写一遍
            「没 token 就跳登录」可靠。 */}
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="rehearse/session" />
          <Stack.Screen name="rehearse/summary" />
          <Stack.Screen name="rehearse/editor" />
          <Stack.Screen name="rehearse/settings" />
          <Stack.Screen name="rehearse/material/index" />
          <Stack.Screen name="rehearse/material/materials" />
          <Stack.Screen name="rehearse/material/profile" />
          <Stack.Screen name="speech-settings" />
        </Stack.Protected>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
