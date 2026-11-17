import test from 'node:test';
import assert from 'node:assert/strict';
import { TAB_SCREENS, tabBarClearance } from './navigation-contract';

// 底部栏：演练 / 同传 / 历史 / 设置。
// 演练必须是第 1 个——它是根页，不是「首页里的一个入口」。
test('keeps four tabs and puts rehearse first', () => {
  assert.deepEqual(
    TAB_SCREENS.map((item) => item.name),
    ['rehearse', 'interpret', 'history', 'settings']
  );
  assert.equal(TAB_SCREENS[0]?.icon, 'rehearse');
  assert.equal(TAB_SCREENS[1]?.icon, 'interpret');
  assert.equal(TAB_SCREENS[2]?.icon, 'history');
  assert.equal(TAB_SCREENS[3]?.icon, 'settings');
});

test('tab bar clearance includes the bar, gaps, and the bottom inset', () => {
  assert.equal(tabBarClearance(0), 80);
  assert.equal(tabBarClearance(24), 104);
});
