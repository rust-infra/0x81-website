import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabIcon } from '../../components/TabIcons';
import { TAB_SCREENS, type TabIconName } from '../../lib/navigation-contract';
import { getAppConfig } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useTheme } from '../../lib/theme-context';

export default function TabsLayout() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [podcastEnabled, setPodcastEnabled] = useState(false);

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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.ink,
        tabBarInactiveTintColor: theme.colors.inkLight,
      }}
      tabBar={(props) => <AppTabBar {...props} podcastEnabled={podcastEnabled} />}
    >
      {TAB_SCREENS.map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={{
            title: t(screen.titleKey),
            href: screen.name === 'podcast' && !podcastEnabled ? null : undefined,
          }}
        />
      ))}
    </Tabs>
  );
}

type AppTabBarProps = {
  state: {
    index: number;
    routes: Array<{ key: string; name: string; params?: object }>;
  };
  descriptors: Record<string, { options?: { title?: string } }>;
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
};

function AppTabBar({
  state,
  descriptors,
  navigation,
  podcastEnabled,
}: AppTabBarProps & { podcastEnabled: boolean }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { t } = useI18n();
  const c = theme.colors;
  const routes = state.routes.filter((route) => {
    if (route.name === 'podcast' && !podcastEnabled) return false;
    return true;
  });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outer, { height: 58 + insets.bottom + 14 }]}
    >
      <View
        style={[
          styles.bar,
          {
            marginBottom: insets.bottom + 8,
            backgroundColor: c.navBg,
            borderColor: c.border,
          },
        ]}
      >
        {routes.map((route) => {
          const index = state.routes.findIndex((item) => item.key === route.key);
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          const label = options?.title ?? t(TAB_SCREENS.find((item) => item.name === route.name)?.titleKey ?? '');
          const iconName = TAB_SCREENS.find((item) => item.name === route.name)?.icon as
            | TabIconName
            | undefined;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              style={styles.item}
            >
              {iconName ? (
                <TabIcon
                  name={iconName}
                  color={focused ? c.ink : c.navText}
                  focused={focused}
                  pillColor={c.accentLight}
                />
              ) : null}
              <Text
                style={[
                  styles.label,
                  { color: focused ? c.ink : c.navText, fontWeight: focused ? '600' : '500' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  bar: {
    height: 58,
    marginHorizontal: 22,
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 9 },
});
