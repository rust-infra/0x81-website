import test from 'node:test';
import assert from 'node:assert/strict';
import { TAB_SCREENS } from './navigation-contract';

test('keeps exactly five tabs and puts coach second', () => {
  assert.deepEqual(
    TAB_SCREENS.map((item) => item.name),
    ['index', 'coach', 'podcast', 'stats', 'settings']
  );
  assert.equal(TAB_SCREENS[1]?.icon, 'coach');
});
