import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateThemeName, THEMES } from './theme';

// 设计稿 v1 只要两套：light / dark。多一套皮肤就多一套要维护的色值。
test('exposes only light and dark', () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.name),
    ['light', 'dark']
  );
});

// 两套主题的 token 必须一一对应——少一个字段就是某处颜色会漏成 undefined。
test('both themes expose the same color tokens', () => {
  const [light, dark] = THEMES;
  assert.deepEqual(Object.keys(light.colors).sort(), Object.keys(dark.colors).sort());
});

// 老版本存的是 4 套皮肤的名字，升级后不能把用户打回默认。
test('migrates legacy theme names', () => {
  assert.equal(migrateThemeName('xuanzhi'), 'light');
  assert.equal(migrateThemeName('dailan'), 'light');
  assert.equal(migrateThemeName('fense'), 'light');
  assert.equal(migrateThemeName('shenyemo'), 'dark');
  assert.equal(migrateThemeName('light'), 'light');
  assert.equal(migrateThemeName('dark'), 'dark');
  assert.equal(migrateThemeName(null), null);
  assert.equal(migrateThemeName('nonsense'), null);
});
