import test from 'node:test';
import assert from 'node:assert/strict';
import { TAB_SCREENS } from './navigation-contract';

// 设计稿底部栏只有三个：演练 / 历史 / 设置（屏 2、屏 13、屏 15）。
// 演练必须是第 1 个——它是根页，不是「首页里的一个入口」。
test('keeps exactly three tabs and puts rehearse first', () => {
  assert.deepEqual(
    TAB_SCREENS.map((item) => item.name),
    ['rehearse', 'history', 'settings']
  );
  assert.equal(TAB_SCREENS[0]?.icon, 'rehearse');
  assert.equal(TAB_SCREENS[1]?.icon, 'history');
  assert.equal(TAB_SCREENS[2]?.icon, 'settings');
});
