import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type TabIconName = 'home' | 'decks' | 'podcast' | 'stats' | 'settings';

function renderIcon(name: TabIconName, color: string) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'home':
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path {...common} d="M4 11.5 12 4l8 7.5" />
          <Path {...common} d="M6 10v9h12v-9" />
          <Circle cx="9.2" cy="14.4" r="0.7" fill={color} stroke="none" />
          <Circle cx="14.8" cy="14.4" r="0.7" fill={color} stroke="none" />
          <Path {...common} d="M10.6 17.3c.5.5 2.3.5 2.8 0" />
        </Svg>
      );
    case 'decks':
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path {...common} d="M4 5.5c3-1.4 6-1.4 8 0v13c-2-1.4-5-1.4-8 0z" />
          <Path {...common} d="M20 5.5c-3-1.4-6-1.4-8 0v13c2-1.4 5-1.4 8 0z" />
          <Circle cx="9.5" cy="11" r="0.7" fill={color} stroke="none" />
          <Circle cx="14.5" cy="11" r="0.7" fill={color} stroke="none" />
          <Path {...common} d="M11 13.6c.6.5 1.4.5 2 0" />
        </Svg>
      );
    case 'podcast':
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Rect x="9" y="3" width="6" height="11" rx="3" {...common} />
          <Path {...common} d="M5.5 11a6.5 6.5 0 0 0 13 0" />
          <Path {...common} d="M12 17.5V21" />
          <Circle cx="10" cy="8.2" r="0.7" fill={color} stroke="none" />
          <Circle cx="14" cy="8.2" r="0.7" fill={color} stroke="none" />
          <Path {...common} d="M10.8 10.4c.8.6 1.6.6 2.4 0" />
        </Svg>
      );
    case 'stats':
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Rect x="5" y="13" width="3.5" height="6" rx="1.5" {...common} />
          <Rect x="10.25" y="8" width="3.5" height="11" rx="1.5" {...common} />
          <Rect x="15.5" y="11" width="3.5" height="8" rx="1.5" {...common} />
          <Circle cx="12" cy="6.5" r="0.7" fill={color} stroke="none" />
          <Circle cx="16.5" cy="9.5" r="0.7" fill={color} stroke="none" />
          <Path {...common} d="M12.8 8.3c.5.5 1.5.5 2 0" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path {...common} d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
          <Circle cx="10.6" cy="10.6" r="0.7" fill={color} stroke="none" />
          <Circle cx="13.4" cy="13.4" r="0.7" fill={color} stroke="none" />
          <Path {...common} d="M11.2 13.6c.5.5 1.1.5 1.6 0" />
        </Svg>
      );
  }
}

export function TabIcon({
  name,
  color,
  focused,
  pillColor,
}: {
  name: TabIconName;
  color: string;
  focused: boolean;
  pillColor: string;
}) {
  return (
    <View style={styles.wrap}>
      {focused ? (
        <View style={[styles.pill, { backgroundColor: pillColor }]} />
      ) : null}
      <View style={focused ? styles.scaled : undefined}>
        {renderIcon(name, color)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 40,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    width: 40,
    height: 26,
    borderRadius: 999,
  },
  scaled: { transform: [{ scale: 1.12 }] },
});
