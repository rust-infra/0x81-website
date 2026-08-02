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
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.paper },
      }}
    >
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="deck/[id]" />
        <Stack.Screen name="study/[deckId]" />
        <Stack.Screen name="podcast/player" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
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
