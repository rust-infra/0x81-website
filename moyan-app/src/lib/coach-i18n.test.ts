import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from './translations';

test('has every coach key in both languages', () => {
  const keys = Object.keys(translations['zh-CN']).filter((key) => key.startsWith('coach'));
  assert.ok(keys.length > 20);
  for (const key of keys) {
    assert.ok(translations.en[key], `missing English translation for ${key}`);
  }
});
