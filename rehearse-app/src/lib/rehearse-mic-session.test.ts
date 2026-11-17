import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMicSessionController,
  type MicErrorKind,
  type MicSessionLike,
  type MicStartCallbacks,
} from './rehearse-mic-session';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  const starts: Array<{ locale: string; callbacks: MicStartCallbacks }> = [];
  const sessions: Array<MicSessionLike & { stopped: number; aborted: number }> = [];
  const errors: MicErrorKind[] = [];
  const interim: string[] = [];
  const final: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let clock = 0;

  const controller = createMicSessionController({
    start: async (locale, callbacks) => {
      starts.push({ locale, callbacks });
      const session = {
        stopped: 0,
        aborted: 0,
        stop() {
          session.stopped += 1;
        },
        abort() {
          session.aborted += 1;
        },
      };
      sessions.push(session);
      return session;
    },
    onInterim: (text) => interim.push(text),
    onFinal: (text) => final.push(text),
    onError: (kind) => errors.push(kind),
    now: () => clock,
    setTimeoutFn: (fn) => {
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    clearTimeoutFn: (handle) => {
      timers.delete(handle as number);
    },
  });

  return {
    controller,
    starts,
    sessions,
    errors,
    interim,
    final,
    timers,
    setClock: (value: number) => {
      clock = value;
    },
    runTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}

test('mic controller: 启动并转发 interim 与 final', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  assert.equal(h.controller.state(), 'listening');
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0]?.locale, 'en-US');

  h.starts[0]?.callbacks.onInterim('I would like');
  h.starts[0]?.callbacks.onFinal('I would like to talk about my workload.');
  assert.deepEqual(h.interim, ['I would like']);
  assert.deepEqual(h.final, ['I would like to talk about my workload.']);
});

test('mic controller: 暂停停止会话，继续重新启动', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  h.controller.pause();
  assert.equal(h.controller.state(), 'paused');
  assert.equal(h.sessions[0]?.stopped, 1);

  h.controller.resume();
  await flush();
  assert.equal(h.controller.state(), 'listening');
  assert.equal(h.starts.length, 2);
});

test('mic controller: 结束中止会话', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  h.controller.stop();
  assert.equal(h.controller.state(), 'idle');
  assert.equal(h.sessions[0]?.aborted, 1);
});

test('mic controller: 权限错误映射为 denied 并回到 idle', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  h.starts[0]?.callbacks.onError('permission denied');
  assert.deepEqual(h.errors, ['denied']);
  assert.equal(h.controller.state(), 'idle');
});

test('mic controller: 识别结束自动重启', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  h.starts[0]?.callbacks.onEnd();
  assert.equal(h.controller.state(), 'listening');
  h.runTimers();
  await flush();

  assert.equal(h.starts.length, 2);
});

test('mic controller: 连续三次秒退后停止并报 unsupported', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  for (let i = 0; i < 3; i += 1) {
    h.starts[i]?.callbacks.onEnd();
    if (i < 2) {
      h.runTimers();
      await flush();
    }
  }

  assert.deepEqual(h.errors, ['unsupported']);
  assert.equal(h.controller.state(), 'idle');
  assert.equal(h.starts.length, 3);
});

test('mic controller: 识别中切换语言会中止旧会话并按新语言重启', async () => {
  const h = harness();
  h.controller.start();
  await flush();

  h.controller.setLocale('en-GB');
  await flush();

  assert.equal(h.sessions[0]?.aborted, 1);
  assert.equal(h.starts.length, 2);
  assert.equal(h.starts[1]?.locale, 'en-GB');
});

test('mic controller: 暂停时切换语言只记录，继续后生效', async () => {
  const h = harness();
  h.controller.start();
  await flush();
  h.controller.pause();

  h.controller.setLocale('en-IN');
  h.controller.resume();
  await flush();

  assert.equal(h.starts.length, 2);
  assert.equal(h.starts[1]?.locale, 'en-IN');
});
