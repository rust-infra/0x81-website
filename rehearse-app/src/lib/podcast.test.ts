import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPodcastEpisodes,
  createPodcastPlayer,
  episodeMinutes,
  type PodcastEpisode,
} from './podcast';
import type { CoachTurn } from './rehearse-types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function episode(id: string, turns: string[]): PodcastEpisode {
  return {
    id,
    title: id,
    lessonTitle: 'Lesson',
    lessonNumber: 1,
    deck: '第一册',
    track: 'main',
    coachName: 'Coach',
    turns: turns.map((content, index) => ({
      role: index % 2 === 0 ? 'coach' : 'user',
      content,
    })) as CoachTurn[],
  };
}

test('podcast: 按顺序播放并在连播时进入下一集', async () => {
  const episodes = [episode('e1', ['A', 'B']), episode('e2', ['C'])];
  const spoken: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      spoken.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    autoplay: true,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(120);

  assert.deepEqual(spoken, ['A', 'B', 'C']);
  assert.equal(player.state().playing, false);
  assert.equal(player.state().episodeIndex, 1);
});

test('podcast: 关闭连播后停在当前集末尾', async () => {
  const episodes = [episode('e1', ['A', 'B']), episode('e2', ['C'])];
  const spoken: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      spoken.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    autoplay: false,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(120);

  assert.deepEqual(spoken, ['A', 'B']);
  assert.equal(player.state().playing, false);
  assert.equal(player.state().episodeIndex, 0);
});

test('podcast: 暂停会停止当前朗读且不再推进', async () => {
  const episodes = [episode('e1', ['A', 'B'])];
  const spoken: string[] = [];
  let resolveFirst: () => void = () => {};
  let stopCalls = 0;
  const player = createPodcastPlayer({
    episodes,
    speak: (text) => {
      spoken.push(text);
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    },
    stop: async () => {
      stopCalls += 1;
    },
    gapMs: 0,
  });

  player.play();
  await sleep(20);
  assert.deepEqual(spoken, ['A']);

  player.pause();
  resolveFirst();
  await sleep(50);

  assert.deepEqual(spoken, ['A'], '暂停后不应朗读下一句');
  assert.equal(player.state().playing, false);
  assert.ok(stopCalls >= 1);
});

test('podcast: 暂停时切句会更新状态并通知界面', () => {
  const episodes = [episode('e1', ['A', 'B', 'C'])];
  const states: number[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async () => {},
    stop: async () => {},
    gapMs: 0,
    onState: (state) => states.push(state.turnIndex),
  });

  player.nextTurn();
  assert.equal(player.state().turnIndex, 1);
  assert.equal(states.at(-1), 1);

  player.prevTurn();
  assert.equal(player.state().turnIndex, 0);
  assert.equal(states.at(-1), 0);
});

test('podcast: 从英语学习对话生成剧集', () => {
  const all = buildPodcastEpisodes();
  assert.ok(all.length > 100);
  assert.ok(all.every((item) => item.turns.length > 0));
  assert.ok(buildPodcastEpisodes('第一册').every((item) => item.deck === '第一册'));
  assert.ok(episodeMinutes(all[0]!.turns) >= 1);
});
