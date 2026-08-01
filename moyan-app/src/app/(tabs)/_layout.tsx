import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';

function EmojiIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

export default function TabsLayout() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const c = theme.colors;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.inkLight,
        tabBarStyle: {
          position: 'absolute',
          left: 24,
          right: 24,
          bottom: 16,
          height: 62,
          borderRadius: 999,
          backgroundColor: c.navBg,
          borderTopWidth: 0,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabHome'),
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <EmojiIcon emoji="🏠" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="decks"
        options={{
          title: t('tabDecks'),
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <EmojiIcon emoji="📚" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabStats'),
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <EmojiIcon emoji="📊" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabSettings'),
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <EmojiIcon emoji="⚙️" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
