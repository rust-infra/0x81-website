export type TabIconName = 'rehearse' | 'history' | 'settings';

/**
 * Rehearse 的 Tab 表。**只有三个**（设计稿屏 2 / 屏 13 / 屏 15 的底部栏）：
 * 演练 / 历史 / 设置。
 *
 * 与墨言的区别不只是数量：这里没有「首页」。演练本身就是根页——用户打开
 * 这个 App 只有一件事要做，中间隔一层首页只是多一次点击。
 */
export const TAB_SCREENS = [
  { name: 'rehearse', titleKey: 'tabRehearse', icon: 'rehearse' },
  { name: 'history', titleKey: 'tabHistory', icon: 'history' },
  { name: 'settings', titleKey: 'tabSettings', icon: 'settings' },
] as const satisfies ReadonlyArray<{
  name: string;
  titleKey: string;
  icon: TabIconName;
}>;
