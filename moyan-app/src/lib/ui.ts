// 与 moyan-web 一致的视觉基础：衬线字体、卡片、页头
import { Platform, StyleSheet } from 'react-native';

/** 中文衬线字体（对应 web 的 font-serif-cn） */
export const serif = Platform.select({
  ios: 'Songti SC',
  android: 'serif',
  default: 'serif',
});

/** 页面容器：纸面背景 + 顶部留白（对应 pt-12 px-6） */
export const screen = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 20,
  },
});

/** 圆角卡片（对应 rounded-2xl p-5 + 轻阴影） */
export function cardStyle(bg: string, border?: string) {
  return {
    backgroundColor: bg,
    borderRadius: 16,
    padding: 20,
    borderWidth: border ? 1 : 0,
    borderColor: border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  };
}

/** 圆形小按钮（对应 w-9 h-9 rounded-full） */
export const roundButton = {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
