import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme-context';

export default function SettingsScreen() {
  const { theme, themeName, setTheme, themes } = useTheme();
  const { user, signOut } = useAuth();
  const c = theme.colors;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.paper }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.ink }]}>设置</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.sectionTitle, { color: c.inkMuted }]}>主题</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
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
                {active ? <Text style={{ color: c.accent }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: c.inkMuted }]}>账户</Text>
        <View style={[styles.card, { backgroundColor: c.card }]}>
          {user ? (
            <Text style={[styles.themeName, { color: c.ink }]} numberOfLines={1}>
              {user.name} · {user.email}
            </Text>
          ) : null}
          <Pressable style={[styles.logout, { backgroundColor: `${c.accent}18` }]} onPress={signOut}>
            <Text style={{ color: c.accent }}>退出登录</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionTitle: { fontSize: 12, marginTop: 12, marginBottom: 8 },
  card: { borderRadius: 14, padding: 6, overflow: 'hidden' },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  themeDot: { width: 26, height: 26, borderRadius: 13, marginRight: 12 },
  themeBody: { flex: 1 },
  themeName: { fontSize: 15, fontWeight: '600' },
  themeDesc: { fontSize: 11, marginTop: 1 },
  logout: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
