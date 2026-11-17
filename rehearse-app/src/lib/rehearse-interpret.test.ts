import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createTranslationQueue,
  interpretRollbackLength,
  normalizeInterpretNumbers,
  simulateInterpret,
  splitByNumbers,
  splitByTerms,
  splitInterpretBoundary,
  stripCommittedPrefix,
  INTERPRET_DEMO_SCRIPT,
} from './rehearse-interpret';

test('splitInterpretBoundary: 无句末标点时全部是尾', () => {
  assert.deepEqual(splitInterpretBoundary('No period yet'), {
    stable: '',
    tail: 'No period yet',
  });
});

test('splitInterpretBoundary: 以句末标点切出头和尾', () => {
  assert.deepEqual(splitInterpretBoundary('Hello world. How are'), {
    stable: 'Hello world.',
    tail: 'How are',
  });
});

test('interpretRollbackLength: 纯延长不算回滚', () => {
  assert.equal(interpretRollbackLength('Hello', 'Hello world'), 0);
});

test('interpretRollbackLength: 改短算回滚并给出字符数', () => {
  // "the updated sheet, sorry," → "the updated quotation" 是典型 ASR 改判
  const rolled = interpretRollbackLength(
    'I will send the updated sheet',
    'I will send the updated quotation'
  );
  assert.ok(rolled > 0);
});

test('normalizeInterpretNumbers: 数字说法归一化', () => {
  assert.equal(
    normalizeInterpretNumbers('an MOQ of five thousand pieces'),
    'an MOQ of 5,000 pieces'
  );
  assert.equal(
    normalizeInterpretNumbers('around forty five days'),
    'around 45 天'
  );
});

test('stripCommittedPrefix: 只去掉已提交的前缀', () => {
  assert.equal(stripCommittedPrefix('Hello. How are', 'Hello.'), 'How are');
  assert.equal(stripCommittedPrefix('How are you', 'Hello.'), 'How are you');
  assert.equal(stripCommittedPrefix('Hello.', 'Hello.'), '');
  assert.equal(stripCommittedPrefix('Hello.', ''), 'Hello.');
});

test('splitByTerms: 命中术语并给出译法', () => {
  const chunks = splitByTerms('Price on FOB Shanghai, fob terms, MOQ 5,000', {
    FOB: '离岸价',
    MOQ: '起订量',
  });
  assert.deepEqual(
    chunks.filter((chunk) => chunk.term).map((chunk) => `${chunk.term}:${chunk.gloss}`),
    ['FOB:离岸价', 'fob:离岸价', 'MOQ:起订量']
  );
  assert.equal(chunks.map((chunk) => chunk.text).join(''), 'Price on FOB Shanghai, fob terms, MOQ 5,000');
});

test('splitByNumbers: 切出金额、数量与日期', () => {
  const chunks = splitByNumbers('Get $3.50/pc for 5,000 pcs in 45 days.');
  assert.deepEqual(
    chunks.filter((chunk) => chunk.num).map((chunk) => chunk.text),
    ['$3.50/pc', '5,000 pcs', '45 days']
  );
  assert.equal(chunks.map((chunk) => chunk.text).join(''), 'Get $3.50/pc for 5,000 pcs in 45 days.');
});

test('createTranslationQueue: 并发上限与超限回调', async () => {
  const started: number[] = [];
  const overflow: number[] = [];
  const resolvers = new Map<number, () => void>();
  const queue = createTranslationQueue({
    concurrency: 1,
    maxPending: 1,
    run: (task) =>
      new Promise((resolve) => {
        started.push(task.id);
        resolvers.set(task.id, () => resolve(`zh-${task.id}`));
      }),
    onResult: () => {},
    onError: () => {},
    onOverflow: (id) => overflow.push(id),
  });

  queue.push({ id: 1, text: 'a' });
  queue.push({ id: 2, text: 'b' });
  queue.push({ id: 3, text: 'c' });

  assert.deepEqual(started, [1], '并发 1 时只启动第一句');
  assert.equal(queue.pendingCount(), 1);
  assert.deepEqual(overflow, [3], '超过待译上限的句子走超限回调');

  resolvers.get(1)?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2], '前一句完成后启动下一句');
});

test('createTranslationQueue: 结果与失败按 task id 回调', async () => {
  const results: Array<[number, string]> = [];
  const errors: number[] = [];
  const queue = createTranslationQueue({
    concurrency: 2,
    run: async (task) => {
      if (task.id === 2) throw new Error('upstream failed');
      return `zh-${task.id}`;
    },
    onResult: (id, translation) => results.push([id, translation]),
    onError: (id) => errors.push(id),
    onOverflow: () => {},
  });

  queue.push({ id: 1, text: 'a' });
  queue.push({ id: 2, text: 'b' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(results, [[1, 'zh-1']]);
  assert.deepEqual(errors, [2]);
});

test('createTranslationQueue: 超时中止在途任务', async () => {
  const errors: number[] = [];
  const queue = createTranslationQueue({
    timeoutMs: 5,
    run: (_task, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    onResult: () => {},
    onError: (id) => errors.push(id),
    onOverflow: () => {},
  });

  queue.push({ id: 1, text: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(errors, [1]);
});

test('createTranslationQueue: clear 中止在途但不报错', async () => {
  let aborted = false;
  let errorCount = 0;
  const queue = createTranslationQueue({
    run: (_task, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
    onResult: () => {},
    onError: () => {
      errorCount += 1;
    },
    onOverflow: () => {},
  });

  queue.push({ id: 1, text: 'a' });
  queue.clear();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(aborted, true);
  assert.equal(errorCount, 0, '主动清空不算翻译失败');
});

function runFullSimulation() {
  const events: Array<[string, unknown]> = [];
  // 同步定时器: 立即执行,把整个流跑完。
  const syncSetTimeout = (fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  };
  const engine = simulateInterpret({
    setTimeoutFn: syncSetTimeout as never,
    onAsrInterim: (e) => events.push(['interim', e.text]),
    onAsrFinal: (e) => events.push(['final', e.text]),
    onTranslate: (e) => events.push(['zh', e.zh]),
    onState: (s) => events.push(['state', s]),
  });
  engine.start();
  return events;
}

test('simulateInterpret: 每个 final 都有对应译文,且状态收尾为 done', async () => {
  const events = runFullSimulation();
  await new Promise((r) => setImmediate(r));

  const finals = events.filter((e) => e[0] === 'final').map((e) => e[1] as string);
  const zhs = events.filter((e) => e[0] === 'zh');
  const states = events.filter((e) => e[0] === 'state').map((e) => e[1]);

  const expectedFinalCount = INTERPRET_DEMO_SCRIPT.reduce((n, u) => n + u.finals.length, 0);
  assert.equal(finals.length, expectedFinalCount);
  assert.equal(zhs.length, expectedFinalCount);
  assert.deepEqual(states, ['listening', 'done']);
});

test('simulateInterpret: 暂停时不推进', async () => {
  const states: string[] = [];
  let interimCount = 0;
  let scheduled: Array<() => void> = [];
  const manualSetTimeout = (fn: () => void) => {
    scheduled.push(fn);
    return 0;
  };
  const engine = simulateInterpret({
    setTimeoutFn: manualSetTimeout as never,
    onAsrInterim: () => { interimCount++; },
    onState: (s) => states.push(s),
  });
  engine.start();
  scheduled.shift()?.();
  const countBeforePause = interimCount;
  engine.pause();
  scheduled.forEach((fn) => fn());
  assert.equal(interimCount, countBeforePause);
  assert.ok(states.includes('paused'));
  engine.resume();
  assert.ok(states.includes('listening'));
  engine.stop();
});
