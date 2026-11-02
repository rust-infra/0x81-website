import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { TabIconName } from '../lib/navigation-contract';

export type { TabIconName } from '../lib/navigation-contract';

function renderIcon(name: TabIconName, color: string) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'rehearse':
      // 设计稿屏 2 的「演练」：一个带横线的对话气泡
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path {...common} d="M4 5.5h16v11H9L4 20z" />
          <Path {...common} d="M9 10h6M9 13h4" />
        </Svg>
      );
    case 'history':
      // 设计稿屏 13 的「历史」：表盘 + 指针
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path {...common} d="M12 7v5l3 2" />
        </Svg>
      );
    case 'settings':
      // 设计稿屏 15 的「设置」：齿轮（中心圆 + 八根辐条）
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
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
  void pillColor;
  return (
    <View style={styles.wrap}>
      <View style={focused ? styles.scaled : undefined}>{renderIcon(name, color)}</View>
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
