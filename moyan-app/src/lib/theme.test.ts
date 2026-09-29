import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from './theme';

test('exposes only the four supported themes', () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.name),
    ['xuanzhi', 'shenyemo', 'dailan', 'fense']
  );
});
