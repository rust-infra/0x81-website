export type TabIconName = 'rehearse' | 'interpret' | 'history' | 'settings';

/**
 * Rehearse 的 Tab 表：演练 / 同传 / 历史 / 设置。
 *
 * 演练必须是第一个：它是根页。同传紧随其后，是「开口之外」的另一条主线
 * ——实时双语字幕；它不是某个场景的变体，所以放底部栏而不是场景列表里。
 *
 * 与墨言的区别不只是数量：这里没有「首页」。演练本身就是根页——用户打开
 * 这个 App 只有一件事要做，中间隔一层首页只是多一次点击。
 */
export const TAB_SCREENS = [
  { name: 'rehearse', titleKey: 'tabRehearse', icon: 'rehearse' },
  { name: 'interpret', titleKey: 'tabInterpret', icon: 'interpret' },
  { name: 'history', titleKey: 'tabHistory', icon: 'history' },
  { name: 'settings', titleKey: 'tabSettings', icon: 'settings' },
] as const satisfies ReadonlyArray<{
  name: string;
  titleKey: string;
  icon: TabIconName;
}>;

export const TAB_BAR_HEIGHT = 58;
export const TAB_BAR_BOTTOM_GAP = 8;
export const TAB_BAR_TOP_RESERVE = 14;

/**
 * 浮层 tab bar 占用的屏幕底部高度。屏幕内容用它让出空间，
 * 与 (tabs)/_layout.tsx 的布局共用同一组数字。
 */
export function tabBarClearance(bottomInset: number): number {
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + TAB_BAR_TOP_RESERVE + bottomInset;
}
