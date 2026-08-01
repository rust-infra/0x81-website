import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { ThemeProvider, useTheme } from '../lib/theme-context';

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
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
