import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePodcastProgress } from './podcast-progress';

test('podcast-progress: 解析已保存的播放位置', () => {
  const parsed = parsePodcastProgress(
    JSON.stringify({
      episodeId: 'english_book1_main_1_1',
      episodeIndex: 3,
      turnIndex: 2,
      updatedAt: 1234,
    })
  );
  assert.deepEqual(parsed, {
    episodeId: 'english_book1_main_1_1',
    episodeIndex: 3,
    turnIndex: 2,
    updatedAt: 1234,
  });
});

test('podcast-progress: 丢弃损坏或字段缺失的数据', () => {
  assert.equal(parsePodcastProgress(null), null);
  assert.equal(parsePodcastProgress('not json'), null);
  assert.equal(parsePodcastProgress('{}'), null);
  assert.equal(
    parsePodcastProgress(
      JSON.stringify({ episodeId: 'x', episodeIndex: -1, turnIndex: 0 })
    ),
    null
  );
  assert.equal(
    parsePodcastProgress(
      JSON.stringify({ episodeId: '', episodeIndex: 0, turnIndex: 0 })
    ),
    null
  );
});
