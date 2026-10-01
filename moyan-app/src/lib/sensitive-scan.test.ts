import test from 'node:test';
import assert from 'node:assert/strict';
import { removeSensitiveHits, scanSensitive } from './sensitive-scan';

test('finds phone, email and id hints without blocking text', () => {
  const text = '电话 13800138000, mail a@b.com, id 110101199001011234';
  const hits = scanSensitive(text);
  assert.deepEqual(hits.map((hit) => hit.kind), ['phone', 'email', 'id']);
  assert.equal(removeSensitiveHits(text, hits).includes('13800138000'), false);
});

test('removing only the selected hits preserves the rest of the text', () => {
  const text = 'Alice 13800138000 backend';
  const hits = scanSensitive(text).slice(0, 1);
  assert.equal(removeSensitiveHits(text, hits), 'Alice  backend');
});
