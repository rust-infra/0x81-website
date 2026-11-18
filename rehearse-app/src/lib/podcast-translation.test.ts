import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getCachedPodcastTranslation,
  translatePodcastLines,
} from './podcast-translation';

test('podcast translation: 并发翻译并按 key 缓存', async () => {
  const results: Record<string, string> = {};
  const seen: string[] = [];
  await translatePodcastLines(
    [
      { key: 'a', text: 'Hello' },
      { key: 'b', text: 'World' },
      { key: 'c', text: 'Fail' },
    ],
    async (text) => {
      seen.push(text);
      if (text === 'Fail') throw new Error('boom');
      return `译:${text}`;
    },
    (key, text) => {
      results[key] = text;
    },
    2
  );

  assert.deepEqual(results, { a: '译:Hello', b: '译:World' });
  assert.equal(getCachedPodcastTranslation('a'), '译:Hello');
  assert.equal(getCachedPodcastTranslation('c'), undefined);
  assert.equal(seen.length, 3);
});
