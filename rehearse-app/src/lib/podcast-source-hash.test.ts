import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { episodeSourceLines, podcastSourceHash } from './podcast-source-hash';
import type { PodcastEpisode } from './podcast';

// 这些向量与后端 `coach.SourceHash` 一一对应：两边算法一旦分叉，
// 服务端永远命中不了缓存（每次播放都重新生成），而且不会有任何报错。
// 金标准用 Node 的 crypto 算，等于「用另一套实现校验这份手写 SHA-256」。
function reference(lines: string[]): string {
  const digest = createHash('sha256');
  for (const line of lines) {
    digest.update(line.trim(), 'utf8');
    digest.update(Uint8Array.from([0]));
  }
  return digest.digest('hex');
}

test('podcast source hash: 与 Node crypto 的参考实现一致', () => {
  const cases: string[][] = [
    [],
    ['Hello.'],
    ['Hello.', 'Hi, please introduce yourself.', 'I am Alex.'],
    ['中文也要能算', 'Numbers 3.50 USD and MOQ 5,000 pcs.'],
    ['A'.repeat(1000)],
  ];
  for (const lines of cases) {
    assert.equal(podcastSourceHash(lines), reference(lines), JSON.stringify(lines));
  }
});

test('podcast source hash: 句序影响结果，trim 不影响', () => {
  assert.notEqual(podcastSourceHash(['a', 'b']), podcastSourceHash(['b', 'a']));
  assert.equal(podcastSourceHash([' a ', 'b']), podcastSourceHash(['a', 'b']));
});

test('podcast source hash: 从一集台词取指纹', () => {
  const episode = {
    turns: [{ role: 'coach', content: 'Hello.' }, { role: 'user', content: 'Hi.' }],
  } as unknown as PodcastEpisode;
  assert.equal(podcastSourceHash(episodeSourceLines(episode)), reference(['Hello.', 'Hi.']));
});
