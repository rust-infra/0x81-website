import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme-context';
import { cardStyle, screen, serif } from '../../lib/ui';

export default function SettingsScreen() {
  const { theme, themeName, setTheme, themes } = useTheme();
  const { user, signOut } = useAuth();
  const c = theme.colors;

  return (
    <SafeAreaView style={[screen.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={screen.header}>
        <Text style={[screen.headerTitle, { color: c.ink, fontFamily: serif }]}>
          设置
        </Text>
      </View>

      <ScrollView contentContainerStyle={[screen.body, styles.body]}>
        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>主题</Text>
        <View style={cardStyle(c.card)}>
          {themes.map((t) => {
            const active = t.name === themeName;
            return (
              <Pressable
                key={t.name}
                style={[styles.themeRow, active && { backgroundColor: c.tagBg }]}
                onPress={() => setTheme(t.name)}
              >
                <View style={[styles.themeDot, { backgroundColor: t.preview }]} />
                <View style={styles.themeBody}>
                  <Text style={[styles.themeName, { color: c.ink }]}>{t.label}</Text>
                  <Text style={[styles.themeDesc, { color: c.inkMuted }]}>{t.description}</Text>
                </View>
                <Text style={[styles.check, { color: active ? c.accent : 'transparent' }]}>✓</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkLight }]}>账户</Text>
        <View style={cardStyle(c.card)}>
          {user ? (
            <Text style={[styles.themeName, { color: c.ink }]} numberOfLines={1}>
              {user.name} · {user.email}
            </Text>
          ) : null}
          <Pressable
            style={[styles.logout, { backgroundColor: `${c.accent}18` }]}
            onPress={signOut}
          >
            <Text style={{ color: c.accent }}>退出登录</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 120 },
  sectionTitle: { fontSize: 13, fontWeight: '500', marginTop: 8, marginBottom: 10 },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  themeDot: { width: 30, height: 30, borderRadius: 15, marginRight: 14 },
  themeBody: { flex: 1 },
  themeName: { fontSize: 15, fontWeight: '500' },
  themeDesc: { fontSize: 12, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '700' },
  logout: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
