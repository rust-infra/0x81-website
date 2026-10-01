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

test('all translations have zh/en key parity', () => {
  const zhKeys = Object.keys(translations['zh-CN']);
  const enKeys = Object.keys(translations.en);
  for (const key of zhKeys) {
    assert.ok(translations.en[key], `missing English translation for ${key}`);
  }
  for (const key of enKeys) {
    assert.ok(translations['zh-CN'][key], `missing Chinese translation for ${key}`);
  }
});
