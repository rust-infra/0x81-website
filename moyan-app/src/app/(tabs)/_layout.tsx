import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabIcon, type TabIconName } from '../../components/TabIcons';
import { getAppConfig } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { t } = useI18n();
  const [podcastEnabled, setPodcastEnabled] = useState(false);

  const tabIcon =
    (name: TabIconName) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) =>
      (
        <TabIcon
          name={name}
          color={color as string}
          focused={focused}
          pillColor={c.accentLight}
        />
      );

  useEffect(() => {
    let cancelled = false;
    getAppConfig()
      .then((cfg) => {
        if (!cancelled) setPodcastEnabled(!!cfg.podcast?.app_enabled);
      })
      .catch(() => {
        if (!cancelled) setPodcastEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
          // 高度需包含底部安全区：React Navigation 内部会加 paddingBottom = insets.bottom，
          // 若高度只有 62，内容区会被压缩到 ~20pt，导致标签文字被 Yoga 压缩裁切。
          // 取 62 + min(insets.bottom, 20) 保证内容区足够、标签完整渲染，同时不过高。
          height: 62 + Math.min(insets.bottom, 20),
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
        // 内容（图标+文字）整体下移一点，让胶囊视觉更均衡、底部空白更小。
        // 无 Home 指示条设备（insets.bottom 小）时保持原样。
        tabBarItemStyle: {
          paddingVertical: 2,
          transform: [{ translateY: Math.max(0, insets.bottom - 30) }],
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabHome'),
          tabBarIcon: tabIcon('home'),
        }}
      />
      <Tabs.Screen
        name="decks"
        options={{
          title: t('tabDecks'),
          tabBarIcon: tabIcon('decks'),
        }}
      />
      <Tabs.Screen
        name="podcast"
        options={{
          title: t('tabPodcast'),
          tabBarIcon: tabIcon('podcast'),
          href: podcastEnabled ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('tabStats'),
          tabBarIcon: tabIcon('stats'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabSettings'),
          tabBarIcon: tabIcon('settings'),
        }}
      />
    </Tabs>
  );
}
