import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPodcastEpisodes,
  createPodcastPlayer,
  episodeMinutes,
  estimateWordRange,
  splitEpisodeTitle,
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

test('podcast: 关闭连播后播完标记结束，主按钮重播整集', async () => {
  const episodes = [episode('e1', ['A', 'B'])];
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
  assert.equal(player.state().finished, true);

  player.play();
  await sleep(120);
  assert.deepEqual(spoken, ['A', 'B', 'A', 'B']);
  assert.equal(player.state().finished, true);
});

test('podcast: 最后一句按下一句进入下一集', () => {
  const episodes = [episode('e1', ['A', 'B']), episode('e2', ['C'])];
  const player = createPodcastPlayer({
    episodes,
    speak: async () => {},
    stop: async () => {},
    gapMs: 0,
  });

  player.seek(0, 1);
  player.nextTurn();
  assert.equal(player.state().episodeIndex, 1);
  assert.equal(player.state().turnIndex, 0);
  assert.equal(player.state().finished, false);
});

test('podcast: 第一句按上一句回到上一集最后一句', () => {
  const episodes = [episode('e1', ['A', 'B']), episode('e2', ['C'])];
  const player = createPodcastPlayer({
    episodes,
    speak: async () => {},
    stop: async () => {},
    gapMs: 0,
  });

  player.seek(1, 0);
  player.prevTurn();
  assert.equal(player.state().episodeIndex, 0);
  assert.equal(player.state().turnIndex, 1);
});

test('podcast: 非数字跳转参数不会污染播放位置', () => {
  const episodes = [episode('e1', ['A', 'B'])];
  const player = createPodcastPlayer({
    episodes,
    speak: async () => {},
    stop: async () => {},
    gapMs: 0,
  });

  player.seek(Number.NaN, Number.NaN);
  assert.equal(player.state().episodeIndex, 0);
  assert.equal(player.state().turnIndex, 0);
});

test('podcast: 单句朗读失败时停在当前句', async () => {
  const episodes = [episode('e1', ['A', 'B', 'C'])];
  const spoken: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      if (text === 'B') throw new Error('tts failed');
      spoken.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(120);
  assert.deepEqual(spoken, ['A']);
  assert.equal(player.state().turnIndex, 1);
  assert.equal(player.state().playing, false);
});

test('podcast: 设备无语音、朗读瞬间完成时不会连播狂奔', async () => {
  const episodes = [
    episode('e1', ['This sentence should take longer than a blink.', 'Next line.']),
  ];
  const seen: string[] = [];
  const errors: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      seen.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    onError: (code) => errors.push(code),
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(80);
  assert.deepEqual(seen, ['This sentence should take longer than a blink.']);
  assert.deepEqual(errors, ['speech-too-short']);
  assert.equal(player.state().playing, false);
  assert.equal(player.state().turnIndex, 0);
});

test('podcast: 逐句暂停每句播完停下，播放继续下一句', async () => {
  const episodes = [episode('e1', ['A', 'B', 'C'])];
  const spoken: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      spoken.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    autoplay: true,
    pauseEachLine: true,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(80);
  assert.deepEqual(spoken, ['A']);
  assert.equal(player.state().turnIndex, 1);
  assert.equal(player.state().playing, false);

  player.play();
  await sleep(80);
  assert.deepEqual(spoken, ['A', 'B']);
  assert.equal(player.state().turnIndex, 2);
  assert.equal(player.state().playing, false);

  player.play();
  await sleep(80);
  assert.deepEqual(spoken, ['A', 'B', 'C']);
  assert.equal(player.state().finished, true);
});

test('podcast: 单句循环重复当前句，不进入下一句', async () => {
  const episodes = [episode('e1', ['A', 'B'])];
  const spoken: string[] = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (text) => {
      spoken.push(text);
    },
    stop: async () => {},
    gapMs: 0,
    loopLine: true,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(80);
  player.pause();

  assert.ok(spoken.length >= 2, '应该至少循环两次');
  assert.ok(spoken.every((text) => text === 'A'));
  assert.equal(player.state().turnIndex, 0);
  assert.equal(player.state().playing, false);
});

test('podcast: 循环与逐句暂停互斥', () => {
  const episodes = [episode('e1', ['A'])];
  const player = createPodcastPlayer({
    episodes,
    speak: async () => {},
    stop: async () => {},
    gapMs: 0,
  });

  player.setPauseEachLine(true);
  player.setAutoplay(true);
  player.setLoopLine(true);
  assert.equal(player.state().loopLine, true);
  assert.equal(player.state().pauseEachLine, false);
  assert.equal(player.state().autoplay, false);

  player.setPauseEachLine(true);
  assert.equal(player.state().loopLine, false);
  assert.equal(player.state().pauseEachLine, true);
  assert.equal(player.state().autoplay, false);
});

test('podcast: 朗读时把角色传给声线选择', async () => {
  const episodes = [episode('e1', ['A', 'B', 'C'])];
  const roles: Array<'coach' | 'user' | undefined> = [];
  const player = createPodcastPlayer({
    episodes,
    speak: async (_text, opts) => {
      roles.push(opts.role);
    },
    stop: async () => {},
    gapMs: 0,
    setTimeoutFn: (fn) => setTimeout(fn, 0),
  });

  player.play();
  await sleep(80);
  assert.deepEqual(roles, ['coach', 'user', 'coach']);
});

test('podcast: 从英语学习对话生成剧集', () => {
  const all = buildPodcastEpisodes();
  assert.ok(all.length > 100);
  assert.ok(all.every((item) => item.turns.length > 0));
  assert.ok(buildPodcastEpisodes('第一册').every((item) => item.deck === '第一册'));
  assert.ok(episodeMinutes(all[0]!.turns) >= 1);
});

test('podcast: 按播放进度估算当前单词', () => {
  assert.deepEqual(estimateWordRange('Alex, please introduce yourself.', 0), {
    start: 0,
    length: 5,
  });
  assert.deepEqual(estimateWordRange('Alex, please introduce yourself.', 1), {
    start: 23,
    length: 9,
  });
  assert.deepEqual(estimateWordRange('Alex, please introduce yourself.', 0.45), {
    start: 13,
    length: 9,
  });
  assert.equal(estimateWordRange('   ', 0.5), null);
});

test('podcast: 标题里的中文译名拆成副标题', () => {
  assert.deepEqual(
    splitEpisodeTitle(
      'Dialogue 1: New Colleague Introduction(新同事入职介绍)'
    ),
    {
      title: 'Dialogue 1: New Colleague Introduction',
      subtitle: '新同事入职介绍',
    }
  );
  assert.deepEqual(splitEpisodeTitle('Dialogue 1: Giving Information About a New Task'), {
    title: 'Dialogue 1: Giving Information About a New Task',
  });
  assert.deepEqual(
    splitEpisodeTitle(
      'Dialogue 1: Handling a Code Mistake (Backend Developer)(处理代码错误·后端开发场景)'
    ),
    {
      title: 'Dialogue 1: Handling a Code Mistake (Backend Developer)',
      subtitle: '处理代码错误·后端开发场景',
    }
  );
});
